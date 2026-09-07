/**
 * Loads the signed in-process native converter for the F7 private bookmark
 * handoff. This runs only in Cindy Main: the persistent app-scoped source
 * bookmark never reaches a Helper, Renderer, ordinary IPC or persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  encodeDshImplicitBookmarkHandoff,
  type DshImplicitBookmarkHandoff,
} from './implicit-bookmark-handoff.js';

const MAIN_BOOKMARK_BRIDGE_NAME = 'cindy-dsh-main-bookmark-bridge.node';

export interface DshMainBookmarkNativeBridge {
  createImplicitBookmark(persistentBookmark: string): string;
}

function assertRealResourcesDirectory(resourcesPath: string): string {
  if (!path.isAbsolute(resourcesPath)) {
    throw new Error('DSH Main bookmark bridge resources path must be absolute');
  }
  const stat = fs.lstatSync(resourcesPath);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.basename(resourcesPath) !== 'Resources') {
    throw new Error('DSH Main bookmark bridge resources path is invalid');
  }
  return fs.realpathSync(resourcesPath);
}

function assertSignedBridgeFile(resourcesPath: string): string {
  const candidate = path.join(resourcesPath, MAIN_BOOKMARK_BRIDGE_NAME);
  if (path.dirname(candidate) !== resourcesPath) {
    throw new Error('DSH Main bookmark bridge escaped Resources');
  }
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(candidate) !== candidate) {
    throw new Error('DSH Main bookmark bridge is unavailable');
  }
  return candidate;
}

function assertNativeBridge(value: unknown): DshMainBookmarkNativeBridge {
  if (!value || typeof value !== 'object' ||
      typeof (value as { createImplicitBookmark?: unknown }).createImplicitBookmark !== 'function') {
    throw new Error('DSH Main bookmark bridge is invalid');
  }
  return value as DshMainBookmarkNativeBridge;
}

/** Loads only the fixed native module inside a packaged darwin-arm64 Cindy App. */
export function loadMacosDshMainBookmarkBridge(input: {
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): DshMainBookmarkNativeBridge {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`DSH Main bookmark bridge is unavailable on ${platform}-${arch}`);
  }
  const resources = assertRealResourcesDirectory(input.resourcesPath);
  const bridgePath = assertSignedBridgeFile(resources);
  try {
    return assertNativeBridge(createRequire(import.meta.url)(bridgePath));
  } catch {
    throw new Error('DSH Main bookmark bridge is unavailable');
  }
}

/**
 * Converts only at launch time. The returned opaque value is valid only as
 * the transport's fd-3 handoff input and is never exposed to callers outside
 * Desktop Main.
 */
export function createDshImplicitBookmarkHandoff(input: {
  persistentBookmark: string;
  bridge: DshMainBookmarkNativeBridge;
}): DshImplicitBookmarkHandoff {
  const bookmark = input.bridge.createImplicitBookmark(input.persistentBookmark);
  const handoff: DshImplicitBookmarkHandoff = {
    kind: 'dsh-existing-home-implicit-bookmark',
    bookmark,
  };
  // Reuse the exact transport parser before a native child is even spawned.
  encodeDshImplicitBookmarkHandoff(handoff);
  return Object.freeze(handoff);
}
