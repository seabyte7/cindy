import assert from 'node:assert/strict';
import test from 'node:test';

import { isPinnedPkgDlx } from '../..//tools/dsh/pnpm-dsh-build-wrapper.mjs';

test('DSH source-build wrapper intercepts only the exact pinned pkg dlx invocation', () => {
  assert.equal(isPinnedPkgDlx(['dlx', '@yao-pkg/pkg@6.21.0', 'input']), true);
  assert.equal(isPinnedPkgDlx(['dlx', '@yao-pkg/pkg@6.21.1', 'input']), false);
  assert.equal(isPinnedPkgDlx(['exec', '@yao-pkg/pkg@6.21.0']), false);
});
