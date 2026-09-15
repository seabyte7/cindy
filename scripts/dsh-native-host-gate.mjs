#!/usr/bin/env node
/**
 * F0 release-evidence verifier for DeepSeek Harness.
 *
 * This is deliberately an admission tool, not a DSH installer or production
 * launcher.  It accepts a locally supplied, review-pinned wheel, validates
 * it without invoking Python/pip/npm/PATH discovery, extracts it only into a
 * unique temporary directory, and runs the release's SDK handshake there.
 *
 * A successful SDK handshake is evidence for the runtime package only. The
 * Cindy bridge policy below additionally proves the published ACP transport
 * and Cindy-owned command lifecycle; it deliberately does not wait for an
 * unrelated upstream "native Host" API.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export const REQUIRED_BRIDGE_OPERATIONS = Object.freeze([
  'create',
  'list',
  'resume',
  'follow',
  'prompt',
  'cancel',
  'close',
  'reconcile',
]);

const OPERATION_STATES = new Set(['passed', 'failed', 'not-probed']);
const BRIDGE_STATES = new Set(['available', 'unavailable', 'not-probed']);
const SECRET_PATTERNS = [
  /(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+\S+/i,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s<][^\s]*/i,
  /\b(?:sk|ds|ghp|gho)_[a-z0-9_-]{12,}\b/i,
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must be a non-empty string`);
    return null;
  }
  return value;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validateArchivePathList(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return;
  }
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !safeArchivePath(entry) || entry.endsWith('/') || seen.has(entry)) {
      errors.push(`${label} contains an invalid or duplicate archive path`);
      return;
    }
    seen.add(entry);
  }
}

/** Return every unredacted secret-looking scalar in a packet. */
export function findRedactionViolations(value, location = '$', out = []) {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        out.push(`${location} matches a credential pattern`);
        break;
      }
    }
    if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
      out.push(`${location} contains an absolute local path`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findRedactionViolations(entry, `${location}[${index}]`, out));
    return out;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      findRedactionViolations(entry, `${location}.${key}`, out);
    }
  }
  return out;
}

/**
 * Validate the checked-in, secret-free portion of an F0 packet.  This is kept
 * dependency-free so it can run before any DSH artifact is trusted.
 */
export function validateEvidencePacket(packet) {
  const errors = [];
  if (!isPlainObject(packet)) return { ok: false, errors: ['packet must be an object'] };
  if (packet.schemaVersion !== 1) errors.push('schemaVersion must be 1');

  const release = packet.release;
  if (!isPlainObject(release)) {
    errors.push('release must be an object');
  } else {
    asNonEmptyString(release.packageName, 'release.packageName', errors);
    asNonEmptyString(release.pep440Version, 'release.pep440Version', errors);
    if (!isPlainObject(release.wheel)) {
      errors.push('release.wheel must be an object');
    } else {
      asNonEmptyString(release.wheel.filename, 'release.wheel.filename', errors);
      asNonEmptyString(release.wheel.url, 'release.wheel.url', errors);
      if (!isSha256(release.wheel.sha256)) errors.push('release.wheel.sha256 must be SHA-256');
      if (!Number.isSafeInteger(release.wheel.bytes) || release.wheel.bytes <= 0) {
        errors.push('release.wheel.bytes must be a positive safe integer');
      }
    }
    if (!isPlainObject(release.source)) {
      errors.push('release.source must be an object');
    } else {
      asNonEmptyString(release.source.repository, 'release.source.repository', errors);
      asNonEmptyString(release.source.tag, 'release.source.tag', errors);
      if (!['verified', 'unverified'].includes(release.source.wheelToSourceBinding)) {
        errors.push('release.source.wheelToSourceBinding must be verified or unverified');
      }
    }
  }

  const runtime = packet.runtime;
  if (!isPlainObject(runtime)) {
    errors.push('runtime must be an object');
  } else {
    asNonEmptyString(runtime.platform, 'runtime.platform', errors);
    if (!safeArchivePath(runtime.executable) || runtime.executable.endsWith('/')) {
      errors.push('runtime.executable must be a safe archive file path');
    }
    asNonEmptyString(runtime.executableVersion, 'runtime.executableVersion', errors);
    validateArchivePathList(runtime.requiredSidecars, 'runtime.requiredSidecars', errors);
    validateArchivePathList(runtime.expectedFiles, 'runtime.expectedFiles', errors);
    if (!Array.isArray(runtime.allowedTopLevelDirectories) || runtime.allowedTopLevelDirectories.some((entry) =>
      typeof entry !== 'string' || !entry || entry.includes('/') || entry.includes('\\') || entry === '.' || entry === '..',
    )) {
      errors.push('runtime.allowedTopLevelDirectories must contain safe directory names');
    }
    if (!isSha256(runtime.treeManifestSha256)) {
      errors.push('runtime.treeManifestSha256 must be SHA-256');
    }
    if (!isPlainObject(runtime.sdkHandshake)) {
      errors.push('runtime.sdkHandshake must be an object');
    } else {
      for (const field of ['provider', 'model', 'serverName', 'serverVersion']) {
        asNonEmptyString(runtime.sdkHandshake[field], `runtime.sdkHandshake.${field}`, errors);
      }
    }
    if (!isPlainObject(runtime.acpHandshake)) {
      errors.push('runtime.acpHandshake must be an object');
    } else {
      if (!Number.isSafeInteger(runtime.acpHandshake.protocolVersion) || runtime.acpHandshake.protocolVersion < 1) {
        errors.push('runtime.acpHandshake.protocolVersion must be a positive safe integer');
      }
      for (const field of ['agentName', 'agentVersion']) {
        asNonEmptyString(runtime.acpHandshake[field], `runtime.acpHandshake.${field}`, errors);
      }
      if (!Array.isArray(runtime.acpHandshake.requiredSessionCapabilities)
        || runtime.acpHandshake.requiredSessionCapabilities.some((capability) => !['close', 'list', 'resume'].includes(capability))) {
        errors.push('runtime.acpHandshake.requiredSessionCapabilities is invalid');
      }
    }
  }

  const cindyBridge = packet.cindyBridge;
  if (!isPlainObject(cindyBridge)) {
    errors.push('cindyBridge must be an object');
  } else {
    if (!BRIDGE_STATES.has(cindyBridge.availability)) {
      errors.push('cindyBridge.availability is invalid');
    }
    asNonEmptyString(cindyBridge.contractVersion, 'cindyBridge.contractVersion', errors);
    asNonEmptyString(cindyBridge.runtimeProtocol, 'cindyBridge.runtimeProtocol', errors);
    if (typeof cindyBridge.mainOwned !== 'boolean') {
      errors.push('cindyBridge.mainOwned must be boolean');
    }
    if (!isPlainObject(cindyBridge.operations)) {
      errors.push('cindyBridge.operations must be an object');
    } else {
      for (const operation of REQUIRED_BRIDGE_OPERATIONS) {
        if (!OPERATION_STATES.has(cindyBridge.operations[operation])) {
          errors.push(`cindyBridge.operations.${operation} is invalid`);
        }
      }
    }
  }

  errors.push(...findRedactionViolations(packet));
  return { ok: errors.length === 0, errors };
}

function readAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, position);
  if (bytesRead !== length) throw new Error(`short archive read at byte ${position}`);
  return buffer;
}

export function safeArchivePath(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) return false;
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!normalized) return false;
  const pieces = normalized.split('/');
  return pieces.every((piece) => piece && piece !== '.' && piece !== '..');
}

/**
 * Read a normal (non-ZIP64) wheel's central directory without extracting it.
 * Any archive shape the parser cannot prove safe is rejected rather than
 * delegated to a platform unzip utility.
 */
export function inspectWheelArchive(wheelPath) {
  const stat = fs.statSync(wheelPath);
  if (!stat.isFile()) throw new Error('wheel must be a regular file');
  if (stat.size < 22) throw new Error('wheel is too small to be a ZIP archive');

  const fd = fs.openSync(wheelPath, 'r');
  try {
    const tailSize = Math.min(stat.size, 22 + ZIP_MAX_COMMENT_BYTES);
    const tailStart = stat.size - tailSize;
    const tail = readAt(fd, tailSize, tailStart);
    const marker = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const relativeEocd = tail.lastIndexOf(marker);
    if (relativeEocd < 0 || relativeEocd + 22 > tail.length) throw new Error('wheel has no ZIP end record');
    const eocd = tail.subarray(relativeEocd);
    const commentLength = eocd.readUInt16LE(20);
    if (relativeEocd + 22 + commentLength !== tail.length) throw new Error('wheel has trailing ZIP data');
    if (eocd.readUInt16LE(4) !== 0 || eocd.readUInt16LE(6) !== 0) throw new Error('multi-disk ZIP is unsupported');
    const entryCount = eocd.readUInt16LE(10);
    const centralSize = eocd.readUInt32LE(12);
    const centralOffset = eocd.readUInt32LE(16);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('ZIP64 wheel is unsupported until a reviewed parser is added');
    }
    if (centralOffset + centralSize > stat.size) throw new Error('wheel central directory is outside archive');
    const central = readAt(fd, centralSize, centralOffset);
    const entries = [];
    const seenNames = new Set();
    let totalUncompressedBytes = 0;
    let cursor = 0;
    while (cursor < central.length) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY) {
        throw new Error(`invalid central-directory entry at byte ${centralOffset + cursor}`);
      }
      const flags = central.readUInt16LE(cursor + 8);
      const compression = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const versionMadeBy = central.readUInt16LE(cursor + 4);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localHeaderOffset = central.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new Error('truncated central-directory entry');
      if (flags & 0x1) throw new Error('encrypted wheel entry is not allowed');
      if (![0, 8].includes(compression)) throw new Error(`unsupported compression method ${compression}`);
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (!safeArchivePath(name) || seenNames.has(name)) throw new Error(`unsafe or duplicate archive entry: ${name}`);
      seenNames.add(name);
      const unixMode = (versionMadeBy >>> 8) === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
      const fileType = unixMode & 0o170000;
      const isDirectory = name.endsWith('/');
      if (fileType && fileType !== 0o100000 && fileType !== 0o040000) {
        throw new Error(`wheel entry has unsupported file type: ${name}`);
      }
      if (isDirectory && fileType && fileType !== 0o040000) throw new Error(`directory entry has non-directory mode: ${name}`);
      if (!isDirectory && fileType === 0o040000) throw new Error(`file entry has directory mode: ${name}`);
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('wheel uncompressed tree exceeds the admission limit');
      }
      entries.push({ name, flags, compression, compressedSize, uncompressedSize, localHeaderOffset, unixMode, isDirectory });
      cursor = end;
    }
    if (entries.length !== entryCount) throw new Error(`wheel entry count mismatch: expected ${entryCount}, got ${entries.length}`);
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

export function validateArchiveEntries(entries, runtime) {
  const errors = [];
  const allowedTopLevels = new Set(runtime.allowedTopLevelDirectories ?? []);
  const actualFiles = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name).sort();
  const expectedFiles = [...runtime.expectedFiles].sort();
  for (const entry of entries) {
    const topLevel = entry.name.split('/')[0];
    if (!allowedTopLevels.has(topLevel)) errors.push(`unexpected top-level archive entry: ${entry.name}`);
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    errors.push('wheel file tree differs from runtime.expectedFiles');
  }
  const expected = new Set(actualFiles);
  for (const sidecar of runtime.requiredSidecars) {
    if (!expected.has(sidecar)) errors.push(`missing required sidecar: ${sidecar}`);
  }
  if (!expected.has(runtime.executable)) errors.push(`missing executable: ${runtime.executable}`);
  return { ok: errors.length === 0, errors };
}

function extractEntry(fd, entry) {
  const local = readAt(fd, 30, entry.localHeaderOffset);
  if (local.readUInt32LE(0) !== ZIP_LOCAL_FILE) throw new Error(`invalid local header for ${entry.name}`);
  const localFlags = local.readUInt16LE(6);
  const compression = local.readUInt16LE(8);
  if (localFlags & 0x1 || compression !== entry.compression) throw new Error(`local header mismatch for ${entry.name}`);
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  const localName = readAt(fd, nameLength, entry.localHeaderOffset + 30).toString('utf8');
  if (localName !== entry.name) throw new Error(`local header name mismatch for ${entry.name}`);
  const raw = readAt(fd, entry.compressedSize, entry.localHeaderOffset + 30 + nameLength + extraLength);
  const content = entry.compression === 0 ? raw : inflateRawSync(raw);
  if (content.length !== entry.uncompressedSize) throw new Error(`uncompressed size mismatch for ${entry.name}`);
  return content;
}

export function extractWheelArchive(wheelPath, entries, destination) {
  const root = path.resolve(destination);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(wheelPath, 'r');
  try {
    for (const entry of entries) {
      const target = path.resolve(root, entry.name);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`archive escaped staging directory: ${entry.name}`);
      if (entry.isDirectory) {
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, extractEntry(fd, entry), { mode: entry.unixMode ? entry.unixMode & 0o777 : 0o600 });
      if (entry.unixMode) fs.chmodSync(target, entry.unixMode & 0o777);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function treeManifest(root) {
  const files = [];
  function visit(directory) {
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const absolute = path.join(directory, dirent.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`unsafe extracted tree entry: ${relative}`);
      if (stat.isDirectory()) visit(absolute);
      else files.push({ path: relative, bytes: stat.size, mode: stat.mode & 0o777, sha256: sha256(fs.readFileSync(absolute)) });
    }
  }
  visit(root);
  return { files, sha256: sha256(JSON.stringify(files)) };
}

function controlledEnvironment(root, scope) {
  const tmp = path.join(root, scope, 'tmp');
  const home = path.join(root, scope, 'home');
  const dshHome = path.join(root, scope, 'dsh-home');
  for (const directory of [tmp, home, dshHome]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: tmp, TMP: tmp, USERPROFILE: home, DSH_HOME: dshHome }
    : { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmp, DSH_HOME: dshHome };
  return { env, dshHome };
}

/**
 * Retain at most the explicitly allowed number of diagnostic bytes. Never set
 * an encoding on a child stream before this bound: a malicious runtime could
 * otherwise force an arbitrarily large UTF-8 string allocation in Node.
 */
function captureStream(stream, assign) {
  const parts = [];
  let capturedBytes = 0;
  const captured = () => Buffer.concat(parts, capturedBytes).toString('utf8');
  stream.on('data', (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (capturedBytes < MAX_CAPTURE_BYTES) {
      const accepted = bytes.subarray(0, MAX_CAPTURE_BYTES - capturedBytes);
      if (accepted.length > 0) {
        parts.push(accepted);
        capturedBytes += accepted.length;
      }
    }
    assign(captured());
  });
  return captured;
}

/**
 * Frame newline-delimited JSON-RPC before UTF-8 decoding or full-record
 * allocation. This verifier runs an untrusted reviewed artifact, so an
 * unbounded `readline`/string accumulator is not an acceptable diagnostic
 * shortcut.
 */
export function createBoundedNdjsonFrameDecoder(options) {
  const maxLineBytes = options.maxLineBytes ?? MAX_CAPTURE_BYTES;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
    throw new Error('maxLineBytes must be a positive safe integer');
  }
  let parts = [];
  let lineBytes = 0;
  let overflowed = false;
  return {
    push(chunk) {
      if (overflowed) return false;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let cursor = 0;
      while (cursor < bytes.length) {
        const newline = bytes.indexOf(0x0a, cursor);
        const end = newline === -1 ? bytes.length : newline;
        const segmentBytes = end - cursor;
        const observedBytes = lineBytes + segmentBytes;
        if (observedBytes > maxLineBytes) {
          overflowed = true;
          parts = [];
          lineBytes = 0;
          options.onOverflow(observedBytes);
          return false;
        }
        if (segmentBytes > 0) {
          parts.push(bytes.subarray(cursor, end));
          lineBytes = observedBytes;
        }
        if (newline === -1) break;
        const raw = Buffer.concat(parts, lineBytes);
        const protocolBytes = raw.at(-1) === 0x0d ? raw.subarray(0, -1) : raw;
        parts = [];
        lineBytes = 0;
        let line;
        try {
          // A replacement character from Buffer#toString could transform
          // malformed runtime bytes into a different valid JSON message.
          // The evidence runner must reject the same way as Main transport.
          line = new TextDecoder('utf-8', { fatal: true }).decode(protocolBytes);
        } catch {
          overflowed = true;
          options.onInvalidUtf8?.(protocolBytes.length);
          return false;
        }
        options.onLine(line);
        cursor = newline + 1;
      }
      return true;
    },
  };
}

const EVIDENCE_PROCESS_KILL_GRACE_MS = 3_000;

function hasPosixProcessGroup(child) {
  return process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0;
}

function processGroupStatus(child) {
  if (!hasPosixProcessGroup(child)) return 'gone';
  try {
    process.kill(-child.pid, 0);
    return 'live';
  } catch (error) {
    return error?.code === 'ESRCH' ? 'gone' : 'unknown';
  }
}

function signalEvidenceProcessTree(child, signal) {
  if (hasPosixProcessGroup(child)) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // The group may already be gone; use the direct handle as the safe fallback.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The evidence runner executes reviewed but still untrusted code. POSIX runs
 * use a dedicated process group so timeouts and malformed frames reach normal
 * descendants too. A setsid/double-fork can escape this group; F2's product
 * containment gate remains required before registration, and Windows smoke is
 * intentionally withheld in this workflow until its Job Object equivalent.
 */
export async function closeEvidenceProcessTree(child, graceMs = EVIDENCE_PROCESS_KILL_GRACE_MS) {
  if (!Number.isSafeInteger(graceMs) || graceMs <= 0) throw new Error('evidence process grace must be a positive safe integer');
  if (!hasPosixProcessGroup(child)) {
    signalEvidenceProcessTree(child, 'SIGKILL');
    return;
  }
  let status = processGroupStatus(child);
  if (status === 'gone') return;
  if (status === 'unknown') throw new Error('evidence process group cleanup could not be confirmed');
  signalEvidenceProcessTree(child, 'SIGTERM');
  await waitFor(graceMs);
  status = processGroupStatus(child);
  if (status === 'gone') return;
  if (status === 'unknown') throw new Error('evidence process group cleanup could not be confirmed');
  signalEvidenceProcessTree(child, 'SIGKILL');
  await waitFor(graceMs);
  status = processGroupStatus(child);
  if (status !== 'gone') throw new Error('evidence process group did not exit after SIGKILL');
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settling = false;
    let timer;
    const complete = (exit, failure) => {
      if (settling) return;
      settling = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      closeEvidenceProcessTree(child).then(
        () => failure ? reject(failure) : resolve(exit),
        (cleanupError) => reject(cleanupError),
      );
    };
    const onError = (error) => complete(undefined, error);
    const onExit = (code, signal) => complete({ code, signal });
    if (child.exitCode !== null || child.signalCode !== null) {
      complete({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    timer = setTimeout(() => complete(undefined, new Error(`process timed out after ${timeoutMs}ms`)), timeoutMs);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function runVersion(executable, cwd, env) {
  const child = spawn(executable, ['--version'], { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const readStdout = captureStream(child.stdout, (value) => { stdout = value; });
  captureStream(child.stderr, (value) => { stderr = value; });
  const exit = await waitForExit(child, DEFAULT_TIMEOUT_MS);
  if (exit.code !== 0 || exit.signal) throw new Error(`--version exited ${JSON.stringify(exit)}`);
  if (stderr) throw new Error('--version wrote unexpected stderr');
  return readStdout().trim();
}

function startJsonRpcClient({ executable, cwd, env, profile, label }) {
  const child = spawn(executable, ['--profile', profile], { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  let failed = false;
  const rejectPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const fail = (error) => {
    if (failed) return;
    failed = true;
    rejectPending(error);
    child.stdout.destroy();
    signalEvidenceProcessTree(child, 'SIGKILL');
  };
  const stdout = createBoundedNdjsonFrameDecoder({
    maxLineBytes: MAX_CAPTURE_BYTES,
    onOverflow: (observedBytes) => fail(new Error(`${label} stdout line exceeded ${MAX_CAPTURE_BYTES} bytes (observed at least ${observedBytes})`)),
    onInvalidUtf8: (observedBytes) => fail(new Error(`${label} stdout contained invalid UTF-8 (${observedBytes} bytes)`)),
    onLine: (line) => {
      if (!line) return;
      let packet;
      try {
        packet = JSON.parse(line);
      } catch {
        fail(new Error(`${label} stdout contained non-JSON-RPC output`));
        return;
      }
      const waiter = pending.get(String(packet.id));
      if (!waiter) return;
      pending.delete(String(packet.id));
      if (packet.error) waiter.reject(new Error(`${label} JSON-RPC error: ${JSON.stringify(packet.error)}`));
      else waiter.resolve(packet.result);
    },
  });
  child.stdout.on('data', (chunk) => { stdout.push(chunk); });
  captureStream(child.stderr, (value) => { stderr = value; });
  child.once('error', fail);
  child.once('exit', (code, signal) => rejectPending(new Error(`${label} exited before response: ${code ?? signal}`)));
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failed) {
      reject(new Error(`${label} transport is closed`));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`${method} timed out`));
    }, DEFAULT_TIMEOUT_MS);
    pending.set(String(id), {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
      if (!error) return;
      pending.delete(String(id));
      clearTimeout(timer);
      reject(error);
    });
  });
  const notify = (method, params) => {
    if (failed) throw new Error(`${label} transport is closed`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, (error) => {
      if (error) fail(error);
    });
  };
  return { child, request, notify, stderr: () => stderr };
}

async function startSdkClient(executable, cwd, env) {
  return startJsonRpcClient({ executable, cwd, env, profile: 'sdk', label: 'SDK' });
}

/** Start the public ACP profile over its line-delimited JSON-RPC stdio transport. */
async function startAcpClient(executable, cwd, env) {
  return startJsonRpcClient({ executable, cwd, env, profile: 'acp', label: 'ACP' });
}

async function runSdkLifecycle(executable, cwd, env, runtime) {
  const client = await startSdkClient(executable, cwd, env);
  try {
    const initialized = await client.request('initialize', {
      cwd,
      provider: runtime.sdkHandshake.provider,
      model: runtime.sdkHandshake.model,
    });
    const serverInfo = initialized?.serverInfo;
    if (!isPlainObject(serverInfo) || serverInfo.name !== runtime.sdkHandshake.serverName || serverInfo.version !== runtime.sdkHandshake.serverVersion) {
      throw new Error('SDK initialize response differs from reviewed packet');
    }
    const shutdown = await client.request('shutdown', null);
    client.child.stdin.end();
    const exit = await waitForExit(client.child, DEFAULT_TIMEOUT_MS);
    if (exit.code !== 0 || exit.signal) throw new Error(`SDK shutdown exited ${JSON.stringify(exit)}`);
    if (client.stderr()) throw new Error('SDK lifecycle wrote unexpected stderr');
    return { serverInfo: { name: serverInfo.name, version: serverInfo.version }, exit };
  } catch (error) {
    await closeEvidenceProcessTree(client.child);
    throw error;
  }
}

async function runSdkEofLifecycle(executable, cwd, env, runtime) {
  const client = await startSdkClient(executable, cwd, env);
  try {
    await client.request('initialize', { cwd, provider: runtime.sdkHandshake.provider, model: runtime.sdkHandshake.model });
    client.child.stdin.end();
    const exit = await waitForExit(client.child, DEFAULT_TIMEOUT_MS);
    if (exit.code !== 0 || exit.signal) throw new Error(`SDK EOF exited ${JSON.stringify(exit)}`);
    return exit;
  } catch (error) {
    await closeEvidenceProcessTree(client.child);
    throw error;
  }
}

async function runSdkSigtermLifecycle(executable, cwd, env, runtime) {
  const client = await startSdkClient(executable, cwd, env);
  try {
    await client.request('initialize', { cwd, provider: runtime.sdkHandshake.provider, model: runtime.sdkHandshake.model });
    if (!signalEvidenceProcessTree(client.child, 'SIGTERM')) throw new Error('SIGTERM could not be delivered');
    const exit = await waitForExit(client.child, DEFAULT_TIMEOUT_MS);
    // Runtimes may either preserve SIGTERM as the exit signal or handle it and
    // flush state before a clean exit(0). Both are valid shutdown behaviour;
    // the invariant is bounded termination, enforced by waitForExit().
    return exit;
  } catch (error) {
    await closeEvidenceProcessTree(client.child);
    throw error;
  }
}

/**
 * Exercise the public ACP lifecycle without a model credential or prompt.
 *
 * A close persists the session; list and resume must subsequently refer to
 * that exact opaque id. The probe is intentionally not a product bridge and
 * cannot promote prompt/cancel/follow without their separate real fixtures.
 */
export async function runAcpLifecycle(executable, cwd, env, runtime) {
  const client = await startAcpClient(executable, cwd, env);
  try {
    const initialized = await client.request('initialize', {
      protocolVersion: runtime.acpHandshake.protocolVersion,
      clientCapabilities: {},
    });
    const info = initialized?.agentInfo;
    if (!isPlainObject(info)
      || info.name !== runtime.acpHandshake.agentName
      || info.version !== runtime.acpHandshake.agentVersion) {
      throw new Error('ACP initialize response differs from reviewed packet');
    }
    const sessionCapabilities = initialized?.agentCapabilities?.sessionCapabilities;
    if (!isPlainObject(sessionCapabilities)) throw new Error('ACP initialize omitted sessionCapabilities');
    for (const capability of runtime.acpHandshake.requiredSessionCapabilities) {
      if (!isPlainObject(sessionCapabilities[capability])) {
        throw new Error(`ACP initialize omitted required session capability: ${capability}`);
      }
    }
    const created = await client.request('session/new', { cwd, mcpServers: [] });
    if (!isPlainObject(created) || typeof created.sessionId !== 'string' || !created.sessionId) {
      throw new Error('ACP session/new omitted a usable sessionId');
    }
    const sessionId = created.sessionId;
    // Idle cancellation is a notification and intentionally does not upgrade
    // the cancel evidence state: no model turn was in flight.
    client.notify('session/cancel', { sessionId });
    await client.request('session/close', { sessionId });
    const listed = await client.request('session/list', {});
    if (!Array.isArray(listed?.sessions) || !listed.sessions.some((entry) => entry?.sessionId === sessionId)) {
      throw new Error('ACP session/list did not return the closed session');
    }
    await client.request('session/resume', { sessionId, cwd, mcpServers: [] });
    await client.request('session/close', { sessionId });
    client.child.stdin.end();
    const exit = await waitForExit(client.child, DEFAULT_TIMEOUT_MS);
    if (exit.code !== 0 || exit.signal) throw new Error(`ACP lifecycle exited ${JSON.stringify(exit)}`);
    if (client.stderr()) throw new Error('ACP lifecycle wrote unexpected stderr');
    return {
      agentInfo: { name: info.name, version: info.version },
      sessionIdObserved: true,
      lifecycle: ['initialize', 'new', 'idle-cancel-notify', 'close', 'list', 'resume', 'close'],
      exit,
    };
  } catch (error) {
    await closeEvidenceProcessTree(client.child);
    throw error;
  }
}

/**
 * Gate the Cindy-owned control plane, not an upstream private controller.
 *
 * `create` through `close` are validated against a versioned contract whose
 * runtime transport is ACP.  `INCOMPLETE` means an unproved operation stays
 * capability-gated; `FAIL` means a claimed operation or required runtime
 * invariant demonstrably failed.
 */
export function evaluateCindyBridgeGate(packet, runtimeChecks) {
  const reasons = [];
  if (!runtimeChecks.version || !runtimeChecks.sdkLifecycle || !runtimeChecks.sdkEof || !runtimeChecks.sdkSigterm || !runtimeChecks.acpLifecycle) {
    return { status: 'FAIL', reasons: ['required managed-runtime smoke did not complete'] };
  }
  if (packet.release.source.wheelToSourceBinding !== 'verified') {
    reasons.push('wheel-to-source binding is not verified for this release');
  }
  const bridge = packet.cindyBridge;
  if (bridge.availability === 'not-probed') reasons.push('no release-bound Cindy bridge probe is recorded');
  if (bridge.availability === 'unavailable') return { status: 'FAIL', reasons: ['release evidence records no Cindy bridge'] };
  if (!bridge.mainOwned) reasons.push('Cindy bridge is not proven Main-owned');
  if (typeof bridge.contractVersion !== 'string' || !bridge.contractVersion.trim()) {
    reasons.push('Cindy bridge contract is not versioned');
  }
  for (const operation of REQUIRED_BRIDGE_OPERATIONS) {
    if (bridge.operations[operation] === 'failed') return { status: 'FAIL', reasons: [`Cindy bridge ${operation} probe failed`] };
    if (bridge.operations[operation] !== 'passed') reasons.push(`Cindy bridge ${operation} is not proven`);
  }
  return reasons.length === 0 ? { status: 'PASS', reasons: [] } : { status: 'INCOMPLETE', reasons };
}

/** @deprecated Use evaluateCindyBridgeGate. Retained as a source-compatible alias for early F0 callers. */
export const evaluateNativeHostGate = evaluateCindyBridgeGate;

export async function runCindyBridgeGate({ packetPath, wheelPath }) {
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const validation = validateEvidencePacket(packet);
  if (!validation.ok) return { status: 'FAIL', validation, checks: {}, reasons: ['packet validation failed'] };

  const declaredWheel = packet.release.wheel;
  const wheelStat = fs.statSync(wheelPath);
  const actualWheelHash = sha256(fs.readFileSync(wheelPath));
  if (path.basename(wheelPath) !== declaredWheel.filename || wheelStat.size !== declaredWheel.bytes || actualWheelHash !== declaredWheel.sha256) {
    return {
      status: 'FAIL',
      validation,
      checks: { wheel: { filename: path.basename(wheelPath), bytes: wheelStat.size, sha256: actualWheelHash } },
      reasons: ['wheel does not match the reviewed filename, size, and SHA-256 tuple'],
    };
  }

  let entries;
  try {
    entries = inspectWheelArchive(wheelPath);
  } catch (error) {
    return { status: 'FAIL', validation, checks: {}, reasons: [`wheel archive rejected: ${error.message}`] };
  }
  const archive = validateArchiveEntries(entries, packet.runtime);
  if (!archive.ok) return { status: 'FAIL', validation, checks: { archive }, reasons: archive.errors };

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-native-host-gate-'));
  try {
    const extractionRoot = path.join(temporaryRoot, 'wheel');
    extractWheelArchive(wheelPath, entries, extractionRoot);
    const manifest = treeManifest(extractionRoot);
    if (manifest.sha256 !== packet.runtime.treeManifestSha256) {
      return { status: 'FAIL', validation, checks: { archive, manifest }, reasons: ['extracted tree manifest does not match the reviewed packet'] };
    }
    const executable = path.join(extractionRoot, packet.runtime.executable);
    const executableMode = fs.statSync(executable).mode & 0o111;
    if (executableMode === 0) return { status: 'FAIL', validation, checks: { archive, manifest }, reasons: ['runtime executable is not executable'] };
    for (const sidecar of packet.runtime.requiredSidecars) {
      if ((fs.statSync(path.join(extractionRoot, sidecar)).mode & 0o111) === 0) {
        return { status: 'FAIL', validation, checks: { archive, manifest }, reasons: [`runtime sidecar is not executable: ${sidecar}`] };
      }
    }

    const launcher = path.join(temporaryRoot, 'launcher');
    fs.mkdirSync(launcher, { mode: 0o700 });
    const version = await runVersion(executable, launcher, controlledEnvironment(temporaryRoot, 'version').env);
    if (version !== packet.runtime.executableVersion) {
      return { status: 'FAIL', validation, checks: { archive, manifest, version }, reasons: ['runtime --version differs from reviewed packet'] };
    }
    const sdkLifecycle = await runSdkLifecycle(executable, launcher, controlledEnvironment(temporaryRoot, 'lifecycle').env, packet.runtime);
    const sdkEof = await runSdkEofLifecycle(executable, launcher, controlledEnvironment(temporaryRoot, 'eof').env, packet.runtime);
    const sdkSigterm = await runSdkSigtermLifecycle(executable, launcher, controlledEnvironment(temporaryRoot, 'sigterm').env, packet.runtime);
    const acpLifecycle = await runAcpLifecycle(executable, launcher, controlledEnvironment(temporaryRoot, 'acp').env, packet.runtime);
    const checks = { archive, manifest, version, sdkLifecycle, sdkEof, sdkSigterm, acpLifecycle };
    const policy = evaluateCindyBridgeGate(packet, checks);
    return { status: policy.status, validation, checks, reasons: policy.reasons };
  } catch (error) {
    return { status: 'FAIL', validation, checks: {}, reasons: [`managed runtime smoke failed: ${error.message}`] };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/** @deprecated Use runCindyBridgeGate. */
export const runNativeHostGate = runCindyBridgeGate;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--packet', '--wheel', '--out'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('usage: node scripts/dsh-native-host-gate.mjs --packet <packet.json> --wheel <wheel.whl> [--out <result.json>]');
    }
    args[key.slice(2)] = value;
  }
  if (!args.packet || !args.wheel) throw new Error('packet and wheel are required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCindyBridgeGate({ packetPath: args.packet, wheelPath: args.wheel });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) fs.writeFileSync(args.out, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
  process.exitCode = result.status === 'FAIL' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`dsh-cindy-bridge-gate: ${error.message}\n`);
    process.exitCode = 1;
  });
}
