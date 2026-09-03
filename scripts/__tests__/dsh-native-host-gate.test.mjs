import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
