import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  REQUIRED_BRIDGE_OPERATIONS,
  closeEvidenceProcessTree,
  createBoundedNdjsonFrameDecoder,
  evaluateCindyBridgeGate,
  findRedactionViolations,
  inspectWheelArchive,
  safeArchivePath,
  validateArchiveEntries,
  validateEvidencePacket,
} from '../dsh-native-host-gate.mjs';

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const contents = Buffer.from(entry.contents ?? '');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, contents]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

function withWheel(bytes, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gate-wheel-test-'));
  const wheel = path.join(directory, 'fixture.whl');
  fs.writeFileSync(wheel, bytes);
  try {
    return callback(wheel);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function waitForCondition(condition, description, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      try {
        if (condition()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${description}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function waitForChildExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for the native DSH supervisor to exit'));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function packet(overrides = {}) {
  const base = {
    schemaVersion: 1,
    release: {
      packageName: 'deepseek-harness-runtime-bin',
      pep440Version: '0.1.2a3',
      wheel: {
        filename: 'runtime.whl',
        url: 'https://files.pythonhosted.org/packages/runtime.whl',
        sha256: 'a'.repeat(64),
        bytes: 1,
      },
      source: {
        repository: 'https://github.com/deepseek-ai/deepseek-harness',
        tag: 'dsh-v0.1.2-alpha.3',
        wheelToSourceBinding: 'unverified',
      },
    },
    runtime: {
      platform: 'darwin-arm64',
      executable: 'runtime/dsh',
      executableVersion: '0.1.2-alpha.3',
      requiredSidecars: ['runtime/dsh-rg'],
      expectedFiles: ['runtime/dsh', 'runtime/dsh-rg'],
      allowedTopLevelDirectories: ['runtime'],
      treeManifestSha256: 'b'.repeat(64),
      sdkHandshake: { provider: 'deepseek-official', model: 'deepseek-v4-flash', serverName: 'sdk', serverVersion: '0.0.1' },
      acpHandshake: {
        protocolVersion: 1,
        agentName: 'deepseek-harness-acp',
        agentVersion: '0.0.1',
        requiredSessionCapabilities: ['close', 'list', 'resume'],
      },
    },
    cindyBridge: {
      availability: 'not-probed',
      contractVersion: '1',
      runtimeProtocol: 'acp-v1',
      mainOwned: false,
      operations: Object.fromEntries(REQUIRED_BRIDGE_OPERATIONS.map((operation) => [operation, 'not-probed'])),
    },
  };
  return { ...base, ...overrides };
}

test('valid packet can be structurally incomplete without being malformed', () => {
  assert.deepEqual(validateEvidencePacket(packet()), { ok: true, errors: [] });
});

test('packet validation rejects local paths and credential values', () => {
  const evidence = packet();
  evidence.release.wheel.url = '/Users/example/private.whl';
  evidence.cindyBridge.note = 'Authorization: Bearer secret-value';
  const result = validateEvidencePacket(evidence);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /absolute local path/);
  assert.match(result.errors.join('\n'), /credential pattern/);
  assert.deepEqual(findRedactionViolations({ hash: 'a'.repeat(64) }), []);
});

test('archive shape requires the exact reviewed tree, executable, and sidecars', () => {
  const runtime = packet().runtime;
  const pass = validateArchiveEntries([
    { name: 'runtime/dsh', isDirectory: false },
    { name: 'runtime/dsh-rg', isDirectory: false },
  ], runtime);
  assert.equal(pass.ok, true);

  const traversal = validateArchiveEntries([{ name: '../escape', isDirectory: false }], runtime);
  assert.equal(traversal.ok, false);
  assert.match(traversal.errors.join('\n'), /unexpected top-level/);

  const missingSidecar = validateArchiveEntries([{ name: 'runtime/dsh', isDirectory: false }], runtime);
  assert.equal(missingSidecar.ok, false);
  assert.match(missingSidecar.errors.join('\n'), /missing required sidecar/);
});

test('archive paths reject traversal, absolute paths, separators from another platform, and NUL', () => {
  assert.equal(safeArchivePath('runtime/dsh'), true);
  assert.equal(safeArchivePath('runtime/'), true);
  for (const unsafe of ['../dsh', '/tmp/dsh', 'runtime\\dsh', 'runtime/../dsh', 'runtime/\0dsh']) {
    assert.equal(safeArchivePath(unsafe), false, unsafe);
  }
});

test('NDJSON decoder enforces its byte ceiling before decoding or dispatching an unterminated frame', () => {
  const lines = [];
  const overflow = [];
  const decoder = createBoundedNdjsonFrameDecoder({
    maxLineBytes: 8,
    onLine: (line) => lines.push(line),
    onOverflow: (observedBytes) => overflow.push(observedBytes),
  });
  assert.equal(decoder.push(Buffer.from('{"a"')) , true);
  assert.equal(decoder.push(Buffer.from(':1234')), false);
  assert.deepEqual(lines, []);
  assert.deepEqual(overflow, [9]);
  assert.equal(decoder.push(Buffer.from('{}\n')), false);
  assert.deepEqual(lines, []);
});

test('NDJSON decoder accepts split CRLF records after bounded bytes are complete', () => {
  const lines = [];
  const decoder = createBoundedNdjsonFrameDecoder({
    maxLineBytes: 64,
    onLine: (line) => lines.push(line),
    onOverflow: () => assert.fail('unexpected overflow'),
  });
  assert.equal(decoder.push(Buffer.from('{"jsonrpc"')), true);
  assert.equal(decoder.push(Buffer.from(':"2.0"}\r\n{}\n')), true);
  assert.deepEqual(lines, ['{"jsonrpc":"2.0"}', '{}']);
});

test('NDJSON decoder rejects malformed UTF-8 without dispatching a normalized protocol line', () => {
  const lines = [];
  const invalidUtf8 = [];
  const decoder = createBoundedNdjsonFrameDecoder({
    maxLineBytes: 64,
    onLine: (line) => lines.push(line),
    onOverflow: () => assert.fail('unexpected overflow'),
    onInvalidUtf8: (observedBytes) => invalidUtf8.push(observedBytes),
  });
  assert.equal(decoder.push(Buffer.from([0x7b, 0xff, 0x7d, 0x0a])), false);
  assert.deepEqual(lines, []);
  assert.deepEqual(invalidUtf8, [3]);
  assert.equal(decoder.push(Buffer.from('{}\n')), false);
});

test('POSIX evidence cleanup reaches a descendant after its direct root exits', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', [
    "const { spawn } = require('node:child_process')",
    "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' }).unref()",
  ].join('; ')], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await closeEvidenceProcessTree(child, 100);
  assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' });
});

test('macOS DSH Helper grants network client only to the supervisor, with Main-owned policy still required', () => {
  const supervisorEntitlements = fs.readFileSync(
    path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.entitlements'),
    'utf8',
  );
  const runtimeEntitlements = fs.readFileSync(
    path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-runtime-inherit.entitlements'),
    'utf8',
  );
  assert.match(supervisorEntitlements, /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/);
  assert.match(supervisorEntitlements, /<key>com\.apple\.security\.network\.client<\/key>\s*<true\/>/);
  assert.doesNotMatch(runtimeEntitlements, /com\.apple\.security\.network\.client/);
  assert.match(runtimeEntitlements, /<key>com\.apple\.security\.inherit<\/key>\s*<true\/>/);
});

test('macOS native DSH supervisor drains a surviving runtime process group after its root exits', { skip: process.platform !== 'darwin' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-native-supervisor-test-'));
  const bundle = path.join(root, 'Cindy DSH Test.app');
  const macosDirectory = path.join(bundle, 'Contents', 'MacOS');
  const runtimeDirectory = path.join(bundle, 'Contents', 'Resources', 'dsh-runtime');
  const nativeAddonCache = path.join(bundle, 'Contents', 'Resources', 'dsh-native-addons');
  const pkgNativeCache = path.join(bundle, 'Contents', 'Resources', 'dsh-pkg-native-cache');
  const home = path.join(root, 'home');
  const temporary = path.join(root, 'temporary');
  const supervisor = path.join(macosDirectory, 'cindy-dsh-sandbox-supervisor');
  const runtime = path.join(runtimeDirectory, 'fixture-dsh');
  const descendantPidPath = path.join(home, 'descendant.pid');
  const ambientEnvironmentResultPath = path.join(home, 'ambient-environment-result');
  let descendantPid = null;

  try {
    fs.mkdirSync(macosDirectory, { recursive: true });
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.mkdirSync(nativeAddonCache, { recursive: true });
    fs.mkdirSync(pkgNativeCache, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(temporary, { recursive: true });
    const compile = spawnSync('xcrun', [
      'clang',
      '-std=c17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wpedantic',
      '-DCINDY_DSH_RUNTIME_EXECUTABLE="fixture-dsh"',
      path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.c'),
      path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-implicit-bookmark.m'),
      '-framework', 'Foundation',
      '-fobjc-arc',
      '-o',
      supervisor,
    ], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    fs.writeFileSync(runtime, [
      '#!/bin/sh',
      'if [ -n "${UNTRUSTED_ENV+x}" ] || [ -n "${CINDY_DSH_UNTRUSTED+x}" ]; then printf leaked > "$DSH_HOME/ambient-environment-result"; else printf stripped > "$DSH_HOME/ambient-environment-result"; fi',
      `if [ "$NARB_NATIVE_CACHE_DIR" != ${JSON.stringify(fs.realpathSync(nativeAddonCache))} ]; then printf bad-cache > "$DSH_HOME/ambient-environment-result"; fi`,
      'if [ "$CINDY_DSH_SEALED_NATIVE_CACHE" != 1 ]; then printf bad-sealed-cache > "$DSH_HOME/ambient-environment-result"; fi',
      `if [ "$CINDY_DSH_SEALED_PKG_CACHE_DIR" != ${JSON.stringify(fs.realpathSync(pkgNativeCache))} ]; then printf bad-pkg-cache > "$DSH_HOME/ambient-environment-result"; fi`,
      'if [ "$DSH_TELEMETRY_DISABLED" != 1 ]; then printf bad-telemetry > "$DSH_HOME/ambient-environment-result"; fi',
      '(trap "" TERM; while :; do :; done) &',
      'printf "%s" "$!" > "$DSH_HOME/descendant.pid"',
      // Do not let /bin/sh's job-exit policy wait for the background fixture:
      // replace the direct runtime root, leaving only its same-group child.
      'exec /usr/bin/true',
      '',
    ].join('\n'), { mode: 0o700 });
    fs.chmodSync(runtime, 0o700);

    const launched = spawn(supervisor, ['--profile', 'acp'], {
      cwd: root,
      env: {
        HOME: home,
        DSH_HOME: home,
        TMPDIR: temporary,
        PATH: '/usr/bin:/bin',
        DSH_TELEMETRY_DISABLED: '1',
        UNTRUSTED_ENV: 'must-not-reach-the-runtime',
        CINDY_DSH_UNTRUSTED: 'must-not-reach-the-runtime',
        NARB_NATIVE_CACHE_DIR: path.join(root, 'untrusted-native-addon-cache'),
        CINDY_DSH_SEALED_NATIVE_CACHE: '0',
        CINDY_DSH_SEALED_PKG_CACHE_DIR: path.join(root, 'untrusted-pkg-native-cache'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    launched.stderr.setEncoding('utf8');
    launched.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    await waitForCondition(() => fs.existsSync(descendantPidPath), 'the runtime descendant pid fixture');
    descendantPid = Number.parseInt(fs.readFileSync(descendantPidPath, 'utf8'), 10);
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
    const exited = await waitForChildExit(launched);
    assert.deepEqual(exited, { code: 0, signal: null }, stderr);
    assert.equal(fs.readFileSync(ambientEnvironmentResultPath, 'utf8'), 'stripped');
    await waitForCondition(() => {
      try {
        process.kill(descendantPid, 0);
        return false;
      } catch (error) {
        if (error?.code === 'ESRCH') return true;
        throw error;
      }
    }, 'the native supervisor to reap the runtime descendant');
  } finally {
    if (descendantPid !== null) {
      try {
        process.kill(descendantPid, 'SIGKILL');
      } catch {
        // The passing case has already reaped this exact local fixture pid.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS native DSH supervisor escalates an uncooperative runtime group before its own TERM exit', { skip: process.platform !== 'darwin' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-native-supervisor-term-test-'));
  const bundle = path.join(root, 'Cindy DSH Test.app');
  const macosDirectory = path.join(bundle, 'Contents', 'MacOS');
  const runtimeDirectory = path.join(bundle, 'Contents', 'Resources', 'dsh-runtime');
  const nativeAddonCache = path.join(bundle, 'Contents', 'Resources', 'dsh-native-addons');
  const pkgNativeCache = path.join(bundle, 'Contents', 'Resources', 'dsh-pkg-native-cache');
  const home = path.join(root, 'home');
  const temporary = path.join(root, 'temporary');
  const supervisor = path.join(macosDirectory, 'cindy-dsh-sandbox-supervisor');
  const runtime = path.join(runtimeDirectory, 'fixture-dsh');
  const runtimeRootPidPath = path.join(home, 'runtime-root.pid');
  const descendantPidPath = path.join(home, 'descendant.pid');
  let launched = null;
  let runtimeRootPid = null;
  let descendantPid = null;

  try {
    fs.mkdirSync(macosDirectory, { recursive: true });
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.mkdirSync(nativeAddonCache, { recursive: true });
    fs.mkdirSync(pkgNativeCache, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(temporary, { recursive: true });
    const compile = spawnSync('xcrun', [
      'clang',
      '-std=c17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wpedantic',
      '-DCINDY_DSH_RUNTIME_EXECUTABLE="fixture-dsh"',
      path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.c'),
      path.resolve(process.cwd(), 'apps/desktop/native/dsh/macos-dsh-implicit-bookmark.m'),
      '-framework', 'Foundation',
      '-fobjc-arc',
      '-o',
      supervisor,
    ], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    fs.writeFileSync(runtime, [
      '#!/bin/sh',
      'printf "%s" "$$" > "$DSH_HOME/runtime-root.pid"',
      '(trap "" TERM; while :; do :; done) &',
      'printf "%s" "$!" > "$DSH_HOME/descendant.pid"',
      'trap "" TERM',
      'while :; do :; done',
      '',
    ].join('\n'), { mode: 0o700 });
    fs.chmodSync(runtime, 0o700);

    launched = spawn(supervisor, ['--profile', 'acp'], {
      cwd: root,
      env: {
        HOME: home,
        DSH_HOME: home,
        TMPDIR: temporary,
        PATH: '/usr/bin:/bin',
        DSH_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    launched.stderr.setEncoding('utf8');
    launched.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    await waitForCondition(
      () => fs.existsSync(runtimeRootPidPath) && fs.existsSync(descendantPidPath),
      'the uncooperative runtime pid fixtures',
    );
    runtimeRootPid = Number.parseInt(fs.readFileSync(runtimeRootPidPath, 'utf8'), 10);
    descendantPid = Number.parseInt(fs.readFileSync(descendantPidPath, 'utf8'), 10);
    assert.ok(Number.isSafeInteger(runtimeRootPid) && runtimeRootPid > 0);
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);

    assert.equal(launched.kill('SIGTERM'), true);
    const exited = await waitForChildExit(launched);
    assert.deepEqual(exited, { code: 128 + 15, signal: null }, stderr);
    for (const processId of [runtimeRootPid, descendantPid]) {
      await waitForCondition(() => {
        try {
          process.kill(processId, 0);
          return false;
        } catch (error) {
          if (error?.code === 'ESRCH') return true;
          throw error;
        }
      }, `the native supervisor to reap runtime fixture ${processId}`);
    }
  } finally {
    try {
      launched?.kill('SIGKILL');
    } catch {
      // The passing case has already exited the supervisor.
    }
    for (const processId of [runtimeRootPid, descendantPid]) {
      if (processId === null) continue;
      try {
        process.kill(processId, 'SIGKILL');
      } catch {
        // The passing case has already reaped this exact local fixture pid.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wheel parser accepts a regular entry and rejects traversal and symlink entries before extraction', () => {
  withWheel(storedZip([{ name: 'runtime/dsh', contents: 'dsh' }]), (wheel) => {
    assert.deepEqual(inspectWheelArchive(wheel).map((entry) => entry.name), ['runtime/dsh']);
  });
  withWheel(storedZip([{ name: '../escape', contents: 'nope' }]), (wheel) => {
    assert.throws(() => inspectWheelArchive(wheel), /unsafe or duplicate/);
  });
  withWheel(storedZip([{ name: 'runtime/link', contents: 'target', mode: 0o120777 }]), (wheel) => {
    assert.throws(() => inspectWheelArchive(wheel), /unsupported file type/);
  });
});

test('Cindy bridge gate never promotes SDK-only evidence', () => {
  const checks = { version: '0.1.2-alpha.3', sdkLifecycle: {}, sdkEof: {}, sdkSigterm: {}, acpLifecycle: {} };
  const result = evaluateCindyBridgeGate(packet(), checks);
  assert.equal(result.status, 'INCOMPLETE');
  assert.match(result.reasons.join('\n'), /Cindy bridge probe/);
});

test('Cindy bridge gate requires every operation and a verified source binding before PASS', () => {
  const evidence = packet();
  evidence.release.source.wheelToSourceBinding = 'verified';
  evidence.cindyBridge = {
    availability: 'available',
    contractVersion: '1',
    runtimeProtocol: 'acp-v1',
    mainOwned: true,
    operations: Object.fromEntries(REQUIRED_BRIDGE_OPERATIONS.map((operation) => [operation, 'passed'])),
  };
  const checks = { version: '0.1.2-alpha.3', sdkLifecycle: {}, sdkEof: {}, sdkSigterm: {}, acpLifecycle: {} };
  assert.deepEqual(evaluateCindyBridgeGate(evidence, checks), { status: 'PASS', reasons: [] });
  evidence.cindyBridge.operations.cancel = 'failed';
  assert.deepEqual(evaluateCindyBridgeGate(evidence, checks), {
    status: 'FAIL',
    reasons: ['Cindy bridge cancel probe failed'],
  });
});
