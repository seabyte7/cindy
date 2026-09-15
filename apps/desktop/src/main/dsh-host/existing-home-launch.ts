/**
 * Main-only launch authorization for a user-selected existing DSH Home.
 *
 * The protected persistent bookmark is decrypted only long enough to create
 * a fresh implicit bookmark.  The returned launch value contains no pathname
 * and retains only a non-reversible digest to invalidate a bridge when the
 * user switches or resets the selection.
 */

import { createHash } from 'node:crypto';

import type { DshImplicitBookmarkHandoff } from './implicit-bookmark-handoff.js';
import type { DshExistingHomeSettingsStore } from './existing-home-settings.js';
import type { DshHomeMode } from './scope.js';

export interface DshExistingHomeLaunch {
  readonly homeMode: DshHomeMode;
  readonly implicitHomeBookmark?: DshImplicitBookmarkHandoff;
  /** Fail closed before a new bridge operation if the stored choice changed. */
  assertStillCurrent(): void;
}

function bookmarkDigest(bookmark: string): string {
  return createHash('sha256').update(bookmark).digest('hex');
}

/**
 * Resolves the account's explicit selection inside Cindy Main.  The callback
 * must convert the persistent bookmark in the same process; it must never be
 * an IPC or generic host boundary.
 */
export function resolveDshExistingHomeLaunch(input: {
  accountId: string;
  store: DshExistingHomeSettingsStore;
  createImplicitBookmark: (persistentBookmark: string) => DshImplicitBookmarkHandoff;
}): DshExistingHomeLaunch {
  const selection = input.store.readLaunchSelection(input.accountId);
  if (selection.mode === 'cindy-managed') {
    return Object.freeze({
      homeMode: 'cindy-managed',
      assertStillCurrent: () => {
        if (input.store.readLaunchSelection(input.accountId).mode !== 'cindy-managed') {
          throw new Error('DSH Home selection is no longer current');
        }
      },
    });
  }

  const expectedDigest = bookmarkDigest(selection.bookmark);
  const implicitHomeBookmark = input.createImplicitBookmark(selection.bookmark);
  return Object.freeze({
    homeMode: 'existing-dsh-home',
    implicitHomeBookmark,
    assertStillCurrent: () => {
      const current = input.store.readLaunchSelection(input.accountId);
      if (
        current.mode !== 'existing-dsh-home' ||
        bookmarkDigest(current.bookmark) !== expectedDigest
      ) {
        throw new Error('DSH Home selection is no longer current');
      }
    },
  });
}
