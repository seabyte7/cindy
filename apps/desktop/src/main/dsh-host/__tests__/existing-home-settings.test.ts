import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDshExistingHomeSettingsStore,
  selectExistingDshHomeFromMain,
} from '../existing-home-settings.js';

const roots: string[] = [];
const BOOKMARK = Buffer.from('dsh-existing-home-fixture').toString('base64');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'cindy-dsh-existing-home-'));
  roots.push(value);
  return value;
}

function safeStorage() {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => {
      const sealed = value.toString('utf8');
      if (!sealed.startsWith('sealed:')) throw new Error('fixture decrypt failure');
      return sealed.slice('sealed:'.length);
    }),
  };
}

describe('DSH existing Home settings', () => {
  it('keeps the default managed mode implicit and does not probe secure storage', () => {
    const userData = root();
    const storage = safeStorage();
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: storage,
    });

    expect(store.getProjection('account-a')).toEqual({ mode: 'cindy-managed', status: 'default' });
    expect(store.readLaunchSelection('account-a')).toEqual({ mode: 'cindy-managed' });
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(existsSync(join(userData, 'dsh-home-overrides'))).toBe(false);
  });

  it('persists only an encrypted opaque bookmark reference and never a selected pathname', () => {
    const userData = root();
    const selectedHome = join(root(), 'selected-dsh-home');
    mkdirSync(selectedHome);
    const storage = safeStorage();
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: storage,
    });

    expect(store.selectExistingHome('account-a', BOOKMARK)).toEqual({
      mode: 'existing-dsh-home',
      status: 'configured',
    });
    const index = readFileSync(join(userData, 'dsh-home-overrides', 'index.json'), 'utf8');
    expect(index).toContain('existing-dsh-home');
    expect(index).not.toContain(BOOKMARK);
    expect(index).not.toContain(selectedHome);
    const bookmarkDirectory = join(userData, 'dsh-home-overrides', 'bookmarks');
    const stored = readFileSync(
      join(bookmarkDirectory, requireSingleFile(bookmarkDirectory)),
      'utf8',
    );
    expect(stored).not.toContain(BOOKMARK);
    expect(Buffer.from(stored, 'base64').toString('utf8')).toMatch(/^sealed:/);
    expect(store.getProjection('account-a')).toEqual({
      mode: 'existing-dsh-home',
      status: 'configured',
    });
    expect(store.readLaunchSelection('account-a')).toEqual({
      mode: 'existing-dsh-home',
      bookmark: BOOKMARK,
    });
  });

  it('keeps account selections isolated and fails closed when the protected reference is missing', () => {
    const userData = root();
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: safeStorage(),
    });
    store.selectExistingHome('account-a', BOOKMARK);

    expect(store.getProjection('account-b')).toEqual({ mode: 'cindy-managed', status: 'default' });
    expect(store.readLaunchSelection('account-b')).toEqual({ mode: 'cindy-managed' });
    const directory = join(userData, 'dsh-home-overrides', 'bookmarks');
    rmSync(join(directory, requireSingleFile(directory)));
    expect(store.getProjection('account-a')).toEqual({
      mode: 'existing-dsh-home',
      status: 'unavailable',
    });
    expect(() => store.readLaunchSelection('account-a')).toThrow('bookmark is unavailable');
  });

  it('resets only Cindy-owned encrypted material and never touches a selected DSH Home', () => {
    const userData = root();
    const selectedHome = join(root(), 'selected-dsh-home');
    mkdirSync(selectedHome);
    const sentinel = join(selectedHome, 'native-profile-sentinel');
    writeFileSync(sentinel, 'keep');
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: safeStorage(),
    });
    store.selectExistingHome('account-a', BOOKMARK);
    const directory = join(userData, 'dsh-home-overrides', 'bookmarks');
    const reference = requireSingleFile(directory);

    expect(store.reset('account-a')).toEqual({ mode: 'cindy-managed', status: 'default' });
    expect(existsSync(join(directory, reference))).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
  });

  it('accepts a Main-owned native picker result without returning or persisting its path', async () => {
    const userData = root();
    const selectedHome = join(root(), 'selected-dsh-home');
    mkdirSync(selectedHome);
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: safeStorage(),
    });
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [selectedHome],
      bookmarks: [BOOKMARK],
    }));

    await expect(
      selectExistingDshHomeFromMain({ accountId: 'account-a', picker: { showOpenDialog }, store }),
    ).resolves.toEqual({
      mode: 'existing-dsh-home',
      status: 'configured',
    });
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Choose existing DSH Home',
      buttonLabel: 'Use this DSH Home',
      properties: ['openDirectory', 'securityScopedBookmarks'],
    });
    expect(JSON.stringify(store.getProjection('account-a'))).not.toContain(selectedHome);
    const persisted = [
      readFileSync(join(userData, 'dsh-home-overrides', 'index.json'), 'utf8'),
      readFileSync(
        join(
          userData,
          'dsh-home-overrides',
          'bookmarks',
          requireSingleFile(join(userData, 'dsh-home-overrides', 'bookmarks')),
        ),
        'utf8',
      ),
    ].join('\n');
    expect(persisted).not.toContain(selectedHome);
  });

  it('drops a native picker result when the Main account changes while it is open', async () => {
    const userData = root();
    const selectedHome = join(root(), 'selected-dsh-home');
    mkdirSync(selectedHome);
    const store = createDshExistingHomeSettingsStore({
      userDataPath: userData,
      safeStorage: safeStorage(),
    });
    let current = true;

    await expect(
      selectExistingDshHomeFromMain({
        accountId: 'account-a',
        picker: {
          showOpenDialog: async () => {
            current = false;
            return { canceled: false, filePaths: [selectedHome], bookmarks: [BOOKMARK] };
          },
        },
        store,
        isAccountCurrent: () => current,
      }),
    ).rejects.toThrow('account changed');
    expect(store.getProjection('account-a')).toEqual({ mode: 'cindy-managed', status: 'default' });
  });
});

function requireSingleFile(directory: string): string {
  const files = readdirSync(directory);
  expect(files).toHaveLength(1);
  return files[0]!;
}
