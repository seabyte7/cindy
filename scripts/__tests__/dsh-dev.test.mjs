import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertDevelopmentDshCapsule,
  buildDshDevCommand,
  developmentDshCapsulePath,
  parseDshDevArgs,
} from '../dsh-dev.mjs';
import { devEnvPrefix } from '../restart-desktop-remote.mjs';

function writeJson(candidate, value) {
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, `${JSON.stringify(value)}\n`);
}

function createCapsuleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-dev-script-'));
  const capsule = developmentDshCapsulePath(root);
  writeJson(path.join(root, 'tools', 'dsh', 'macos-supervised-source-release.json'), {
    releaseId: 'dsh-test-release',
    runtime: { expectedVersion: '0.1.test' },
  });
  writeJson(path.join(capsule, 'Contents', 'Helpers', 'Cindy DSH Supervisor.app', 'Contents', 'Resources', 'cindy-dsh-supervised-runtime.json'), {
    target: 'darwin-arm64',
    releaseId: 'dsh-test-release',
    expectedVersion: '0.1.test',
  });
  fs.mkdirSync(path.join(capsule, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(capsule, 'Contents', 'Resources', 'cindy-dsh-main-bookmark-bridge.node'), 'fixture');
  return { root, capsule };
}

test('dsh:dev always selects the persistent named dsh-dev sandbox', () => {
  assert.deepEqual(parseDshDevArgs(['--region=global']), {
    region: 'global',
    restartArgs: ['--region=global', '--isolated=dsh-dev'],
  });
  assert.deepEqual(parseDshDevArgs(['--region', 'cn', '--local', '--isolated-auth']), {
    region: 'cn',
    restartArgs: ['--region=cn', '--isolated=dsh-dev', '--local', '--isolated-auth'],
  });
  assert.throws(() => parseDshDevArgs(['--shared']), /usage:/);
  assert.throws(() => parseDshDevArgs(['--isolated=other']), /usage:/);
});

test('dsh:dev enables only the fixed Main-side development capsule flag', () => {
  const command = buildDshDevCommand(['--region=global'], { CINDY_AUTH_REGION: 'cn', UNRELATED: 'keep' });
  assert.equal(command.env.XDT_DSH_DEVELOPMENT_CAPSULE, '1');
  assert.equal(command.env.UNRELATED, 'keep');
  assert.deepEqual(command.args.slice(1), ['--region=global', '--isolated=dsh-dev']);
});

test('the remote restart preserves the Main-only development capsule flag into its terminal child', () => {
  assert.match(
    devEnvPrefix({ XDT_DSH_DEVELOPMENT_CAPSULE: '1' }, 'darwin'),
    /XDT_DSH_DEVELOPMENT_CAPSULE='1'/,
  );
});

test('development capsule must match the checked-in pin and be signature-verified', () => {
  const { root, capsule } = createCapsuleFixture();
  try {
    const calls = [];
    const result = assertDevelopmentDshCapsule(root, (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: '', stderr: '' };
    }, { platform: 'darwin', arch: 'arm64' });
    assert.equal(result.capsule, fs.realpathSync(capsule));
    assert.deepEqual(calls, [['/usr/bin/codesign', ['--verify', '--deep', '--strict', fs.realpathSync(capsule)]]]);
    writeJson(path.join(capsule, 'Contents', 'Helpers', 'Cindy DSH Supervisor.app', 'Contents', 'Resources', 'cindy-dsh-supervised-runtime.json'), {
      target: 'darwin-arm64', releaseId: 'wrong', expectedVersion: '0.1.test',
    });
    assert.throws(() => assertDevelopmentDshCapsule(
      root,
      () => ({ status: 0 }),
      { platform: 'darwin', arch: 'arm64' },
    ), /does not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
