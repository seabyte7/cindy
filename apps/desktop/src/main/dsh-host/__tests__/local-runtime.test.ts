import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DSH_LOCAL_RUNTIME_TARGET,
  installDshLocalRuntime,
  inspectDshLocalRuntimeArchive,
  parseDshLocalRuntimePin,
  verifyInstalledDshLocalRuntime,
  type DshLocalRuntimePin,
  type DshRuntimeFile,
} from '../local-runtime.js';

const temporaryRoots: string[] = [];
const TAR_BLOCK_BYTES = 512;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

function tarArchive(entries: readonly { path: string; body: Buffer; mode?: number }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(TAR_BLOCK_BYTES);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, entry.mode ?? 0o755, 100, 8);
    writeOctal(header, entry.body.length, 124, 12);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    chunks.push(header, entry.body);
    const padding = (TAR_BLOCK_BYTES - (entry.body.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES), Buffer.alloc(TAR_BLOCK_BYTES));
  return gzipSync(Buffer.concat(chunks), { mtime: 0 });
}

function fixturePin(entries: readonly { path: string; body: Buffer; mode?: number }[], archive: Buffer): DshLocalRuntimePin {
  const files: DshRuntimeFile[] = entries.map((entry) => ({
    path: entry.path,
    bytes: entry.body.length,
    mode: entry.mode ?? 0o755,
    sha256: sha256(entry.body),
  })).sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    scope: 'local-darwin-arm64-development-only',
    releaseId: 'dsh-test-1',
    target: DSH_LOCAL_RUNTIME_TARGET,
    runtime: {
      expectedVersion: '0.0.test',
      executable: 'dsh',
      requiredSidecars: ['dsh-rg'],
      treeManifestSha256: sha256(JSON.stringify(files)),
      files,
    },
    artifact: {
      filename: 'dsh-test-1-darwin-arm64.tar.gz',
      bytes: archive.length,
      sha256: sha256(archive),
    },
  };
}

function writeFixture(entries = [
  { path: 'dsh', body: Buffer.from('#!/bin/sh\necho dsh\n') },
  { path: 'dsh-rg', body: Buffer.from('#!/bin/sh\necho rg\n') },
]): { root: string; archivePath: string; manifestPath: string; pin: DshLocalRuntimePin } {
  const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-local-runtime-'));
  temporaryRoots.push(root);
  const archive = tarArchive(entries);
  const pin = fixturePin(entries, archive);
  const archivePath = join(root, pin.artifact.filename);
  const manifestPath = join(root, 'bundle.json');
  writeFileSync(archivePath, archive, { mode: 0o600 });
  // F0's bundle manifest has no `scope`; it is added only by the checked-in
  // local pin, so prove that the installer compares the actual evidence shape.
  const { scope: _scope, ...bundle } = pin;
  writeFileSync(manifestPath, JSON.stringify({
    ...bundle,
    targets: {
      'darwin-arm64': {
        executable: pin.runtime.executable,
        sidecars: pin.runtime.requiredSidecars,
      },
    },
  }), { mode: 0o600 });
  return { root, archivePath, manifestPath, pin };
}

describe('DSH local runtime installer', () => {
  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('installs a manifest-bound F0 archive and rechecks it before use', () => {
    const fixture = writeFixture();
    const installRoot = join(fixture.root, 'user-data', 'dsh-runtime');

    const installed = installDshLocalRuntime({
      archivePath: fixture.archivePath,
      bundleManifestPath: fixture.manifestPath,
      pin: fixture.pin,
      installRoot,
    });

    expect(installed.binaryPath).toBe(join(installed.installDirectory, 'dsh'));
    expect(readFileSync(installed.binaryPath, 'utf8')).toContain('echo dsh');
    expect(verifyInstalledDshLocalRuntime({
      installDirectory: join(installRoot, fixture.pin.releaseId),
      pin: fixture.pin,
    }).sidecarPaths).toEqual([join(installed.installDirectory, 'dsh-rg')]);

    writeFileSync(join(installRoot, fixture.pin.releaseId, 'dsh-rg'), '#!/bin/sh\necho altered\n');
    expect(() => verifyInstalledDshLocalRuntime({
      installDirectory: join(installRoot, fixture.pin.releaseId),
      pin: fixture.pin,
    })).toThrow('mode or size');
  });

  it('rejects all non-darwin-arm64 runtime admission before archive parsing', () => {
    const fixture = writeFixture();
    expect(() => inspectDshLocalRuntimeArchive({
      archivePath: fixture.archivePath,
      bundleManifestPath: fixture.manifestPath,
      pin: fixture.pin,
      platform: 'linux',
      arch: 'x64',
    })).toThrow('only darwin-arm64 is admitted');
  });

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('rejects an otherwise valid archive when the F0 bundle disagrees with the pin', () => {
    const fixture = writeFixture();
    const bundle = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as { runtime: { expectedVersion: string } };
    bundle.runtime.expectedVersion = 'wrong';
    writeFileSync(fixture.manifestPath, JSON.stringify(bundle));
    expect(() => inspectDshLocalRuntimeArchive({
      archivePath: fixture.archivePath,
      bundleManifestPath: fixture.manifestPath,
      pin: fixture.pin,
    })).toThrow('does not match the approved local pin');
  });

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('rejects a symlink substituted into a managed runtime after installation', () => {
    const fixture = writeFixture();
    const installRoot = join(fixture.root, 'user-data', 'dsh-runtime');
    const installed = installDshLocalRuntime({
      archivePath: fixture.archivePath,
      bundleManifestPath: fixture.manifestPath,
      pin: fixture.pin,
      installRoot,
    });
    const sidecar = join(installed.installDirectory, 'dsh-rg');
    const outside = join(fixture.root, 'outside');
    writeFileSync(outside, '#!/bin/sh\n', { mode: 0o755 });
    rmSync(sidecar);
    symlinkSync(outside, sidecar);
    expect(() => verifyInstalledDshLocalRuntime({
      installDirectory: installed.installDirectory,
      pin: fixture.pin,
    })).toThrow('non-regular filesystem entry');
  });

  it('rejects a pin whose tree digest does not bind its full file list', () => {
    const fixture = writeFixture();
    const invalid = structuredClone(fixture.pin) as unknown as { runtime: { treeManifestSha256: string } };
    invalid.runtime.treeManifestSha256 = '0'.repeat(64);
    expect(() => parseDshLocalRuntimePin(invalid)).toThrow('treeManifestSha256 does not match files');
  });

  it('does not accept an F0 bundle manifest as the checked-in local runtime pin', () => {
    const fixture = writeFixture();
    const bundle = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
    expect(() => parseDshLocalRuntimePin(bundle)).toThrow('scope is not an approved local-development scope');
  });

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('rejects a stale F0 bundle that declares another platform', () => {
    const fixture = writeFixture();
    const bundle = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as { targets?: Record<string, unknown> };
    bundle.targets = {
      'darwin-arm64': { executable: 'dsh', sidecars: ['dsh-rg'] },
      'linux-x64': { executable: 'dsh-linux', sidecars: ['dsh-rg'] },
    };
    writeFileSync(fixture.manifestPath, JSON.stringify(bundle));
    expect(() => inspectDshLocalRuntimeArchive({
      archivePath: fixture.archivePath,
      bundleManifestPath: fixture.manifestPath,
      pin: fixture.pin,
    })).toThrow('exactly one local target');
  });
});
