/**
 * Task-scoped macOS workspace authority for the supervised DSH Helper.
 *
 * The ordinary Cindy workdir validator proves that a directory exists.  It
 * does not give a separately-signed sandboxed Helper the right to read or
 * write it.  This module therefore requires an explicit native directory
 * selection and accepts it only when it resolves to the already-selected
 * Cindy task workspace.  The persistent picker bookmark is converted in
 * Main immediately and never written to SQLite, a log, or a Renderer payload.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { DshMainBookmarkNativeBridge } from './main-bookmark-bridge.js';
import { createDshWorkspaceBookmarkHandoff } from './main-bookmark-bridge.js';
import type { DshWorkspaceBookmarkHandoff } from './implicit-bookmark-handoff.js';

export interface DshWorkspaceBookmarkPicker {
  showOpenDialog(input: Readonly<{
    title: string;
    buttonLabel: string;
    defaultPath: string;
    properties: readonly ('openDirectory' | 'securityScopedBookmarks')[];
  }>): Promise<Readonly<{
    canceled: boolean;
    filePaths: readonly string[];
    bookmarks?: readonly string[];
  }>>;
}

/**
 * A user may grant only the exact task workspace. Choosing a parent, sibling,
 * or symlink target is not a convenient expansion: it is rejected and leaves
 * no reusable grant behind.
 */
export async function selectDshTaskWorkspaceBookmarkFromMain(input: {
  cindySessionId: string;
  cwd: string;
  picker: DshWorkspaceBookmarkPicker;
  bridge: DshMainBookmarkNativeBridge;
  isTaskCurrent: () => boolean;
}): Promise<DshWorkspaceBookmarkHandoff> {
  if (
    typeof input.cindySessionId !== 'string' ||
    !input.cindySessionId.trim() ||
    input.cindySessionId.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.cindySessionId)
  ) {
    throw new Error('DSH workspace grant session id is invalid');
  }
  if (!path.isAbsolute(input.cwd) || input.cwd !== path.normalize(input.cwd)) {
    throw new Error('DSH workspace grant requires a canonical absolute directory');
  }
  const selection = await input.picker.showOpenDialog({
    title: 'Allow DeepSeek Harness to use this task workspace',
    buttonLabel: 'Allow this workspace',
    defaultPath: input.cwd,
    properties: ['openDirectory', 'securityScopedBookmarks'],
  });
  if (!input.isTaskCurrent()) {
    throw new Error('DSH task changed while choosing a workspace');
  }
  if (selection.canceled) throw new Error('DSH workspace access was not granted');
  if (selection.filePaths.length !== 1) {
    throw new Error('DSH workspace picker did not return one security-scoped directory bookmark');
  }
  const selected = await fs.realpath(selection.filePaths[0]!).catch(() => null);
  if (!selected || selected !== input.cwd) {
    throw new Error('DSH workspace selection must match this task workspace exactly');
  }
  // Electron documents `bookmarks` as a macOS **MAS** return value. Global
  // Cindy builds still require the same user-mediated authority, so only when
  // the picker has no bookmark at all do we let the fixed signed Main bridge
  // mint a source bookmark for this already-realpath-checked exact directory.
  // A malformed non-empty array remains a hard failure; it must never become
  // a permissive fallback.
  const pickerBookmark = selection.bookmarks;
  let persistentBookmark: string;
  if (pickerBookmark?.length === 1 && typeof pickerBookmark[0] === 'string') {
    persistentBookmark = pickerBookmark[0];
  } else if (pickerBookmark === undefined || pickerBookmark.length === 0) {
    const createPersistentBookmarkForPath = input.bridge.createPersistentBookmarkForPath;
    if (!createPersistentBookmarkForPath) {
      throw new Error('DSH workspace picker did not return one security-scoped directory bookmark');
    }
    persistentBookmark = createPersistentBookmarkForPath(selected);
  } else {
    throw new Error('DSH workspace picker did not return one security-scoped directory bookmark');
  }
  return createDshWorkspaceBookmarkHandoff({
    persistentBookmark,
    bridge: input.bridge,
  });
}
