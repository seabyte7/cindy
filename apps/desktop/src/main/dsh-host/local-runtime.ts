/**
 * DSH local runtime admission and installation boundary.
 *
 * F2 deliberately accepts no network location, PATH lookup, user executable,
 * or source-tree fallback. A caller can only supply the exact locally built
 * F0 archive plus its evidence manifest; both must match the checked-in
 * darwin-arm64 development pin before extraction. The installed directory is
 * rechecked before every use, so a stale `.ready` marker alone is never an
 * authority to spawn DSH.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const TAR_BLOCK_BYTES = 512;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 384 * 1024 * 1024;
const INSTALL_MARKER = '.cindy-dsh-runtime.json';

export const DSH_LOCAL_RUNTIME_TARGET = 'darwin-arm64';

export interface DshRuntimeFile {
  path: string;
  bytes: number;
  mode: number;
  sha256: string;
}

export interface DshLocalRuntimePin {
  schemaVersion: 1;
  scope: 'local-darwin-arm64-development-only';
  releaseId: string;
  target: typeof DSH_LOCAL_RUNTIME_TARGET;
  runtime: {
    expectedVersion: string;
    executable: string;
    requiredSidecars: readonly string[];
    treeManifestSha256: string;
    files: readonly DshRuntimeFile[];
  };
  artifact: {
    filename: string;
    bytes: number;
    sha256: string;
  };
}

export interface DshLocalRuntimeBundleManifest {
  schemaVersion: 1;
  releaseId: string;
  target: string;
  runtime: {
    expectedVersion: string;
    executable: string;
    requiredSidecars: readonly string[];
    treeManifestSha256: string;
    files: readonly DshRuntimeFile[];
  };
  artifact: {
    filename: string;
    bytes: number;
    sha256: string;
  };
}

export interface VerifiedDshRuntime {
  installDirectory: string;
  binaryPath: string;
  sidecarPaths: readonly string[];
  releaseId: string;
  expectedVersion: string;
}

interface ParsedArchiveFile extends DshRuntimeFile {
  body: Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function assertSafeName(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a safe non-empty path segment`);
  }
}

function assertSafeRelativeFile(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value)) {
    throw new Error(`${label} must be a safe relative file path`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment))) {
    throw new Error(`${label} must be a safe relative file path`);
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedFiles(files: readonly DshRuntimeFile[]): DshRuntimeFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function parseRuntimeFiles(value: unknown, label: string): DshRuntimeFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  const paths = new Set<string>();
  const files = value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${label}[${index}] must be an object`);
    assertSafeRelativeFile(entry.path, `${label}[${index}].path`);
    assertPositiveSafeInteger(entry.bytes, `${label}[${index}].bytes`);
    assertPositiveSafeInteger(entry.mode, `${label}[${index}].mode`);
    if (entry.mode > 0o777 || (entry.mode & 0o022) !== 0) {
      throw new Error(`${label}[${index}].mode must not be group/world writable`);
    }
    if (!isSha256(entry.sha256)) throw new Error(`${label}[${index}].sha256 must be SHA-256`);
    if (paths.has(entry.path)) throw new Error(`${label} contains duplicate paths`);
    paths.add(entry.path);
    return { path: entry.path, bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256.toLowerCase() };
  });
  return normalizedFiles(files);
}

function parseRuntime(value: unknown, label: string): DshLocalRuntimePin['runtime'] {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (typeof value.expectedVersion !== 'string' || !value.expectedVersion) {
    throw new Error(`${label}.expectedVersion must be a non-empty string`);
  }
  assertSafeRelativeFile(value.executable, `${label}.executable`);
  if (!Array.isArray(value.requiredSidecars)) throw new Error(`${label}.requiredSidecars must be an array`);
  const requiredSidecars = value.requiredSidecars.map((sidecar, index) => {
    assertSafeRelativeFile(sidecar, `${label}.requiredSidecars[${index}]`);
    return sidecar;
  });
  if (new Set(requiredSidecars).size !== requiredSidecars.length || requiredSidecars.includes(value.executable)) {
    throw new Error(`${label}.requiredSidecars must be unique and exclude the executable`);
  }
  if (!isSha256(value.treeManifestSha256)) throw new Error(`${label}.treeManifestSha256 must be SHA-256`);
  const files = parseRuntimeFiles(value.files, `${label}.files`);
  const required = new Set([value.executable, ...requiredSidecars]);
  if (files.length !== required.size || files.some((file) => !required.has(file.path))) {
    throw new Error(`${label}.files must exactly declare the executable and required sidecars`);
  }
  if (files.some((file) => (file.mode & 0o111) === 0)) {
    throw new Error(`${label}.files must all be executable on POSIX`);
  }
  const computedTreeHash = sha256(JSON.stringify(files));
  if (computedTreeHash !== value.treeManifestSha256.toLowerCase()) {
    throw new Error(`${label}.treeManifestSha256 does not match files`);
  }
  return {
    expectedVersion: value.expectedVersion,
    executable: value.executable,
    requiredSidecars: [...requiredSidecars].sort(),
    treeManifestSha256: value.treeManifestSha256.toLowerCase(),
    files,
  };
}

function parseArtifact(value: unknown, label: string): DshLocalRuntimePin['artifact'] {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertSafeName(value.filename, `${label}.filename`);
  if (!value.filename.endsWith('.tar.gz')) throw new Error(`${label}.filename must be a tar.gz filename`);
  assertPositiveSafeInteger(value.bytes, `${label}.bytes`);
  if (value.bytes > MAX_ARCHIVE_BYTES) throw new Error(`${label}.bytes exceeds the local archive limit`);
  if (!isSha256(value.sha256)) throw new Error(`${label}.sha256 must be SHA-256`);
  return { filename: value.filename, bytes: value.bytes, sha256: value.sha256.toLowerCase() };
}

function parsePinLike(value: unknown, label: string, requireLocalScope: boolean): DshLocalRuntimePin {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (value.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if ((requireLocalScope && value.scope !== 'local-darwin-arm64-development-only')
    || (!requireLocalScope && value.scope !== undefined && value.scope !== 'local-darwin-arm64-development-only')) {
    throw new Error(`${label}.scope is not an approved local-development scope`);
  }
  assertSafeName(value.releaseId, `${label}.releaseId`);
  if (value.target !== DSH_LOCAL_RUNTIME_TARGET) {
    throw new Error(`${label}.target must be ${DSH_LOCAL_RUNTIME_TARGET}`);
  }
  return {
    schemaVersion: 1,
    scope: 'local-darwin-arm64-development-only',
    releaseId: value.releaseId,
    target: DSH_LOCAL_RUNTIME_TARGET,
    runtime: parseRuntime(value.runtime, `${label}.runtime`),
    artifact: parseArtifact(value.artifact, `${label}.artifact`),
  };
}

/** Parse the checked-in local-only pin or the F0 bundle manifest without trusting extra fields. */
export function parseDshLocalRuntimePin(value: unknown): DshLocalRuntimePin {
  return parsePinLike(value, 'DSH runtime pin', true);
}

export function parseDshLocalRuntimeBundleManifest(value: unknown): DshLocalRuntimeBundleManifest {
  const pin = parsePinLike(value, 'DSH runtime bundle manifest', false);
  if (!isRecord(value) || !isRecord(value.targets) || Object.keys(value.targets).length !== 1) {
    throw new Error('DSH runtime bundle manifest must declare exactly one local target');
  }
  const target = value.targets[DSH_LOCAL_RUNTIME_TARGET];
  if (!isRecord(target)) throw new Error('DSH runtime bundle manifest omits its declared local target');
  if (target.executable !== pin.runtime.executable
    || JSON.stringify(target.sidecars) !== JSON.stringify(pin.runtime.requiredSidecars)) {
    throw new Error('DSH runtime bundle target does not match the declared runtime tree');
  }
  return {
    schemaVersion: pin.schemaVersion,
    releaseId: pin.releaseId,
    target: pin.target,
    runtime: pin.runtime,
    artifact: pin.artifact,
  };
}

export function readDshLocalRuntimePin(pinPath: string): DshLocalRuntimePin {
  const stat = fs.lstatSync(pinPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('DSH runtime pin must be a regular file');
  return parseDshLocalRuntimePin(JSON.parse(fs.readFileSync(pinPath, 'utf8')) as unknown);
}

function pinsMatch(left: DshLocalRuntimePin, right: DshLocalRuntimePin): boolean {
  // The F0 evidence manifest intentionally does not carry the local-only
  // installer scope. Compare every artifact-bearing field after strict
  // parsing instead of depending on JSON property order or that local marker.
  return left.schemaVersion === right.schemaVersion
    && left.releaseId === right.releaseId
    && left.target === right.target
    && JSON.stringify(left.runtime) === JSON.stringify(right.runtime)
    && JSON.stringify(left.artifact) === JSON.stringify(right.artifact);
}

function assertLocalPlatform(platform = process.platform, arch = process.arch): void {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`DSH local runtime is unavailable on ${platform}-${arch}; only darwin-arm64 is admitted`);
  }
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]*$/.test(raw)) throw new Error('DSH runtime archive has an invalid tar octal field');
  return raw ? Number.parseInt(raw, 8) : 0;
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

function parseVerifiedArchive(archive: Buffer, pin: DshLocalRuntimePin): ParsedArchiveFile[] {
  const tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES });
  const parsed: ParsedArchiveFile[] = [];
  let cursor = 0;
  let terminated = false;
  while (cursor + TAR_BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(cursor, cursor + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      if (cursor + TAR_BLOCK_BYTES * 2 !== tar.length || !isZeroBlock(tar.subarray(cursor + TAR_BLOCK_BYTES, cursor + TAR_BLOCK_BYTES * 2))) {
        throw new Error('DSH runtime archive has an incomplete or trailing tar terminator');
      }
      terminated = true;
      break;
    }
    const storedChecksum = readTarOctal(header, 148, 8);
    const computedChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0);
    if (storedChecksum !== computedChecksum) throw new Error('DSH runtime archive tar header checksum mismatch');
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    assertSafeRelativeFile(name, 'DSH runtime archive entry');
    if (header[156] !== 0x30 || !isZeroBlock(header.subarray(157, 257)) || !isZeroBlock(header.subarray(265, 512))) {
      throw new Error('DSH runtime archive contains a non-regular, linked, or extended entry');
    }
    if (!header.subarray(257, 263).equals(Buffer.from('ustar\0'))) {
      throw new Error('DSH runtime archive has an unexpected tar format');
    }
    const bytes = readTarOctal(header, 124, 12);
    const mode = readTarOctal(header, 100, 8);
    if (bytes > MAX_FILE_BYTES || (mode & 0o022) !== 0) throw new Error('DSH runtime archive entry exceeds local safety limits');
    const bodyStart = cursor + TAR_BLOCK_BYTES;
    const bodyEnd = bodyStart + bytes;
    if (bodyEnd > tar.length) throw new Error('DSH runtime archive entry extends past the archive');
    const padding = (TAR_BLOCK_BYTES - (bytes % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding && !isZeroBlock(tar.subarray(bodyEnd, bodyEnd + padding))) {
      throw new Error('DSH runtime archive has non-zero entry padding');
    }
    parsed.push({ path: name, bytes, mode, sha256: sha256(tar.subarray(bodyStart, bodyEnd)), body: tar.subarray(bodyStart, bodyEnd) });
    cursor = bodyEnd + padding;
  }
  if (!terminated) throw new Error('DSH runtime archive has no tar terminator');
  const normalized = parsed.sort((left, right) => left.path.localeCompare(right.path));
  const expected = normalizedFiles(pin.runtime.files);
  if (normalized.length !== expected.length || normalized.some((entry, index) => {
    const wanted = expected[index]!;
    return entry.path !== wanted.path || entry.bytes !== wanted.bytes || entry.mode !== wanted.mode || entry.sha256 !== wanted.sha256;
  })) {
    throw new Error('DSH runtime archive tree does not match the approved pin');
  }
  return normalized;
}

/** Verify an F0 archive and evidence manifest before a userData install is even staged. */
export function inspectDshLocalRuntimeArchive(input: {
  archivePath: string;
  bundleManifestPath: string;
  pin: DshLocalRuntimePin;
  platform?: string;
  arch?: string;
}): ParsedArchiveFile[] {
  assertLocalPlatform(input.platform, input.arch);
  const pin = parseDshLocalRuntimePin(input.pin);
  const bundleStat = fs.lstatSync(input.bundleManifestPath);
  if (!bundleStat.isFile() || bundleStat.isSymbolicLink()) throw new Error('DSH runtime bundle manifest must be a regular file');
  const bundle = parseDshLocalRuntimeBundleManifest(JSON.parse(fs.readFileSync(input.bundleManifestPath, 'utf8')) as unknown);
  if (!pinsMatch(pin, bundle)) throw new Error('DSH runtime bundle manifest does not match the approved local pin');
  const archiveStat = fs.lstatSync(input.archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) throw new Error('DSH runtime archive must be a regular file');
  if (path.basename(input.archivePath) !== pin.artifact.filename || archiveStat.size !== pin.artifact.bytes) {
    throw new Error('DSH runtime archive filename or size does not match the approved pin');
  }
  const archive = fs.readFileSync(input.archivePath);
  if (sha256(archive) !== pin.artifact.sha256) throw new Error('DSH runtime archive SHA-256 does not match the approved pin');
  return parseVerifiedArchive(archive, pin);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the managed DSH runtime directory`);
  }
}

function listFiles(root: string, current = root): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const candidate = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, candidate));
    else if (entry.isFile()) result.push(path.relative(root, candidate));
    else throw new Error('managed DSH runtime contains a non-regular filesystem entry');
  }
  return result.sort();
}

/** Recheck the promoted runtime tree before every spawn; marker files alone are never trusted. */
export function verifyInstalledDshLocalRuntime(input: {
  installDirectory: string;
  pin: DshLocalRuntimePin;
  platform?: string;
  arch?: string;
}): VerifiedDshRuntime {
  assertLocalPlatform(input.platform, input.arch);
  const pin = parseDshLocalRuntimePin(input.pin);
  const rootStat = fs.lstatSync(input.installDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('managed DSH runtime directory must be a real directory');
  const root = fs.realpathSync(input.installDirectory);
  const expected = normalizedFiles(pin.runtime.files);
  const allowed = new Set([...expected.map((file) => file.path), INSTALL_MARKER]);
  const actual = listFiles(root);
  if (actual.length !== allowed.size || actual.some((file) => !allowed.has(file))) {
    throw new Error('managed DSH runtime contains unexpected or missing files');
  }
  for (const file of expected) {
    const candidate = path.resolve(root, file.path);
    assertContained(root, candidate, `managed DSH runtime file ${file.path}`);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || (stat.mode & 0o777) !== file.mode) {
      throw new Error(`managed DSH runtime file ${file.path} does not match the approved mode or size`);
    }
    const resolved = fs.realpathSync(candidate);
    assertContained(root, resolved, `managed DSH runtime file ${file.path}`);
    if (sha256(fs.readFileSync(resolved)) !== file.sha256) {
      throw new Error(`managed DSH runtime file ${file.path} does not match the approved SHA-256`);
    }
  }
  const markerPath = path.join(root, INSTALL_MARKER);
  const marker = fs.lstatSync(markerPath);
  if (!marker.isFile() || marker.isSymbolicLink() || (marker.mode & 0o022) !== 0) {
    throw new Error('managed DSH runtime marker is unsafe');
  }
  const markerPin = parseDshLocalRuntimePin(JSON.parse(fs.readFileSync(markerPath, 'utf8')) as unknown);
  if (!pinsMatch(pin, markerPin)) throw new Error('managed DSH runtime marker does not match the approved pin');
  return {
    installDirectory: root,
    binaryPath: path.join(root, pin.runtime.executable),
    sidecarPaths: pin.runtime.requiredSidecars.map((sidecar) => path.join(root, sidecar)),
    releaseId: pin.releaseId,
    expectedVersion: pin.runtime.expectedVersion,
  };
}

/**
 * Materialize an already inspected F0 archive using an atomic same-volume
 * promotion under a Main-owned userData root. Existing installs are only
 * reused after a full verification; a corrupt directory is never deleted or
 * silently replaced.
 */
export function installDshLocalRuntime(input: {
  archivePath: string;
  bundleManifestPath: string;
  pin: DshLocalRuntimePin;
  installRoot: string;
  platform?: string;
  arch?: string;
}): VerifiedDshRuntime {
  const pin = parseDshLocalRuntimePin(input.pin);
  const files = inspectDshLocalRuntimeArchive({ ...input, pin });
  if (!path.isAbsolute(input.installRoot)) throw new Error('DSH runtime install root must be Main-owned and absolute');
  fs.mkdirSync(input.installRoot, { recursive: true, mode: 0o700 });
  const installRootStat = fs.lstatSync(input.installRoot);
  if (!installRootStat.isDirectory() || installRootStat.isSymbolicLink()) {
    throw new Error('DSH runtime install root must be a real Main-owned directory');
  }
  const installRoot = fs.realpathSync(input.installRoot);
  fs.chmodSync(installRoot, 0o700);
  const destination = path.join(installRoot, pin.releaseId);
  if (fs.existsSync(destination)) {
    return verifyInstalledDshLocalRuntime({
      installDirectory: destination,
      pin,
      platform: input.platform,
      arch: input.arch,
    });
  }
  const staging = fs.mkdtempSync(path.join(installRoot, '.dsh-staging-'));
  try {
    for (const file of files) {
      const destinationFile = path.resolve(staging, file.path);
      assertContained(staging, destinationFile, `DSH runtime staging file ${file.path}`);
      fs.mkdirSync(path.dirname(destinationFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destinationFile, file.body, { flag: 'wx', mode: file.mode });
      fs.chmodSync(destinationFile, file.mode);
    }
    const marker = path.join(staging, INSTALL_MARKER);
    fs.writeFileSync(marker, `${JSON.stringify(pin)}\n`, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(marker, 0o600);
    verifyInstalledDshLocalRuntime({ installDirectory: staging, pin, platform: input.platform, arch: input.arch });
    fs.renameSync(staging, destination);
    return verifyInstalledDshLocalRuntime({ installDirectory: destination, pin, platform: input.platform, arch: input.arch });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
