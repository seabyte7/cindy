/**
 * Main-owned admission for DSH prompt attachments.
 *
 * Images cross ACP as MIME-sniffed inline bytes, within the aggregate frame
 * budget. Ordinary files are copied to a unique task-owned batch below the
 * process Home and exposed as file URIs. Original selections stay unchanged
 * and outside the runtime's ambient filesystem authority.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DSH_ACP_MAX_FRAME_BYTES,
  DshBridgePromptFailure,
  type DshBridgePromptContent,
} from '@cindy/maker-core';
import { sniffMediaMime } from '../cindy-media/sniffMediaMime.js';
import { compressInlineImage } from '../mcp-integrations/inlineImageCompressor.js';

export type DshAcpPromptContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'resource_link'; readonly name: string; readonly uri: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: DshInlineImageMimeType };

type DshInlineImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface DshPromptContentAdmission {
  prepare(input: {
    readonly cindySessionId: string;
    readonly content: readonly DshBridgePromptContent[];
    /** Exact initialize-handshake fact from the active ACP carrier. */
    readonly inlineImagePromptSupported: boolean;
  }): Promise<readonly DshAcpPromptContent[]>;
}

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
// Reserve space for the JSON-RPC envelope and the bounded, possibly escaped
// native session id (4 KiB). The ACP serializer is the final exact guard.
const MAX_PROMPT_BYTES = DSH_ACP_MAX_FRAME_BYTES - 32 * 1024;
const MAX_ATTACHMENT_COUNT = 32;
const MAX_ATTACHMENT_NAME_BYTES = 180;
const INLINE_IMAGE_MIME_TYPES = new Set<DshInlineImageMimeType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function safeSessionDirectoryName(cindySessionId: string): string {
  return createHash('sha256').update(cindySessionId).digest('hex').slice(0, 40);
}

function safeAttachmentName(sourcePath: string, index: number): string {
  const base = path.basename(sourcePath).replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
  const clipped = Buffer.from(base).subarray(0, MAX_ATTACHMENT_NAME_BYTES).toString('utf8');
  return `${index.toString().padStart(2, '0')}-${clipped || 'attachment'}`;
}

function assertAbsolutePath(value: string, label: string): void {
  if (!path.isAbsolute(value) || value.includes('\0') || value.trim() !== value) {
    throw new Error(`DSH ${label} must be an absolute local path`);
  }
}

async function assertRealDirectory(value: string, label: string): Promise<string> {
  assertAbsolutePath(value, label);
  const stat = await fs.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`DSH ${label} must be a real directory`);
  }
  return await fs.realpath(value);
}

async function readAttachmentSource(value: string): Promise<{ realPath: string; size: number }> {
  assertAbsolutePath(value, 'attachment source');
  const lstat = await fs.lstat(value);
  if (!lstat.isFile() || lstat.isSymbolicLink()) {
    throw new Error('DSH attachment must be a regular local file');
  }
  if (lstat.size > MAX_ATTACHMENT_BYTES) {
    throw new DshBridgePromptFailure('prompt-too-large', 'DSH attachment exceeds the size limit');
  }
  const realPath = await fs.realpath(value);
  const stat = await fs.stat(realPath);
  if (!stat.isFile() || stat.size !== lstat.size) {
    throw new Error('DSH attachment changed while it was being admitted');
  }
  return { realPath, size: stat.size };
}

const promptBytes = (content: readonly DshAcpPromptContent[]): number =>
  Buffer.byteLength(JSON.stringify(content), 'utf8');

/**
 * Stage only ordinary files.  Directory mentions remain governed by the
 * task's selected working directory; accepting arbitrary extra directories
 * here would silently widen the DSH sandbox surface.
 */
export function createDshPromptContentAdmission(input: {
  /** A DSH-owned real directory, normally the contained process HOME. */
  stagingRoot: string;
  /** Injectable in tests; production uses the existing in-memory compressor. */
  compressImage?: typeof compressInlineImage;
}): DshPromptContentAdmission {
  let rootPromise: Promise<string> | null = null;
  const root = async (): Promise<string> => {
    rootPromise ??= assertRealDirectory(input.stagingRoot, 'attachment staging root');
    return await rootPromise;
  };

  return {
    async prepare({
      cindySessionId,
      content,
      inlineImagePromptSupported,
    }): Promise<readonly DshAcpPromptContent[]> {
      let batchDirectory: string | null = null;
      try {
        if (!cindySessionId.trim()) throw new Error('DSH attachment session id is invalid');
        const attachmentCount = content.filter((item) => item.type !== 'text').length;
        if (attachmentCount > MAX_ATTACHMENT_COUNT) {
          throw new Error(`DSH prompt exceeds ${MAX_ATTACHMENT_COUNT} local attachments`);
        }

        const output: DshAcpPromptContent[] = [];
        let attachmentIndex = 0;
        for (const item of content) {
          if (item.type === 'text') {
            output.push({ type: 'text', text: item.text });
            continue;
          }
          if (item.type === 'mention' && item.kind === 'dir') {
            throw new Error(
              'DSH accepts only the task working directory; extra directory mentions are unavailable',
            );
          }

          if (item.type === 'image' && !inlineImagePromptSupported) {
            throw new DshBridgePromptFailure(
              'image-input-unavailable',
              'DSH active ACP runtime does not advertise image input',
            );
          }

          const source = await readAttachmentSource(item.path);
          if (item.type === 'image') {
            const handle = await fs.open(
              source.realPath,
              constants.O_RDONLY | constants.O_NOFOLLOW,
            );
            let bytes: Buffer;
            try {
              const stat = await handle.stat();
              if (!stat.isFile() || stat.size !== source.size) throw new Error('DSH image changed');
              bytes = Buffer.alloc(source.size);
              const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
              const after = await handle.stat();
              if (
                bytesRead !== bytes.length ||
                after.size !== stat.size ||
                after.mtimeMs !== stat.mtimeMs
              ) {
                throw new Error('DSH image changed');
              }
            } finally {
              await handle.close();
            }
            const mime = sniffMediaMime(bytes);
            if (!mime || !INLINE_IMAGE_MIME_TYPES.has(mime as DshInlineImageMimeType)) {
              throw new DshBridgePromptFailure('image-invalid', 'DSH image format is unsupported');
            }
            output.push({
              type: 'image',
              data: bytes.toString('base64'),
              mimeType: mime as DshInlineImageMimeType,
            });
            continue;
          }
          if (!batchDirectory) {
            const stagedRoot = await root();
            let taskDirectory = stagedRoot;
            // Check each component before descending: recursive mkdir could
            // otherwise create the task directory through an existing symlink.
            for (const segment of [
              'dsh-task-attachments',
              safeSessionDirectoryName(cindySessionId),
            ]) {
              const candidate = path.join(taskDirectory, segment);
              await fs.mkdir(candidate, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'EEXIST') throw error;
              });
              taskDirectory = await assertRealDirectory(candidate, 'attachment staging directory');
              if (!taskDirectory.startsWith(`${stagedRoot}${path.sep}`))
                throw new Error('DSH staging root escaped');
              await fs.chmod(taskDirectory, 0o700);
            }
            batchDirectory = await fs.mkdtemp(path.join(taskDirectory, 'send-'));
          }
          const stagedName = safeAttachmentName(source.realPath, attachmentIndex++);
          const destination = path.join(batchDirectory, stagedName);
          // The name is generated locally and the batch parent has been realpath'd;
          // still reject a pre-existing non-file rather than overwriting it.
          try {
            await fs.lstat(destination);
            throw new Error('DSH attachment staging name collision');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          await fs.copyFile(source.realPath, destination, constants.COPYFILE_EXCL);
          await fs.chmod(destination, 0o600);
          const copied = await fs.stat(destination);
          if (!copied.isFile() || copied.size !== source.size) {
            throw new Error('DSH attachment copy could not be verified');
          }
          output.push({
            type: 'resource_link',
            name: item.type === 'mention' ? item.name : path.basename(source.realPath),
            uri: pathToFileURL(destination).href,
          });
        }
        if (promptBytes(output) > MAX_PROMPT_BYTES) {
          const images = output.filter((block) => block.type === 'image');
          const overhead = promptBytes(
            output.map((block) => (block.type === 'image' ? { ...block, data: '' } : block)),
          );
          const targetBytes = Math.floor(
            ((MAX_PROMPT_BYTES - overhead) * 3) / 4 / Math.max(images.length, 1),
          );
          if (targetBytes > 0) {
            for (let index = 0; index < output.length; index++) {
              const block = output[index];
              if (block.type !== 'image') continue;
              const compressed = await (input.compressImage ?? compressInlineImage)(
                Buffer.from(block.data, 'base64'),
                block.mimeType,
                { targetBytes },
              );
              if (
                compressed &&
                compressed.buffer.length < Buffer.byteLength(block.data, 'base64') &&
                INLINE_IMAGE_MIME_TYPES.has(compressed.mime as DshInlineImageMimeType)
              ) {
                output[index] = {
                  type: 'image',
                  data: compressed.buffer.toString('base64'),
                  mimeType: compressed.mime as DshInlineImageMimeType,
                };
              }
            }
          }
        }
        if (promptBytes(output) > MAX_PROMPT_BYTES) {
          throw new DshBridgePromptFailure(
            'prompt-too-large',
            'DSH prompt exceeds the ACP frame budget',
          );
        }
        return output;
      } catch (error) {
        if (batchDirectory)
          await fs.rm(batchDirectory, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof DshBridgePromptFailure) throw error;
        throw new DshBridgePromptFailure(
          'attachment-invalid',
          'DSH could not admit the selected attachments',
        );
      }
    },
  };
}
