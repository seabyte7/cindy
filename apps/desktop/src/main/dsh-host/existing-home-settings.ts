/**
 * Per-account, Main-owned selection state for an existing DSH Home.
 *
 * A selected DSH Home can execute profiles and extensions that Cindy does not
 * own.  Keep its pathname and its security-scoped bookmark out of the
 * ordinary settings database, Renderer, diagnostics and activity snapshots.
 * The small JSON index contains only an account hash and a random encrypted
 * bookmark reference; the bookmark itself lives in a safeStorage-encrypted
 * file below the same Main-owned userData root.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DshExistingHomeProjection } from '../../shared/dshExistingHome.js';

export type { DshExistingHomeProjection } from '../../shared/dshExistingHome.js';

export type DshExistingHomeMode = 'cindy-managed' | 'existing-dsh-home';

export interface DshExistingHomeSafeStorage {
  /** Do not call this during application start just to probe availability. */
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface DshExistingHomeSettingsStore {
  /** Display-safe mode/status only; never returns a path, reference or bookmark. */
  getProjection(accountId: string): DshExistingHomeProjection;
  /** Explicit user selection only. The opaque bookmark is never put in ordinary config. */
  selectExistingHome(accountId: string, bookmark: string): DshExistingHomeProjection;
  /** Main launch path only. A caller must not expose the returned bookmark across IPC. */
  readLaunchSelection(
    accountId: string,
  ):
    Readonly<{ mode: 'cindy-managed' }> | Readonly<{ mode: 'existing-dsh-home'; bookmark: string }>;
  /** Removes Cindy-owned references only. It never opens, copies or edits the selected Home. */
  reset(accountId: string): DshExistingHomeProjection;
}

interface ExistingHomeIndexEntry {
  mode: 'existing-dsh-home';
  bookmarkRef: string;
}

interface ExistingHomeIndex {
  formatVersion: 1;
  entries: Record<string, ExistingHomeIndexEntry>;
}

const INDEX_DIRECTORY = 'dsh-home-overrides';
const INDEX_NAME = 'index.json';
const BOOKMARKS_DIRECTORY = 'bookmarks';
const MAX_INDEX_BYTES = 64 * 1024;
const MAX_BOOKMARK_CHARS = 1024 * 1024;
const ACCOUNT_HASH_RE = /^[a-f0-9]{32}$/;
const BOOKMARK_REF_RE = /^bookmark-[0-9a-f-]{36}\.enc$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertAccountId(accountId: string): void {
  if (!accountId || accountId.length > 4096 || accountId.includes('\0')) {
    throw new Error('DSH existing Home account identity is invalid');
  }
}

function accountHash(accountId: string): string {
  assertAccountId(accountId);
  return createHash('sha256').update(accountId).digest('hex').slice(0, 32);
}

function assertOpaqueBookmark(bookmark: string): void {
  if (
    !bookmark ||
    bookmark.length > MAX_BOOKMARK_CHARS ||
    !BASE64_RE.test(bookmark) ||
    Buffer.from(bookmark, 'base64').length === 0
  ) {
    throw new Error('DSH existing Home bookmark is invalid');
  }
}

function assertRealDirectory(candidate: string, label: string): string {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return fs.realpathSync(candidate);
}

function ensureRealDirectChild(parent: string, name: string, label: string): string {
  const realParent = assertRealDirectory(parent, `${label} parent`);
  const candidate = path.join(realParent, name);
  if (path.dirname(candidate) !== realParent) throw new Error(`${label} must be a direct child`);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`${label} must be a real directory`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(candidate, { mode: 0o700 });
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`${label} must be a real directory`);
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
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`${label} must be a real directory`);
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

function parseIndex(source: string): ExistingHomeIndex {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('DSH existing Home override index is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DSH existing Home override index is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    record.formatVersion !== 1 ||
    !record.entries ||
    typeof record.entries !== 'object' ||
    Array.isArray(record.entries)
  ) {
    throw new Error('DSH existing Home override index is invalid');
  }
  const entries: Record<string, ExistingHomeIndexEntry> = Object.create(null) as Record<
    string,
    ExistingHomeIndexEntry
  >;
  for (const [key, rawEntry] of Object.entries(record.entries as Record<string, unknown>)) {
    if (
      !ACCOUNT_HASH_RE.test(key) ||
      !rawEntry ||
      typeof rawEntry !== 'object' ||
      Array.isArray(rawEntry)
    ) {
      throw new Error('DSH existing Home override index is invalid');
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      entry.mode !== 'existing-dsh-home' ||
      typeof entry.bookmarkRef !== 'string' ||
      !BOOKMARK_REF_RE.test(entry.bookmarkRef)
    ) {
      throw new Error('DSH existing Home override index is invalid');
    }
    entries[key] = { mode: 'existing-dsh-home', bookmarkRef: entry.bookmarkRef };
  }
  return { formatVersion: 1, entries };
}

function encodeIndex(index: ExistingHomeIndex): string {
  const entries = Object.fromEntries(
    Object.entries(index.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify({ formatVersion: 1, entries })}\n`;
}

function writeAtomic(directory: string, name: string, content: string): void {
  const target = path.join(directory, name);
  if (path.dirname(target) !== directory)
    throw new Error('DSH existing Home write escaped its directory');
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
    throw new Error('DSH existing Home bookmark reference is invalid');
  const candidate = path.join(directory, reference);
  if (path.dirname(candidate) !== directory)
    throw new Error('DSH existing Home bookmark cleanup escaped its directory');
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('DSH existing Home bookmark cleanup refused a non-file');
    fs.unlinkSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

/**
 * Creates the protected override store. It has no Electron import or startup
 * side effect so tests can inject an in-memory safe-storage adapter.
 */
export function createDshExistingHomeSettingsStore(input: {
  userDataPath: string;
  safeStorage: DshExistingHomeSafeStorage;
}): DshExistingHomeSettingsStore {
  const userDataPath = assertRealDirectory(input.userDataPath, 'DSH existing Home userData path');

  type Layout = Readonly<{ root: string; indexPath: string; bookmarks: string }>;

  const createPaths = (): Layout => {
    const root = ensureRealDirectChild(
      userDataPath,
      INDEX_DIRECTORY,
      'DSH existing Home overrides',
    );
    return {
      root,
      indexPath: path.join(root, INDEX_NAME),
      bookmarks: ensureRealDirectChild(
        root,
        BOOKMARKS_DIRECTORY,
        'DSH existing Home bookmark store',
      ),
    };
  };

  const findPaths = (): Layout | null => {
    const root = findRealDirectChild(userDataPath, INDEX_DIRECTORY, 'DSH existing Home overrides');
    if (!root) return null;
    const bookmarks = findRealDirectChild(
      root,
      BOOKMARKS_DIRECTORY,
      'DSH existing Home bookmark store',
    );
    return {
      root,
      indexPath: path.join(root, INDEX_NAME),
      // Keep the candidate private and let readRegularUtf8 fail closed if an
      // index names a bookmark while the owned directory disappeared.
      bookmarks: bookmarks ?? path.join(root, BOOKMARKS_DIRECTORY),
    };
  };

  const readIndex = (layout: Layout | null): ExistingHomeIndex => {
    if (!layout)
      return {
        formatVersion: 1,
        entries: Object.create(null) as Record<string, ExistingHomeIndexEntry>,
      };
    const source = readRegularUtf8(
      layout.indexPath,
      MAX_INDEX_BYTES,
      'DSH existing Home override index',
    );
    return source === null
      ? { formatVersion: 1, entries: Object.create(null) as Record<string, ExistingHomeIndexEntry> }
      : parseIndex(source);
  };

  const hasOwnBookmark = (layout: Layout, reference: string): boolean => {
    if (!BOOKMARK_REF_RE.test(reference)) return false;
    const candidate = path.join(layout.bookmarks, reference);
    if (path.dirname(candidate) !== layout.bookmarks) return false;
    try {
      const stat = fs.lstatSync(candidate);
      return (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 0 &&
        stat.size <= MAX_BOOKMARK_CHARS * 8
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return false;
    }
  };

  return Object.freeze({
    getProjection(accountId: string): DshExistingHomeProjection {
      const key = accountHash(accountId);
      try {
        const layout = findPaths();
        const entry = readIndex(layout).entries[key];
        if (!entry) return Object.freeze({ mode: 'cindy-managed', status: 'default' });
        if (!layout || !input.safeStorage.isEncryptionAvailable()) {
          return Object.freeze({ mode: 'existing-dsh-home', status: 'unavailable' });
        }
        return Object.freeze({
          mode: 'existing-dsh-home',
          status: hasOwnBookmark(layout, entry.bookmarkRef) ? 'configured' : 'unavailable',
        });
      } catch {
        // A malformed protected override must never silently change the user
        // back to a different Home. Keep the situation actionable and fail
        // closed when a launch is later attempted.
        return Object.freeze({ mode: 'existing-dsh-home', status: 'unavailable' });
      }
    },

    selectExistingHome(accountId: string, bookmark: string): DshExistingHomeProjection {
      const key = accountHash(accountId);
      assertOpaqueBookmark(bookmark);
      if (!input.safeStorage.isEncryptionAvailable()) {
        throw new Error('DSH existing Home secure storage is unavailable');
      }
      const layout = createPaths();
      const index = readIndex(layout);
      const oldReference = index.entries[key]?.bookmarkRef;
      const reference = `bookmark-${randomUUID()}.enc`;
      const encrypted = input.safeStorage.encryptString(bookmark).toString('base64');
      if (!encrypted || encrypted.length > MAX_BOOKMARK_CHARS * 8) {
        throw new Error('DSH existing Home secure storage returned an invalid bookmark payload');
      }
      writeAtomic(layout.bookmarks, reference, encrypted);
      try {
        index.entries[key] = { mode: 'existing-dsh-home', bookmarkRef: reference };
        writeAtomic(layout.root, INDEX_NAME, encodeIndex(index));
      } catch (error) {
        removeOwnBookmark(layout.bookmarks, reference);
        throw error;
      }
      if (oldReference && oldReference !== reference) {
        // The current reference has already been atomically committed. Failure
        // to remove an old opaque blob cannot grant runtime access and must not
        // touch any user-owned DSH state.
        try {
          removeOwnBookmark(layout.bookmarks, oldReference);
        } catch {
          // The old blob is an unreachable Cindy-owned artifact. Do not
          // misreport a successfully committed new selection as failed, and
          // never attempt cleanup outside this private directory.
        }
      }
      return Object.freeze({ mode: 'existing-dsh-home', status: 'configured' });
    },

    readLaunchSelection(accountId: string) {
      const key = accountHash(accountId);
      const layout = findPaths();
      const index = readIndex(layout);
      const entry = index.entries[key];
      if (!entry) return Object.freeze({ mode: 'cindy-managed' as const });
      if (!input.safeStorage.isEncryptionAvailable()) {
        throw new Error('DSH existing Home secure storage is unavailable');
      }
      if (!layout) throw new Error('DSH existing Home bookmark is unavailable');
      const encrypted = readRegularUtf8(
        path.join(layout.bookmarks, entry.bookmarkRef),
        MAX_BOOKMARK_CHARS * 8,
        'DSH existing Home bookmark',
      );
      if (encrypted === null) throw new Error('DSH existing Home bookmark is unavailable');
      let bookmark: string;
      try {
        bookmark = input.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        throw new Error('DSH existing Home bookmark cannot be decrypted');
      }
      assertOpaqueBookmark(bookmark);
      return Object.freeze({ mode: 'existing-dsh-home' as const, bookmark });
    },

    reset(accountId: string): DshExistingHomeProjection {
      const key = accountHash(accountId);
      const layout = findPaths();
      const index = readIndex(layout);
      const oldReference = index.entries[key]?.bookmarkRef;
      if (!oldReference) return Object.freeze({ mode: 'cindy-managed', status: 'default' });
      if (!layout) throw new Error('DSH existing Home override is unavailable');
      delete index.entries[key];
      writeAtomic(layout.root, INDEX_NAME, encodeIndex(index));
      removeOwnBookmark(layout.bookmarks, oldReference);
      return Object.freeze({ mode: 'cindy-managed', status: 'default' });
    },
  });
}

export interface DshExistingHomePicker {
  showOpenDialog(
    options: Readonly<{
      title: string;
      buttonLabel: string;
      properties: readonly ('openDirectory' | 'securityScopedBookmarks')[];
    }>,
  ): Promise<
    Readonly<{ canceled: boolean; filePaths: readonly string[]; bookmarks?: readonly string[] }>
  >;
}

/**
 * Runs only from an explicit Main-owned user action. The chosen pathname is
 * deliberately used only to validate the native-picker response shape; it is
 * neither persisted nor returned to the caller.
 */
export async function selectExistingDshHomeFromMain(input: {
  accountId: string;
  picker: DshExistingHomePicker;
  store: DshExistingHomeSettingsStore;
  /**
   * The native picker awaits user input. Recheck a captured Main account scope
   * before interpreting its result so an account transition cannot commit an
   * authorization choice into a now-inactive account.
   */
  isAccountCurrent?: () => boolean;
}): Promise<DshExistingHomeProjection> {
  const selection = await input.picker.showOpenDialog({
    title: 'Choose existing DSH Home',
    buttonLabel: 'Use this DSH Home',
    properties: ['openDirectory', 'securityScopedBookmarks'],
  });
  if (input.isAccountCurrent && !input.isAccountCurrent()) {
    throw new Error('DSH existing Home account changed while choosing a directory');
  }
  if (selection.canceled) return input.store.getProjection(input.accountId);
  if (
    selection.filePaths.length !== 1 ||
    !path.isAbsolute(selection.filePaths[0]!) ||
    selection.bookmarks?.length !== 1 ||
    typeof selection.bookmarks[0] !== 'string'
  ) {
    throw new Error(
      'DSH existing Home picker did not return one security-scoped directory bookmark',
    );
  }
  return input.store.selectExistingHome(input.accountId, selection.bookmarks[0]);
}
