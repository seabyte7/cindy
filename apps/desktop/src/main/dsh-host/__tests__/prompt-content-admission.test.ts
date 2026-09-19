import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createDshPromptContentAdmission } from '../prompt-content-admission.js';

const temporaryRoots: string[] = [];

function fixture(): { root: string; stagingRoot: string; sourceRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-prompt-admission-'));
  temporaryRoots.push(root);
  const stagingRoot = join(root, 'dsh-home');
  const sourceRoot = join(root, 'renderer-selected');
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  mkdirSync(sourceRoot, { recursive: true, mode: 0o700 });
  return { root, stagingRoot, sourceRoot };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DSH prompt content admission', () => {
  it('keeps a >3 MiB image inline, sniffs MIME, preserves order and leaves no image staging copy', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const bytes = Buffer.alloc(4 * 1024 * 1024);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    const source = join(sourceRoot, 'misleading.jpg');
    writeFileSync(source, bytes);
    const admission = createDshPromptContentAdmission({ stagingRoot });
    for (let attempt = 0; attempt < 2; attempt++) {
      const output = await admission.prepare({
        cindySessionId: 'images',
        inlineImagePromptSupported: true,
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', path: source, mimeType: 'image/jpeg' },
          { type: 'text', text: 'after' },
        ],
      });
      expect(output.map((block) => block.type)).toEqual(['text', 'image', 'text']);
      expect(output[1]).toEqual({
        type: 'image',
        data: bytes.toString('base64'),
        mimeType: 'image/png',
      });
    }
    expect(readdirSync(stagingRoot)).toEqual([]);
    expect(readFileSync(source).equals(bytes)).toBe(true);
  });

  it('compresses only the in-memory copy for the aggregate frame budget, and rejects if it still cannot fit', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const bytes = Buffer.alloc(7 * 1024 * 1024);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    const source = join(sourceRoot, 'large.png');
    writeFileSync(source, bytes);
    const input = {
      cindySessionId: 'images',
      inlineImagePromptSupported: true,
      content: [
        { type: 'image' as const, path: source },
        { type: 'image' as const, path: source },
      ],
    };
    const refused = createDshPromptContentAdmission({
      stagingRoot,
      compressImage: async () => null,
    });
    await expect(refused.prepare(input)).rejects.toMatchObject({ code: 'prompt-too-large' });
    const compressed = createDshPromptContentAdmission({
      stagingRoot,
      compressImage: async () => ({ buffer: bytes.subarray(0, 1024), mime: 'image/png' }),
    });
    const output = await compressed.prepare(input);
    expect(output.map((block) => block.type)).toEqual(['image', 'image']);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(16 * 1024 * 1024);
    expect(readFileSync(source).equals(bytes)).toBe(true);
  });

  it('stages repeat file sends separately and cleans an entire rejected batch', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const source = join(sourceRoot, 'notes.txt');
    writeFileSync(source, 'notes');
    const admission = createDshPromptContentAdmission({ stagingRoot });
    const input = {
      cindySessionId: 'files',
      inlineImagePromptSupported: true,
      content: [{ type: 'file' as const, path: source }],
    };
    const first = await admission.prepare(input);
    const second = await admission.prepare(input);
    expect(first).not.toEqual(second);
    const before = readdirSync(stagingRoot, { recursive: true });
    await expect(
      admission.prepare({ ...input, content: [...input.content, { type: 'image', path: source }] }),
    ).rejects.toMatchObject({ code: 'image-invalid' });
    expect(readdirSync(stagingRoot, { recursive: true })).toEqual(before);
  });

  it('copies a host-normalized file into the task-owned DSH staging area before ACP sees it', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const source = join(sourceRoot, 'unique notes.md');
    writeFileSync(source, 'unique attachment contents\n', { mode: 0o600 });
    const admission = createDshPromptContentAdmission({ stagingRoot });

    const content = await admission.prepare({
      cindySessionId: 'task/that-must-not-be-a-path',
      inlineImagePromptSupported: false,
      content: [
        { type: 'text', text: 'Read the attached notes.' },
        { type: 'file', path: source, mimeType: 'text/markdown' },
      ],
    });

    expect(content[0]).toEqual({ type: 'text', text: 'Read the attached notes.' });
    expect(content[1]).toMatchObject({ type: 'resource_link', name: 'unique notes.md' });
    const stagedPath = fileURLToPath((content[1] as { uri: string }).uri);
    expect(
      stagedPath.startsWith(path.join(realpathSync(stagingRoot), 'dsh-task-attachments')),
    ).toBe(true);
    expect(stagedPath).not.toBe(source);
    expect(readFileSync(stagedPath, 'utf8')).toBe('unique attachment contents\n');
    expect(readFileSync(source, 'utf8')).toBe('unique attachment contents\n');
  });

  it('uses actual image bytes only after this ACP carrier advertises inline-image input', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const source = join(sourceRoot, 'pixel.png');
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    );
    writeFileSync(source, image, { mode: 0o600 });
    const admission = createDshPromptContentAdmission({ stagingRoot });

    const inline = await admission.prepare({
      cindySessionId: 'task-inline-image',
      inlineImagePromptSupported: true,
      content: [{ type: 'image', path: source, mimeType: 'image/png' }],
    });
    expect(inline).toEqual([
      { type: 'image', data: image.toString('base64'), mimeType: 'image/png' },
    ]);

    await expect(
      admission.prepare({
        cindySessionId: 'task-file-image',
        inlineImagePromptSupported: false,
        content: [{ type: 'image', path: source, mimeType: 'image/png' }],
      }),
    ).rejects.toMatchObject({
      name: 'DshBridgePromptFailure',
      code: 'image-input-unavailable',
    });
  });

  it('rejects symlink sources and extra directory mentions rather than widening task authority', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const source = join(sourceRoot, 'ordinary.txt');
    const link = join(sourceRoot, 'link.txt');
    writeFileSync(source, 'ordinary\n', { mode: 0o600 });
    symlinkSync(source, link);
    const admission = createDshPromptContentAdmission({ stagingRoot });

    await expect(
      admission.prepare({
        cindySessionId: 'task-symlink',
        inlineImagePromptSupported: false,
        content: [{ type: 'file', path: link }],
      }),
    ).rejects.toMatchObject({ code: 'attachment-invalid' });
    await expect(
      admission.prepare({
        cindySessionId: 'task-extra-dir',
        inlineImagePromptSupported: false,
        content: [{ type: 'mention', name: 'another directory', path: sourceRoot, kind: 'dir' }],
      }),
    ).rejects.toMatchObject({ code: 'attachment-invalid' });
  });

  it('refuses a linked staging parent before creating anything outside the managed Home', async () => {
    const { stagingRoot, sourceRoot } = fixture();
    const source = join(sourceRoot, 'notes.txt');
    writeFileSync(source, 'notes');
    symlinkSync(sourceRoot, join(stagingRoot, 'dsh-task-attachments'));
    const admission = createDshPromptContentAdmission({ stagingRoot });
    await expect(
      admission.prepare({
        cindySessionId: 'linked-parent',
        inlineImagePromptSupported: true,
        content: [{ type: 'file', path: source }],
      }),
    ).rejects.toMatchObject({ code: 'attachment-invalid' });
    expect(readdirSync(sourceRoot)).toEqual(['notes.txt']);
  });
});
