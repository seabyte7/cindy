import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
    const image = Buffer.from('not-a-real-png-but-a-safe-acp-fixture');
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

    await expect(admission.prepare({
      cindySessionId: 'task-file-image',
      inlineImagePromptSupported: false,
      content: [{ type: 'image', path: source, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
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
    ).rejects.toThrow('regular local file');
    await expect(
      admission.prepare({
        cindySessionId: 'task-extra-dir',
        inlineImagePromptSupported: false,
        content: [{ type: 'mention', name: 'another directory', path: sourceRoot, kind: 'dir' }],
      }),
    ).rejects.toThrow('extra directory mentions');
  });
});
