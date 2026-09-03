#!/usr/bin/env node
/**
 * Import an F0-built local DSH archive into an explicitly supplied local
 * directory. This is intentionally an offline developer tool: it has no URL,
 * fetch, package-manager, PATH discovery, or default output directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readSourceRelease,
  verifyReleaseBundle,
} from '../../scripts/dsh-source-build-release.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PIN_PATH = path.join(here, 'latest.json');
const SOURCE_RELEASE_PATH = path.join(here, 'source-release.json');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function localPin(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.scope !== 'local-darwin-arm64-development-only') {
    throw new Error('tools/dsh/latest.json is not a local darwin-arm64 pin');
  }
  if (value.target !== 'darwin-arm64') throw new Error('DSH local pin must target darwin-arm64');
  return value;
}

function assertPinMatchesBundle(pin, bundle) {
  const comparable = ['releaseId', 'target', 'artifact'];
  for (const key of comparable) {
    if (JSON.stringify(pin[key]) !== JSON.stringify(bundle[key])) {
      throw new Error(`F0 bundle ${key} does not match the approved local pin`);
    }
  }
  // F0's runtime object intentionally carries additional evidence such as
  // ACP handshake and build-target details. `verifyReleaseBundle()` validates
  // those full fields first; this local installer pin owns only the immutable
  // executable tree and must compare exactly that subset.
  const runtimeFields = ['expectedVersion', 'executable', 'requiredSidecars', 'treeManifestSha256', 'files'];
  for (const key of runtimeFields) {
    if (JSON.stringify(pin.runtime[key]) !== JSON.stringify(bundle.runtime?.[key])) {
      throw new Error(`F0 bundle runtime.${key} does not match the approved local pin`);
    }
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('usage: update.mjs --bundle-manifest <path> --archive <path> --output-dir <absolute-path>');
    }
    args[key.slice(2)] = value;
  }
  if (!args['bundle-manifest'] || !args.archive || !args['output-dir']) {
    throw new Error('usage: update.mjs --bundle-manifest <path> --archive <path> --output-dir <absolute-path>');
  }
  if (!path.isAbsolute(args['output-dir'])) throw new Error('--output-dir must be an explicit absolute local path');
  return args;
}

function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`local DSH importer is darwin-arm64 only, got ${process.platform}-${process.arch}`);
  }
  const args = parseArgs(process.argv.slice(2));
  const pin = localPin(readJson(PIN_PATH, 'DSH local pin'));
  const sourceRelease = readSourceRelease(SOURCE_RELEASE_PATH);
  if (!sourceRelease.targets['darwin-arm64'] || Object.keys(sourceRelease.targets).length !== 1) {
    throw new Error('source release must retain exactly the approved local target');
  }
  const bundle = readJson(args['bundle-manifest'], 'F0 bundle manifest');
  verifyReleaseBundle({ manifest: bundle, archivePath: args.archive });
  assertPinMatchesBundle(pin, bundle);
  const archive = fs.lstatSync(args.archive);
  if (!archive.isFile() || archive.isSymbolicLink()) throw new Error('F0 archive must be a regular file');
  if (path.basename(args.archive) !== pin.artifact.filename || archive.size !== pin.artifact.bytes) {
    throw new Error('F0 archive filename or size does not match the approved local pin');
  }
  if (fs.existsSync(args['output-dir'])) throw new Error('--output-dir must not already exist');
  fs.mkdirSync(args['output-dir'], { recursive: true, mode: 0o700 });
  fs.copyFileSync(args.archive, path.join(args['output-dir'], pin.artifact.filename), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(args['output-dir'], 'bundle-manifest.json'), `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', releaseId: pin.releaseId, target: pin.target })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`dsh-local-import: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
