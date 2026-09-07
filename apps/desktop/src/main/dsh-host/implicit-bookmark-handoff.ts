/**
 * The sole Node-side encoding for the fixed Helper's F7 private descriptor.
 *
 * Input is an implicit bookmark created in Cindy Main from a persistent
 * app-scoped bookmark. It is intentionally neither a pathname nor a
 * persistent source bookmark; this frame crosses only the spawn-time fd 3
 * pipe and is never serialized, logged, or exposed through IPC.
 */

export const DSH_IMPLICIT_BOOKMARK_DESCRIPTOR_FD = 3;
export const DSH_IMPLICIT_BOOKMARK_MAX_BYTES = 1024 * 1024;

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface DshImplicitBookmarkHandoff {
  readonly kind: 'dsh-existing-home-implicit-bookmark';
  readonly bookmark: string;
}

function assertImplicitBookmark(bookmark: string): Buffer {
  if (
    !bookmark ||
    bookmark.length > DSH_IMPLICIT_BOOKMARK_MAX_BYTES ||
    !BASE64_RE.test(bookmark)
  ) {
    throw new Error('DSH implicit bookmark handoff is invalid');
  }
  const bytes = Buffer.from(bookmark, 'base64');
  if (bytes.length === 0 || bytes.length > DSH_IMPLICIT_BOOKMARK_MAX_BYTES) {
    throw new Error('DSH implicit bookmark handoff is invalid');
  }
  // Do not normalize a transport value. The native Helper reads ASCII base64
  // byte-for-byte, so accepting a string that decodes differently would make
  // this a second, undocumented descriptor grammar.
  if (bytes.toString('base64') !== bookmark) {
    throw new Error('DSH implicit bookmark handoff is invalid');
  }
  return Buffer.from(bookmark, 'ascii');
}

/** Length-prefixed ASCII base64 plus EOF; native code accepts no trailing bytes. */
export function encodeDshImplicitBookmarkHandoff(input: DshImplicitBookmarkHandoff): Buffer {
  if (input.kind !== 'dsh-existing-home-implicit-bookmark') {
    throw new Error('DSH implicit bookmark handoff is invalid');
  }
  const bookmark = assertImplicitBookmark(input.bookmark);
  const frame = Buffer.allocUnsafe(4 + bookmark.length);
  frame.writeUInt32BE(bookmark.length, 0);
  bookmark.copy(frame, 4);
  return frame;
}
