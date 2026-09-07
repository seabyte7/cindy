import { describe, expect, it } from 'vitest';

import {
  DSH_IMPLICIT_BOOKMARK_DESCRIPTOR_FD,
  DSH_IMPLICIT_BOOKMARK_MAX_BYTES,
  encodeDshImplicitBookmarkHandoff,
} from '../implicit-bookmark-handoff.js';

const BOOKMARK = Buffer.from('implicit-bookmark-fixture', 'utf8').toString('base64');

describe('DSH implicit bookmark private descriptor', () => {
  it('uses only fd 3 and a single length-prefixed opaque base64 record', () => {
    const frame = encodeDshImplicitBookmarkHandoff({
      kind: 'dsh-existing-home-implicit-bookmark',
      bookmark: BOOKMARK,
    });

    expect(DSH_IMPLICIT_BOOKMARK_DESCRIPTOR_FD).toBe(3);
    expect(frame.readUInt32BE(0)).toBe(Buffer.byteLength(BOOKMARK, 'ascii'));
    expect(frame.subarray(4).toString('ascii')).toBe(BOOKMARK);
  });

  it.each([
    '',
    'not base64!',
    `${BOOKMARK}\n`,
    Buffer.from('implicit-bookmark-fixture').toString('base64').replace(/=$/, ''),
  ])('rejects malformed input before spawn: %j', (bookmark) => {
    expect(() => encodeDshImplicitBookmarkHandoff({
      kind: 'dsh-existing-home-implicit-bookmark',
      bookmark,
    })).toThrow('implicit bookmark handoff is invalid');
  });

  it('rejects an oversized descriptor before it allocates the native frame', () => {
    const oversized = Buffer.alloc(DSH_IMPLICIT_BOOKMARK_MAX_BYTES + 1, 0x61).toString('base64');
    expect(() => encodeDshImplicitBookmarkHandoff({
      kind: 'dsh-existing-home-implicit-bookmark',
      bookmark: oversized,
    })).toThrow('implicit bookmark handoff is invalid');
  });
});
