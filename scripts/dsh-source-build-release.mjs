#!/usr/bin/env node
/**
 * Build-bound release helper for the Cindy-managed DSH runtime.
 *
 * This helper does not compile DSH and it never installs a runtime. The local
 * macOS development flow first checks out the immutable upstream source tuple
 * and invokes the upstream build command. This file then admits only the
 * declared executable/sidecars, writes a deterministic tar.gz plus a
 * reviewable manifest, and verifies the resulting local bundle.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const BLOCK_BYTES = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK_BYTES);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?\/$)(?!.*(?:^|\/)\.\.?$)[A-Za-z0-9._@+\-/]+$/;
const LOCAL_DEVELOPMENT_TARGETS = new Set(['darwin-arm64']);
const MAX_RUNTIME_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_RUNTIME_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_RUNTIME_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_PNPM_TARBALL_BYTES = 100 * 1024 * 1024;
const MAX_SEA_BASE_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const NPM_SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function sha512IntegrityFile(file) {
  return `sha512-${createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && SAFE_RELATIVE_PATH.test(value)
    && !value.split('/').some((part) => part === '.' || part === '..');
}

function assertSafePath(value, label) {
  if (!isSafeRelativePath(value)) throw new Error(`${label} must be a safe relative path`);
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

/** Validate the checked-in source release definition before trusting source or output. */
export function validateSourceRelease(release) {
  const errors = [];
  const check = (fn) => {
    try { fn(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  };
  if (!isPlainObject(release)) return { ok: false, errors: ['release must be an object'] };
  check(() => {
    if (release.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
    assertString(release.releaseId, 'releaseId');
    if (!isPlainObject(release.source)) throw new Error('source must be an object');
    const source = release.source;
    assertString(source.repository, 'source.repository');
    assertString(source.tag, 'source.tag');
    if (!['lightweight', 'annotated'].includes(source.tagKind)) throw new Error('source.tagKind is invalid');
    if (!['not-applicable', 'verified'].includes(source.tagSignature)) throw new Error('source.tagSignature is invalid');
    if (source.tagKind === 'lightweight' && source.tagSignature !== 'not-applicable') {
      throw new Error('a lightweight tag cannot claim a verified tag signature');
    }
    if (typeof source.commit !== 'string' || !COMMIT.test(source.commit)) throw new Error('source.commit must be a lowercase Git commit id');
    if (typeof source.tree !== 'string' || !COMMIT.test(source.tree)) throw new Error('source.tree must be a lowercase Git tree id');
    for (const key of ['lockfile', 'buildScript', 'packageManifest']) {
      if (!isPlainObject(source[key])) throw new Error(`source.${key} must be an object`);
      assertSafePath(source[key].path, `source.${key}.path`);
      assertSha(source[key].sha256, `source.${key}.sha256`);
    }
    if (!Array.isArray(source.adaptations) || source.adaptations.length === 0) {
      throw new Error('source.adaptations must be a non-empty array');
    }
    for (const [index, adaptation] of source.adaptations.entries()) {
      if (!isPlainObject(adaptation)) throw new Error(`source.adaptations[${index}] must be an object`);
      if (!isPlainObject(adaptation.patch)) throw new Error(`source.adaptations[${index}].patch must be an object`);
      assertSafePath(adaptation.patch.path, `source.adaptations[${index}].patch.path`);
      assertSha(adaptation.patch.sha256, `source.adaptations[${index}].patch.sha256`);
      if (!Array.isArray(adaptation.files) || adaptation.files.length === 0) {
        throw new Error(`source.adaptations[${index}].files must be a non-empty array`);
      }
      const paths = new Set();
      for (const file of adaptation.files) {
        if (!isPlainObject(file)) throw new Error(`source.adaptations[${index}].files must contain objects`);
        assertSafePath(file.path, `source.adaptations[${index}].files.path`);
        assertSha(file.beforeSha256, `source.adaptations[${index}].files.beforeSha256`);
        assertSha(file.afterSha256, `source.adaptations[${index}].files.afterSha256`);
        if (paths.has(file.path)) throw new Error(`source.adaptations[${index}].files has duplicate paths`);
        paths.add(file.path);
      }
    }
    assertString(source.license, 'source.license');

    if (!isPlainObject(release.builder)) throw new Error('builder must be an object');
    assertString(release.builder.node, 'builder.node');
    assertString(release.builder.pnpm, 'builder.pnpm');
    if (typeof release.builder.pnpmIntegrity !== 'string' || !NPM_SHA512_INTEGRITY.test(release.builder.pnpmIntegrity)) {
      throw new Error('builder.pnpmIntegrity must be an npm sha512 integrity string');
    }
    assertStringArray(release.builder.install, 'builder.install');
    assertStringArray(release.builder.command, 'builder.command');
    if (release.builder.install.join(' ') !== 'pnpm install --frozen-lockfile') {
      throw new Error('builder.install must be exactly pnpm install --frozen-lockfile');
    }
    if (!isPlainObject(release.builder.toolchain)) throw new Error('builder.toolchain must be an object');
    const toolchain = release.builder.toolchain;
    assertSafePath(toolchain.directory, 'builder.toolchain.directory');
    for (const key of ['manifest', 'lockfile', 'workspace']) {
      if (!isPlainObject(toolchain[key])) throw new Error(`builder.toolchain.${key} must be an object`);
      assertSafePath(toolchain[key].path, `builder.toolchain.${key}.path`);
      assertSha(toolchain[key].sha256, `builder.toolchain.${key}.sha256`);
    }
    assertString(toolchain.packageName, 'builder.toolchain.packageName');
    assertString(toolchain.version, 'builder.toolchain.version');
    if (typeof toolchain.integrity !== 'string' || !NPM_SHA512_INTEGRITY.test(toolchain.integrity)) {
      throw new Error('builder.toolchain.integrity must be an npm sha512 integrity string');
    }

    if (!isPlainObject(release.runtime)) throw new Error('runtime must be an object');
    assertSafePath(release.runtime.directory, 'runtime.directory');
    assertString(release.runtime.expectedVersion, 'runtime.expectedVersion');
    if (!isPlainObject(release.runtime.acpHandshake)) throw new Error('runtime.acpHandshake must be an object');
    const acp = release.runtime.acpHandshake;
    if (!Number.isSafeInteger(acp.protocolVersion) || acp.protocolVersion < 1) {
      throw new Error('runtime.acpHandshake.protocolVersion must be a positive safe integer');
    }
    assertString(acp.agentName, 'runtime.acpHandshake.agentName');
    assertString(acp.agentVersion, 'runtime.acpHandshake.agentVersion');
    assertStringArray(acp.requiredSessionCapabilities, 'runtime.acpHandshake.requiredSessionCapabilities');

    if (!isPlainObject(release.targets)) throw new Error('targets must be an object');
    const keys = Object.keys(release.targets).sort();
    if (keys.length !== LOCAL_DEVELOPMENT_TARGETS.size || keys.some((key) => !LOCAL_DEVELOPMENT_TARGETS.has(key))) {
      throw new Error('targets must contain exactly the approved local macOS development platform key');
    }
    for (const key of keys) {
      const target = release.targets[key];
      if (!isPlainObject(target)) throw new Error(`targets.${key} must be an object`);
      assertString(target.buildTarget, `targets.${key}.buildTarget`);
      if (!isPlainObject(target.seaBase)) throw new Error(`targets.${key}.seaBase must be an object`);
      const seaBase = target.seaBase;
      if (typeof seaBase.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+$/.test(seaBase.nodeVersion)) {
        throw new Error(`targets.${key}.seaBase.nodeVersion must be an exact Node version`);
      }
      assertSafePath(seaBase.archive, `targets.${key}.seaBase.archive`);
      assertSha(seaBase.sha256, `targets.${key}.seaBase.sha256`);
      const [os, arch] = key.split('-');
      const archiveOs = os === 'darwin' ? 'darwin' : os === 'win32' ? 'win' : 'linux';
      const extension = os === 'win32' ? 'zip' : 'tar.gz';
      const expectedBaseArchive = `node-${seaBase.nodeVersion}-${archiveOs}-${arch}.${extension}`;
      if (seaBase.archive !== expectedBaseArchive) throw new Error(`targets.${key}.seaBase.archive must match its platform and version`);
      if (target.buildTarget !== `node${seaBase.nodeVersion.slice(1)}-${os === 'darwin' ? 'macos' : archiveOs}-${arch}`) {
        throw new Error(`targets.${key}.buildTarget must pin targets.${key}.seaBase.nodeVersion`);
      }
      assertSafePath(target.executable, `targets.${key}.executable`);
      if (path.basename(target.executable) !== target.executable) throw new Error(`targets.${key}.executable must not contain a directory`);
      if (!Array.isArray(target.sidecars) || target.sidecars.length === 0) throw new Error(`targets.${key}.sidecars must be non-empty`);
      const names = new Set([target.executable]);
      for (const sidecar of target.sidecars) {
        assertSafePath(sidecar, `targets.${key}.sidecars`);
        if (path.basename(sidecar) !== sidecar || names.has(sidecar)) throw new Error(`targets.${key}.sidecars contains an invalid or duplicate filename`);
        names.add(sidecar);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

export function readSourceRelease(releasePath) {
  const parsed = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  const validation = validateSourceRelease(parsed);
  if (!validation.ok) throw new Error(`invalid source release: ${validation.errors.join('; ')}`);
  return parsed;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Prove that a fresh upstream checkout is exactly the source object set in
 * the definition. Fetching the named tag is deliberate: checkout by commit
 * alone would not catch a later tag retarget. This is an input check, so it
 * runs before dependency installation or the upstream build mutates outputs.
 */
export function verifySourceInput({ release, sourceRoot, fetchTag = true }) {
  const root = path.resolve(sourceRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('sourceRoot must be a directory');
  if (fetchTag) {
    execFileSync('git', ['-C', root, 'fetch', '--no-tags', 'origin', `refs/tags/${release.source.tag}:refs/tags/${release.source.tag}`], {
      stdio: 'inherit',
    });
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  const tagCommit = git(root, ['rev-parse', `refs/tags/${release.source.tag}^{commit}`]);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const dirty = git(root, ['status', '--porcelain=v1']);
  const errors = [];
  if (head !== release.source.commit) errors.push('HEAD does not match source.commit');
  if (tagCommit !== release.source.commit) errors.push('tag does not resolve to source.commit');
  if (tree !== release.source.tree) errors.push('HEAD tree does not match source.tree');
  if (dirty) errors.push('source checkout is dirty before dependency installation');
  for (const key of ['lockfile', 'buildScript', 'packageManifest']) {
    const entry = release.source[key];
    const candidate = path.resolve(root, entry.path);
    if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate) || sha256File(candidate) !== entry.sha256) {
      errors.push(`${key} digest does not match source release`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
  return { head, tagCommit, tree };
}

/**
 * Apply the small, reviewable Cindy adaptation layer only after the upstream
 * source object has passed verifySourceInput. Alpha3's build-script parser
 * rejects an exact Node triple even though its pinned pkg supports one; this
 * makes that version input explicit without changing runtime source logic.
 */
export function applyReleaseAdaptations({ release, repoRoot, sourceRoot }) {
  const repository = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  if (!fs.statSync(repository).isDirectory()) throw new Error('repoRoot must be a directory');
  if (!fs.statSync(source).isDirectory()) throw new Error('sourceRoot must be a directory');
  const results = [];
  for (const adaptation of release.source.adaptations) {
    const patchPath = path.resolve(repository, adaptation.patch.path);
    if (!patchPath.startsWith(`${repository}${path.sep}`)) throw new Error('adaptation patch escapes repository root');
    const patchStat = fs.lstatSync(patchPath);
    if (!patchStat.isFile() || patchStat.isSymbolicLink()) throw new Error('adaptation patch must be a regular file');
    if (sha256File(patchPath) !== adaptation.patch.sha256) throw new Error('adaptation patch digest does not match source release');

    const expectedPaths = new Set(adaptation.files.map((file) => file.path));
    for (const file of adaptation.files) {
      const candidate = path.resolve(source, file.path);
      if (!candidate.startsWith(`${source}${path.sep}`)) throw new Error('adaptation target escapes source root');
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('adaptation target must be a regular file');
      if (sha256File(candidate) !== file.beforeSha256) throw new Error(`adaptation target does not match its preimage: ${file.path}`);
    }
    const numstat = execFileSync('git', ['-C', source, 'apply', '--check', '--unidiff-zero', '--numstat', '--whitespace=error', patchPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
    const changedPaths = numstat.map((line) => line.split('\t')[2]);
    if (changedPaths.length !== expectedPaths.size
      || changedPaths.some((file) => !file || !expectedPaths.has(file))) {
      throw new Error('adaptation patch changes files outside its release declaration');
    }
    execFileSync('git', ['-C', source, 'apply', '--unidiff-zero', '--whitespace=error', patchPath], { stdio: 'inherit' });
    for (const file of adaptation.files) {
      const candidate = path.resolve(source, file.path);
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || sha256File(candidate) !== file.afterSha256) {
        throw new Error(`adaptation target does not match its postimage: ${file.path}`);
      }
    }
    results.push({ patch: adaptation.patch.path, files: [...expectedPaths].sort() });
  }
  return results;
}

/** Check that the release-bound adaptation remains intact after dependency install. */
export function verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot }) {
  const repository = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  const results = [];
  for (const adaptation of release.source.adaptations) {
    const patchPath = path.resolve(repository, adaptation.patch.path);
    if (!patchPath.startsWith(`${repository}${path.sep}`)) throw new Error('adaptation patch escapes repository root');
    const patchStat = fs.lstatSync(patchPath);
    if (!patchStat.isFile() || patchStat.isSymbolicLink() || sha256File(patchPath) !== adaptation.patch.sha256) {
      throw new Error('adaptation patch digest does not match source release');
    }
    for (const file of adaptation.files) {
      const candidate = path.resolve(source, file.path);
      if (!candidate.startsWith(`${source}${path.sep}`)) throw new Error('adaptation target escapes source root');
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || sha256File(candidate) !== file.afterSha256) {
        throw new Error(`adaptation target does not match its postimage: ${file.path}`);
      }
    }
    results.push({ patch: adaptation.patch.path, files: adaptation.files.map((file) => file.path).sort() });
  }
  return results;
}

/** Verify Cindy's local, frozen replacement for the upstream `pnpm dlx` tool. */
export function verifyPinnedBuildToolchain({ release, repoRoot }) {
  const root = path.resolve(repoRoot);
  const toolchain = release.builder.toolchain;
  const errors = [];
  for (const key of ['manifest', 'lockfile', 'workspace']) {
    const entry = toolchain[key];
    const candidate = path.resolve(root, entry.path);
    if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate) || sha256File(candidate) !== entry.sha256) {
      errors.push(`toolchain ${key} digest does not match source release`);
    }
  }
  const directory = path.resolve(root, toolchain.directory);
  if (!directory.startsWith(`${root}${path.sep}`)) errors.push('toolchain directory escapes repository root');
  try {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(root, toolchain.manifest.path), 'utf8'));
    if (manifest?.packageManager !== `pnpm@${release.builder.pnpm}`) errors.push('toolchain packageManager does not match builder.pnpm');
    if (manifest?.dependencies?.[toolchain.packageName] !== toolchain.version) errors.push('toolchain does not declare the pinned pkg version');
  } catch {
    errors.push('toolchain manifest cannot be read');
  }
  try {
    const lockfile = fs.readFileSync(path.resolve(root, toolchain.lockfile.path), 'utf8');
    if (!lockfile.includes(`${toolchain.packageName}@${toolchain.version}`) || !lockfile.includes(toolchain.integrity)) {
      errors.push('toolchain lock does not bind the pinned package integrity');
    }
  } catch {
    errors.push('toolchain lockfile cannot be read');
  }
  try {
    const workspace = fs.readFileSync(path.resolve(root, toolchain.workspace.path), 'utf8');
    if (!/^\s*esbuild:\s*true\s*$/m.test(workspace)) {
      errors.push('toolchain workspace must explicitly allow only the required esbuild build script');
    }
  } catch {
    errors.push('toolchain workspace cannot be read');
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
  return { directory, packageName: toolchain.packageName, version: toolchain.version };
}

/** Verify the exact pnpm package tarball before it is ever executed locally. */
export function verifyPinnedPnpmTarball({ release, tarballPath }) {
  const candidate = path.resolve(tarballPath);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('pnpm tarball must be a regular file');
  if (stat.size <= 0 || stat.size > MAX_PNPM_TARBALL_BYTES) throw new Error('pnpm tarball size is outside the allowed bound');
  const actual = sha512IntegrityFile(candidate);
  if (actual !== release.builder.pnpmIntegrity) throw new Error('pnpm tarball integrity does not match source release');
  return { tarball: candidate, integrity: actual, bytes: stat.size };
}

/** Verify the exact Node archive that pkg uses as the base for a SEA runtime. */
export function verifySeaBaseArchive({ release, targetKey, archivePath }) {
  const target = release.targets[targetKey];
  if (!target) throw new Error(`unknown source release target: ${targetKey}`);
  const candidate = path.resolve(archivePath);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SEA base archive must be a regular file');
  if (stat.size <= 0 || stat.size > MAX_SEA_BASE_ARCHIVE_BYTES) throw new Error('SEA base archive size is outside the allowed bound');
  if (path.basename(candidate) !== target.seaBase.archive) throw new Error('SEA base archive filename does not match source release');
  const actual = sha256File(candidate);
  if (actual !== target.seaBase.sha256) throw new Error('SEA base archive digest does not match source release');
  return { target: targetKey, archive: candidate, sha256: actual, bytes: stat.size };
}

function targetFiles(release, targetKey) {
  const target = release.targets[targetKey];
  if (!target) throw new Error(`unknown source release target: ${targetKey}`);
  return [target.executable, ...target.sidecars].sort();
}

export function runtimeTreeManifest(runtimeDir, expectedFiles) {
  const root = path.resolve(runtimeDir);
  const expected = new Set(expectedFiles);
  const files = [];
  for (const name of [...expected].sort()) {
    const candidate = path.resolve(root, name);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`runtime file escapes staging: ${name}`);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`runtime artifact must be a regular file: ${name}`);
    if (stat.size <= 0) throw new Error(`runtime artifact is empty: ${name}`);
    if (stat.size > MAX_RUNTIME_FILE_BYTES) throw new Error(`runtime artifact exceeds ${MAX_RUNTIME_FILE_BYTES} bytes: ${name}`);
    if ((stat.mode & 0o022) !== 0) throw new Error(`runtime artifact must not be group/world writable: ${name}`);
    if (!name.endsWith('.exe') && (stat.mode & 0o111) === 0) throw new Error(`runtime artifact is not executable: ${name}`);
    files.push({ path: name, bytes: stat.size, mode: stat.mode & 0o777, sha256: sha256File(candidate) });
  }
  const actual = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  // The upstream build keeps a dev-only node carrier under runtime/node. It is
  // deliberately excluded; direct files must be exactly the production set.
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error('runtime directory contains unexpected or missing direct artifacts');
  }
  return { files, sha256: sha256(JSON.stringify(files)) };
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > length) throw new Error(`tar header value exceeds ${length} bytes: ${value}`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const text = `${value.toString(8).padStart(length - 1, '0')}\0`;
  if (text.length > length) throw new Error('tar numeric field overflow');
  writeString(buffer, offset, length, text);
}

function tarHeader(name, stat) {
  if (!isSafeRelativePath(name) || Buffer.byteLength(name) > 100) throw new Error(`tar path is unsafe or too long: ${name}`);
  const header = Buffer.alloc(BLOCK_BYTES);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, stat.mode & 0o777);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, stat.size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/** Create an mtime/owner-independent tar.gz with only declared regular files. */
export function createDeterministicTarGz(runtimeDir, files) {
  const root = path.resolve(runtimeDir);
  const chunks = [];
  for (const name of [...files].sort()) {
    const candidate = path.resolve(root, name);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`tar input escapes runtime directory: ${name}`);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`tar input must be a regular file: ${name}`);
    const body = fs.readFileSync(candidate);
    chunks.push(tarHeader(name, stat), body);
    const padding = (BLOCK_BYTES - (body.length % BLOCK_BYTES)) % BLOCK_BYTES;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(ZERO_BLOCK, ZERO_BLOCK);
  return gzipSync(Buffer.concat(chunks), { mtime: 0 });
}

function readTarOctal(buffer, offset, length) {
  const value = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]*$/.test(value)) throw new Error('tar header has invalid octal field');
  return value ? Number.parseInt(value, 8) : 0;
}

/** Strictly inspect our constrained tar format; reject paths, types and extras. */
export function inspectRuntimeArchive(archivePath) {
  const archiveStat = fs.lstatSync(archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) throw new Error('runtime archive must be a regular file');
  if (archiveStat.size > MAX_RUNTIME_ARCHIVE_BYTES) throw new Error(`runtime archive exceeds ${MAX_RUNTIME_ARCHIVE_BYTES} bytes`);
  const tar = gunzipSync(fs.readFileSync(archivePath), { maxOutputLength: MAX_RUNTIME_EXPANDED_BYTES });
  const files = [];
  let cursor = 0;
  let sawTerminator = false;
  while (cursor + BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(cursor, cursor + BLOCK_BYTES);
    if (header.equals(ZERO_BLOCK)) {
      if (cursor + BLOCK_BYTES * 2 > tar.length || !tar.subarray(cursor + BLOCK_BYTES, cursor + BLOCK_BYTES * 2).equals(ZERO_BLOCK)) {
        throw new Error('tar has an incomplete terminator');
      }
      if (cursor + BLOCK_BYTES * 2 !== tar.length) throw new Error('tar has trailing data');
      sawTerminator = true;
      break;
    }
    const storedChecksum = readTarOctal(header, 148, 8);
    const calculated = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0);
    if (storedChecksum !== calculated) throw new Error('tar header checksum mismatch');
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!isSafeRelativePath(name)) throw new Error('tar contains an unsafe path');
    if (header[156] !== 0x30) throw new Error('tar contains a non-regular entry');
    if (!header.subarray(157, 257).equals(Buffer.alloc(100))
      || !header.subarray(265, 345).equals(Buffer.alloc(80))
      || !header.subarray(329, 512).equals(Buffer.alloc(183))) {
      throw new Error('tar contains unsupported link, owner, device, or prefix metadata');
    }
    if (!header.subarray(257, 263).equals(Buffer.from('ustar\0')))
      throw new Error('tar has an unexpected format marker');
    const size = readTarOctal(header, 124, 12);
    if (size > MAX_RUNTIME_FILE_BYTES) throw new Error(`tar file exceeds ${MAX_RUNTIME_FILE_BYTES} bytes`);
    const mode = readTarOctal(header, 100, 8);
    if ((mode & 0o022) !== 0) throw new Error('tar contains a group/world writable file');
    const bodyStart = cursor + BLOCK_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new Error('tar file extends past archive');
    const body = tar.subarray(bodyStart, bodyEnd);
    files.push({ path: name, bytes: size, mode, sha256: sha256(body) });
    const padding = (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
    if (padding && !tar.subarray(bodyEnd, bodyEnd + padding).equals(Buffer.alloc(padding))) {
      throw new Error('tar has non-zero file padding');
    }
    cursor = bodyEnd + padding;
  }
  if (!sawTerminator) throw new Error('tar has no terminator');
  const paths = new Set(files.map((entry) => entry.path));
  if (paths.size !== files.length) throw new Error('tar contains duplicate paths');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function packageSourceRuntime({ release, sourceRoot, targetKey, outputDir }) {
  const target = release.targets[targetKey];
  if (!target) throw new Error(`unknown source release target: ${targetKey}`);
  const runtimeDir = path.resolve(sourceRoot, release.runtime.directory);
  const source = path.resolve(sourceRoot);
  if (!runtimeDir.startsWith(`${source}${path.sep}`)) throw new Error('runtime directory escapes source root');
  const files = targetFiles(release, targetKey);
  const tree = runtimeTreeManifest(runtimeDir, files);
  const archive = createDeterministicTarGz(runtimeDir, files);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const archiveFilename = `${release.releaseId}-${targetKey}.tar.gz`;
  const archivePath = path.join(outputDir, archiveFilename);
  fs.writeFileSync(archivePath, archive, { mode: 0o600 });
  const manifest = {
    schemaVersion: 1,
    releaseId: release.releaseId,
    target: targetKey,
    source: release.source,
    builder: release.builder,
    targets: release.targets,
    runtime: {
      expectedVersion: release.runtime.expectedVersion,
      acpHandshake: release.runtime.acpHandshake,
      buildTarget: target.buildTarget,
      seaBase: target.seaBase,
      executable: target.executable,
      requiredSidecars: [...target.sidecars].sort(),
      treeManifestSha256: tree.sha256,
      files: tree.files,
    },
    artifact: {
      filename: archiveFilename,
      bytes: archive.length,
      sha256: sha256(archive),
    },
  };
  const manifestPath = path.join(outputDir, `${release.releaseId}-${targetKey}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  verifyReleaseBundle({ manifest, archivePath });
  return { archivePath, manifestPath, manifest };
}

export function verifyReleaseBundle({ manifest, archivePath }) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1) throw new Error('release manifest schema is invalid');
  const releaseValidation = validateSourceRelease({
    schemaVersion: 1,
    releaseId: manifest.releaseId,
    source: manifest.source,
    builder: manifest.builder,
    runtime: { directory: 'runtime', expectedVersion: manifest.runtime?.expectedVersion, acpHandshake: manifest.runtime?.acpHandshake },
    targets: manifest.targets,
  });
  if (!releaseValidation.ok) throw new Error(`release manifest input is invalid: ${releaseValidation.errors.join('; ')}`);
  if (!Array.isArray(manifest.runtime?.requiredSidecars)) throw new Error('runtime requiredSidecars must be an array');
  const declaredTarget = manifest.targets?.[manifest.target];
  if (!declaredTarget
    || declaredTarget.buildTarget !== manifest.runtime?.buildTarget
    || JSON.stringify(declaredTarget.seaBase) !== JSON.stringify(manifest.runtime?.seaBase)
    || declaredTarget.executable !== manifest.runtime?.executable
    || JSON.stringify([...declaredTarget.sidecars].sort()) !== JSON.stringify(manifest.runtime?.requiredSidecars)) {
    throw new Error('runtime declaration does not match its source-release target');
  }
  if (!isPlainObject(manifest.artifact) || path.basename(archivePath) !== manifest.artifact.filename) {
    throw new Error('archive filename does not match release manifest');
  }
  const stat = fs.statSync(archivePath);
  if (stat.size !== manifest.artifact.bytes || sha256File(archivePath) !== manifest.artifact.sha256) {
    throw new Error('archive bytes or SHA-256 does not match release manifest');
  }
  const files = inspectRuntimeArchive(archivePath);
  if (JSON.stringify(files) !== JSON.stringify(manifest.runtime.files)) throw new Error('archive file manifest does not match release manifest');
  if (sha256(JSON.stringify(files)) !== manifest.runtime.treeManifestSha256) throw new Error('archive tree digest does not match release manifest');
  return { files };
}

/**
 * Materialize an already-verified archive into a brand-new, private staging
 * directory. The local macOS smoke uses this so it never tests the mutable
 * upstream build tree instead of the exact files that were archived.
 *
 * This is intentionally not the future F2 installer: it has no download or
 * user-data semantics. It exists only to make F0's build evidence test the
 * artifact bytes that are locally smoke-tested.
 */
export function extractVerifiedRuntimeBundle({ manifest, archivePath, outputDir }) {
  const { files } = verifyReleaseBundle({ manifest, archivePath });
  const destination = path.resolve(outputDir);
  if (fs.existsSync(destination)) throw new Error('runtime extraction destination must not already exist');
  fs.mkdirSync(destination, { mode: 0o700 });

  const archive = gunzipSync(fs.readFileSync(archivePath));
  const expected = new Map(files.map((file) => [file.path, file]));
  let cursor = 0;
  while (cursor + BLOCK_BYTES <= archive.length) {
    const header = archive.subarray(cursor, cursor + BLOCK_BYTES);
    if (header.equals(ZERO_BLOCK)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const entry = expected.get(name);
    if (!entry) throw new Error('verified runtime archive changed during extraction');
    const size = readTarOctal(header, 124, 12);
    const bodyStart = cursor + BLOCK_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > archive.length) throw new Error('verified runtime archive changed during extraction');
    const body = archive.subarray(bodyStart, bodyEnd);
    if (body.length !== entry.bytes || sha256(body) !== entry.sha256) {
      throw new Error('verified runtime archive changed during extraction');
    }
    const candidate = path.resolve(destination, name);
    if (!candidate.startsWith(`${destination}${path.sep}`)) throw new Error('runtime extraction path escapes destination');
    fs.writeFileSync(candidate, body, { flag: 'wx', mode: entry.mode & 0o777 });
    fs.chmodSync(candidate, entry.mode & 0o777);
    expected.delete(name);
    const padding = (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
    cursor = bodyEnd + padding;
  }
  if (expected.size !== 0) throw new Error('verified runtime archive omitted an expected file during extraction');
  return { outputDir: destination, files };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['verify-input', 'apply-adaptations', 'verify-adaptations', 'verify-toolchain', 'verify-pnpm-tarball', 'verify-sea-base', 'package', 'verify-bundle', 'extract-bundle'].includes(command)) throw new Error('usage: dsh-source-build-release <verify-input|apply-adaptations|verify-adaptations|verify-toolchain|verify-pnpm-tarball|verify-sea-base|package|verify-bundle|extract-bundle> ...');
  const args = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error('arguments must be --key value pairs');
    args[key.slice(2)] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'extract-bundle') {
    if (!args.manifest || !args.archive || !args['output-dir']) {
      throw new Error('extract-bundle requires --manifest --archive --output-dir');
    }
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const result = extractVerifiedRuntimeBundle({ manifest, archivePath: args.archive, outputDir: args['output-dir'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', outputDir: result.outputDir })}\n`);
    return;
  }
  if (args.command === 'verify-bundle') {
    if (!args.manifest || !args.archive) throw new Error('verify-bundle requires --manifest and --archive');
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    verifyReleaseBundle({ manifest, archivePath: args.archive });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', manifest: path.basename(args.manifest) })}\n`);
    return;
  }
  if (!args.release) throw new Error(`${args.command} requires --release`);
  const release = readSourceRelease(args.release);
  if (args.command === 'verify-pnpm-tarball') {
    if (!args.tarball) throw new Error('verify-pnpm-tarball requires --tarball');
    const result = verifyPinnedPnpmTarball({ release, tarballPath: args.tarball });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
    return;
  }
  if (args.command === 'verify-sea-base') {
    if (!args.target || !args.archive) throw new Error('verify-sea-base requires --target --archive');
    const result = verifySeaBaseArchive({ release, targetKey: args.target, archivePath: args.archive });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
    return;
  }
  if (args.command === 'verify-toolchain') {
    if (!args['repo-root']) throw new Error('verify-toolchain requires --repo-root');
    const result = verifyPinnedBuildToolchain({ release, repoRoot: args['repo-root'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
    return;
  }
  if (args.command === 'apply-adaptations') {
    if (!args['repo-root'] || !args['source-root']) throw new Error('apply-adaptations requires --repo-root and --source-root');
    const results = applyReleaseAdaptations({ release, repoRoot: args['repo-root'], sourceRoot: args['source-root'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', adaptations: results })}\n`);
    return;
  }
  if (args.command === 'verify-adaptations') {
    if (!args['repo-root'] || !args['source-root']) throw new Error('verify-adaptations requires --repo-root and --source-root');
    const results = verifyAppliedReleaseAdaptations({ release, repoRoot: args['repo-root'], sourceRoot: args['source-root'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', adaptations: results })}\n`);
    return;
  }
  if (!args['source-root']) throw new Error(`${args.command} requires --source-root`);
  if (args.command === 'verify-input') {
    const result = verifySourceInput({ release, sourceRoot: args['source-root'] });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
    return;
  }
  if (!args.target || !args['output-dir']) throw new Error('package requires --target and --output-dir');
  const result = packageSourceRuntime({ release, sourceRoot: args['source-root'], targetKey: args.target, outputDir: args['output-dir'] });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', archive: result.archivePath, manifest: result.manifestPath })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`dsh-source-build-release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
