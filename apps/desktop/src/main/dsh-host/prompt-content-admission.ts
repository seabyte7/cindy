/**
 * Main-owned admission for DSH prompt attachments.
 *
 * Renderer paths never cross ACP directly.  A user-selected attachment is
 * copied to a task-scoped directory below the DSH process Home, then exposed
 * to the official ACP profile only as a file URI.  This keeps the original
 * selection outside of the runtime's ambient filesystem authority while still
 * making a concrete, readable local attachment available to enabled tools.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DshBridgePromptFailure, type DshBridgePromptContent } from '@cindy/maker-core';

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
// The ACP client bounds one JSON-RPC frame at 16 MiB. Base64 grows by roughly
// one third, so an inline image gets a smaller independent cap. Larger images
// still arrive as staged file resources for tool-based processing.
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 32;
const MAX_ATTACHMENT_NAME_BYTES = 180;
const INLINE_IMAGE_MIME_TYPES = new Set<DshInlineImageMimeType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const INLINE_IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, DshInlineImageMimeType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

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
    throw new Error(`DSH attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  const realPath = await fs.realpath(value);
  const stat = await fs.stat(realPath);
  if (!stat.isFile() || stat.size !== lstat.size) {
    throw new Error('DSH attachment changed while it was being admitted');
  }
  return { realPath, size: stat.size };
}

function inlineImageMimeType(
  item: Extract<DshBridgePromptContent, { type: 'image' }>,
): DshInlineImageMimeType | null {
  if (item.mimeType && INLINE_IMAGE_MIME_TYPES.has(item.mimeType as DshInlineImageMimeType)) {
    return item.mimeType as DshInlineImageMimeType;
  }
  return INLINE_IMAGE_MIME_BY_EXTENSION[path.extname(item.path).toLowerCase()] ?? null;
}

/**
 * Stage only ordinary files.  Directory mentions remain governed by the
 * task's selected working directory; accepting arbitrary extra directories
 * here would silently widen the DSH sandbox surface.
 */
export function createDshPromptContentAdmission(input: {
  /** A DSH-owned real directory, normally the contained process HOME. */
  stagingRoot: string;
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
      if (!cindySessionId.trim()) throw new Error('DSH attachment session id is invalid');
      const attachmentCount = content.filter((item) => item.type !== 'text').length;
      if (attachmentCount > MAX_ATTACHMENT_COUNT) {
        throw new Error(`DSH prompt exceeds ${MAX_ATTACHMENT_COUNT} local attachments`);
      }

      const output: DshAcpPromptContent[] = [];
      let attachmentIndex = 0;
      let taskDirectory: string | null = null;
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
        if (!taskDirectory) {
          const stagedRoot = await root();
          const candidate = path.join(
            stagedRoot,
            'dsh-task-attachments',
            safeSessionDirectoryName(cindySessionId),
          );
          await fs.mkdir(candidate, { recursive: true, mode: 0o700 });
          const stat = await fs.lstat(candidate);
          if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error('DSH attachment staging directory is invalid');
          }
          taskDirectory = await fs.realpath(candidate);
          await fs.chmod(taskDirectory, 0o700);
        }
        const stagedName = safeAttachmentName(source.realPath, attachmentIndex++);
        const destination = path.join(taskDirectory, stagedName);
        // The name is generated locally and taskDirectory has been realpath'd;
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
        const mimeType = item.type === 'image' ? inlineImageMimeType(item) : null;
        if (
          item.type === 'image' &&
          inlineImagePromptSupported &&
          mimeType !== null &&
          copied.size <= MAX_INLINE_IMAGE_BYTES
        ) {
          // Read only the task-local copy. The renderer-selected source path
          // is never embedded in ACP and never handed to the runtime.
          output.push({
            type: 'image',
            data: (await fs.readFile(destination)).toString('base64'),
            mimeType,
          });
          continue;
        }
        output.push({
          type: 'resource_link',
          name: item.type === 'mention' ? item.name : path.basename(source.realPath),
          uri: pathToFileURL(destination).href,
        });
      }
      return output;
    },
  };
}
