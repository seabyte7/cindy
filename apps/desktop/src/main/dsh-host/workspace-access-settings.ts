/**
 * Main-owned, per-account persistence for DSH task workspace authorization.
 *
 * The index stores only hashes and private encrypted bookmark references. The
 * selected path and persistent security-scoped bookmark never cross IPC and
 * never enter the ordinary session database.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DshWorkspaceAccessProjection } from '../../shared/dshWorkspaceAccess.js';

export interface DshWorkspaceAccessSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface DshWorkspaceAccessSettingsStore {
  getProjection(accountId: string): DshWorkspaceAccessProjection;
  selectWorkspace(
    accountId: string,
    workspaceDirectory: string,
    persistentBookmark: string,
  ): DshWorkspaceAccessProjection;
  readWorkspaceBookmark(accountId: string, workspaceDirectory: string): string | null;
  reset(accountId: string): DshWorkspaceAccessProjection;
}

interface WorkspaceEntry {
  bookmarkRef: string;
}

interface WorkspaceIndex {
  formatVersion: 1;
  entries: Record<string, Record<string, WorkspaceEntry>>;
}

const INDEX_DIRECTORY = 'dsh-workspace-access';
const INDEX_NAME = 'index.json';
const BOOKMARKS_DIRECTORY = 'bookmarks';
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_BOOKMARK_CHARS = 1024 * 1024;
const ACCOUNT_HASH_RE = /^[a-f0-9]{32}$/;
const WORKSPACE_HASH_RE = /^[a-f0-9]{64}$/;
const BOOKMARK_REF_RE = /^bookmark-[0-9a-f-]{36}\.enc$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertAccountId(accountId: string): void {
  if (!accountId || accountId.length > 4096 || accountId.includes('\0')) {
    throw new Error('DSH workspace access account identity is invalid');
  }
}

function accountHash(accountId: string): string {
  assertAccountId(accountId);
  return createHash('sha256').update(accountId).digest('hex').slice(0, 32);
}

function assertWorkspaceDirectory(directory: string): void {
  if (
    !directory ||
    !path.isAbsolute(directory) ||
    directory !== path.normalize(directory) ||
    directory.includes('\0')
  ) {
    throw new Error('DSH workspace access requires a canonical absolute directory');
  }
}

function workspaceHash(directory: string): string {
  assertWorkspaceDirectory(directory);
  return createHash('sha256').update(directory).digest('hex');
}

function assertOpaqueBookmark(bookmark: string): void {
  if (
    !bookmark ||
    bookmark.length > MAX_BOOKMARK_CHARS ||
    !BASE64_RE.test(bookmark) ||
    Buffer.from(bookmark, 'base64').length === 0
  ) {
    throw new Error('DSH workspace access bookmark is invalid');
  }
}

function assertRealDirectory(directory: string, label: string): string {
  if (!path.isAbsolute(directory)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return fs.realpathSync(directory);
}

function ensureRealDirectChild(parent: string, name: string, label: string): string {
  const realParent = assertRealDirectory(parent, `${label} parent`);
  const candidate = path.join(realParent, name);
  if (path.dirname(candidate) !== realParent) throw new Error(`${label} must be a direct child`);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(candidate, { mode: 0o700 });
  }
  const resolved = fs.realpathSync(candidate);
  if (path.dirname(resolved) !== realParent) throw new Error(`${label} escaped its parent`);
  fs.chmodSync(resolved, 0o700);
  return resolved;
}

function findRealDirectChild(parent: string, name: string, label: string): string | null {
  const realParent = assertRealDirectory(parent, `${label} parent`);
  const candidate = path.join(realParent, name);
  if (path.dirname(candidate) !== realParent) throw new Error(`${label} must be a direct child`);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const resolved = fs.realpathSync(candidate);
  if (path.dirname(resolved) !== realParent) throw new Error(`${label} escaped its parent`);
  return resolved;
}

function readRegularUtf8(candidate: string, maxBytes: number, label: string): string | null {
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      throw new Error(`${label} is invalid`);
    }
    return fs.readFileSync(candidate, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseIndex(source: string): WorkspaceIndex {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('DSH workspace access index is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DSH workspace access index is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    record.formatVersion !== 1 ||
    !record.entries ||
    typeof record.entries !== 'object' ||
    Array.isArray(record.entries)
  ) {
    throw new Error('DSH workspace access index is invalid');
  }
  const entries: WorkspaceIndex['entries'] = Object.create(null) as WorkspaceIndex['entries'];
  for (const [accountKey, rawAccountEntries] of Object.entries(
    record.entries as Record<string, unknown>,
  )) {
    if (
      !ACCOUNT_HASH_RE.test(accountKey) ||
      !rawAccountEntries ||
      typeof rawAccountEntries !== 'object' ||
      Array.isArray(rawAccountEntries)
    ) {
      throw new Error('DSH workspace access index is invalid');
    }
    const accountEntries: Record<string, WorkspaceEntry> = Object.create(null) as Record<
      string,
      WorkspaceEntry
    >;
    for (const [workspaceKey, rawEntry] of Object.entries(
      rawAccountEntries as Record<string, unknown>,
    )) {
      if (
        !WORKSPACE_HASH_RE.test(workspaceKey) ||
        !rawEntry ||
        typeof rawEntry !== 'object' ||
        Array.isArray(rawEntry) ||
        typeof (rawEntry as { bookmarkRef?: unknown }).bookmarkRef !== 'string' ||
        !BOOKMARK_REF_RE.test((rawEntry as { bookmarkRef: string }).bookmarkRef)
      ) {
        throw new Error('DSH workspace access index is invalid');
      }
      accountEntries[workspaceKey] = {
        bookmarkRef: (rawEntry as { bookmarkRef: string }).bookmarkRef,
      };
    }
    entries[accountKey] = accountEntries;
  }
  return { formatVersion: 1, entries };
}

function emptyIndex(): WorkspaceIndex {
  return { formatVersion: 1, entries: Object.create(null) as WorkspaceIndex['entries'] };
}

function encodeIndex(index: WorkspaceIndex): string {
  const entries = Object.fromEntries(
    Object.entries(index.entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([accountKey, accountEntries]) => [
        accountKey,
        Object.fromEntries(
          Object.entries(accountEntries).sort(([left], [right]) => left.localeCompare(right)),
        ),
      ]),
  );
  return `${JSON.stringify({ formatVersion: 1, entries })}\n`;
}

function writeAtomic(directory: string, name: string, content: string): void {
  const target = path.join(directory, name);
  if (path.dirname(target) !== directory)
    throw new Error('DSH workspace access write escaped its directory');
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
    const directoryFd = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function removeOwnBookmark(directory: string, reference: string): void {
  if (!BOOKMARK_REF_RE.test(reference))
    throw new Error('DSH workspace access bookmark reference is invalid');
  const candidate = path.join(directory, reference);
  if (path.dirname(candidate) !== directory)
    throw new Error('DSH workspace access cleanup escaped its directory');
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('DSH workspace access cleanup refused a non-file');
    fs.unlinkSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function hasOwnBookmark(directory: string, reference: string): boolean {
  if (!BOOKMARK_REF_RE.test(reference)) return false;
  const candidate = path.join(directory, reference);
  if (path.dirname(candidate) !== directory) return false;
  try {
    const stat = fs.lstatSync(candidate);
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= MAX_BOOKMARK_CHARS * 8
    );
  } catch {
    return false;
  }
}

export function createDshWorkspaceAccessSettingsStore(input: {
  userDataPath: string;
  safeStorage: DshWorkspaceAccessSafeStorage;
}): DshWorkspaceAccessSettingsStore {
  const userDataPath = assertRealDirectory(
    input.userDataPath,
    'DSH workspace access userData path',
  );

  type Layout = Readonly<{ root: string; indexPath: string; bookmarks: string }>;
  const createPaths = (): Layout => {
    const root = ensureRealDirectChild(userDataPath, INDEX_DIRECTORY, 'DSH workspace access');
    return {
      root,
      indexPath: path.join(root, INDEX_NAME),
      bookmarks: ensureRealDirectChild(
        root,
        BOOKMARKS_DIRECTORY,
        'DSH workspace access bookmark store',
      ),
    };
  };
  const findPaths = (): Layout | null => {
    const root = findRealDirectChild(userDataPath, INDEX_DIRECTORY, 'DSH workspace access');
    if (!root) return null;
    const bookmarks = findRealDirectChild(
      root,
      BOOKMARKS_DIRECTORY,
      'DSH workspace access bookmark store',
    );
    return {
      root,
      indexPath: path.join(root, INDEX_NAME),
      bookmarks: bookmarks ?? path.join(root, BOOKMARKS_DIRECTORY),
    };
  };
  const readIndex = (layout: Layout | null): WorkspaceIndex => {
    if (!layout) return emptyIndex();
    const source = readRegularUtf8(layout.indexPath, MAX_INDEX_BYTES, 'DSH workspace access index');
    return source === null ? emptyIndex() : parseIndex(source);
  };

  return Object.freeze({
    getProjection(accountId: string) {
      const accountKey = accountHash(accountId);
      try {
        const layout = findPaths();
        const entries = layout ? (readIndex(layout).entries[accountKey] ?? {}) : {};
        const encryptionAvailable = input.safeStorage.isEncryptionAvailable();
        const count =
          layout && encryptionAvailable
            ? Object.values(entries).filter((entry) =>
                hasOwnBookmark(layout.bookmarks, entry.bookmarkRef),
              ).length
            : 0;
        const status =
          !encryptionAvailable && Object.keys(entries).length > 0
            ? 'unavailable'
            : count > 0
              ? 'configured'
              : 'default';
        return Object.freeze({ status, count });
      } catch {
        return Object.freeze({ status: 'unavailable', count: 0 });
      }
    },

    selectWorkspace(accountId: string, workspaceDirectory: string, persistentBookmark: string) {
      assertWorkspaceDirectory(workspaceDirectory);
      assertOpaqueBookmark(persistentBookmark);
      if (!input.safeStorage.isEncryptionAvailable()) {
        throw new Error('DSH workspace access secure storage is unavailable');
      }
      const layout = createPaths();
      const index = readIndex(layout);
      const accountKey = accountHash(accountId);
      const workspaceKey = workspaceHash(workspaceDirectory);
      const accountEntries =
        index.entries[accountKey] ??
        (index.entries[accountKey] = Object.create(null) as Record<string, WorkspaceEntry>);
      const oldReference = accountEntries[workspaceKey]?.bookmarkRef;
      const reference = `bookmark-${randomUUID()}.enc`;
      const encrypted = input.safeStorage.encryptString(persistentBookmark).toString('base64');
      if (!encrypted || encrypted.length > MAX_BOOKMARK_CHARS * 8) {
        throw new Error('DSH workspace access secure storage returned an invalid bookmark payload');
      }
      writeAtomic(layout.bookmarks, reference, encrypted);
      try {
        accountEntries[workspaceKey] = { bookmarkRef: reference };
        writeAtomic(layout.root, INDEX_NAME, encodeIndex(index));
      } catch (error) {
        removeOwnBookmark(layout.bookmarks, reference);
        throw error;
      }
      if (oldReference && oldReference !== reference) {
        try {
          removeOwnBookmark(layout.bookmarks, oldReference);
        } catch {
          /* unreachable private blob */
        }
      }
      return Object.freeze({ status: 'configured', count: Object.keys(accountEntries).length });
    },

    readWorkspaceBookmark(accountId: string, workspaceDirectory: string) {
      assertWorkspaceDirectory(workspaceDirectory);
      try {
        const layout = findPaths();
        if (!layout || !input.safeStorage.isEncryptionAvailable()) return null;
        const accountEntries = readIndex(layout).entries[accountHash(accountId)];
        const entry = accountEntries?.[workspaceHash(workspaceDirectory)];
        if (!entry || !hasOwnBookmark(layout.bookmarks, entry.bookmarkRef)) return null;
        const encrypted = readRegularUtf8(
          path.join(layout.bookmarks, entry.bookmarkRef),
          MAX_BOOKMARK_CHARS * 8,
          'DSH workspace access bookmark',
        );
        if (encrypted === null) return null;
        const bookmark = input.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        assertOpaqueBookmark(bookmark);
        return bookmark;
      } catch {
        return null;
      }
    },

    reset(accountId: string) {
      const layout = findPaths();
      if (!layout) return Object.freeze({ status: 'default', count: 0 });
      const index = readIndex(layout);
      const accountKey = accountHash(accountId);
      const accountEntries = index.entries[accountKey];
      if (!accountEntries) return Object.freeze({ status: 'default', count: 0 });
      delete index.entries[accountKey];
      writeAtomic(layout.root, INDEX_NAME, encodeIndex(index));
      for (const entry of Object.values(accountEntries)) {
        try {
          removeOwnBookmark(layout.bookmarks, entry.bookmarkRef);
        } catch {
          /* private cleanup */
        }
      }
      return Object.freeze({ status: 'default', count: 0 });
    },
  });
}
