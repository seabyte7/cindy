#!/usr/bin/env node
/**
 * Runtime-only smoke for a Cindy source-built DSH archive.
 *
 * This uses the public ACP interface directly for the only approved local
 * development artifact: darwin-arm64. It is not a product registration path;
 * the Desktop Main end-to-end bridge suite remains separate.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readSourceRelease } from './dsh-source-build-release.mjs';
import { runAcpLifecycle, runVersion } from './dsh-native-host-gate.mjs';

function platformKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  throw new Error(`local DSH smoke is limited to darwin-arm64, got ${process.platform}-${process.arch}`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error('arguments must be --key value pairs');
    args[key.slice(2)] = value;
  }
  if (!args.release || !args.target || !args.binary) throw new Error('usage: dsh-source-runtime-smoke --release <json> --target <key> --binary <absolute-path>');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = readSourceRelease(args.release);
  const target = release.targets[args.target];
  if (!target) throw new Error(`source release does not declare target ${args.target}`);
  if (args.target !== platformKey()) throw new Error(`target ${args.target} does not match this runner`);
  const binary = path.resolve(args.binary);
  const binaryStat = fs.lstatSync(binary);
  if (!path.isAbsolute(args.binary) || path.basename(binary) !== target.executable || !binaryStat.isFile() || binaryStat.isSymbolicLink()) {
    throw new Error('binary must be the declared absolute runtime executable');
  }
  for (const sidecar of target.sidecars) {
    const candidate = path.join(path.dirname(binary), sidecar);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || (!sidecar.endsWith('.exe') && (stat.mode & 0o111) === 0)) {
      throw new Error(`declared runtime sidecar is missing or not executable: ${sidecar}`);
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-source-runtime-smoke-'));
  const launcher = path.join(root, 'launcher');
  const home = path.join(root, 'home');
  const dshHome = path.join(root, 'dsh-home');
  fs.mkdirSync(launcher, { mode: 0o700 });
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(dshHome, { mode: 0o700 });
  const env = process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: root, TMP: root, USERPROFILE: home, DSH_HOME: dshHome }
    : { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: root, DSH_HOME: dshHome };
  try {
    const version = await runVersion(binary, launcher, env);
    if (version !== release.runtime.expectedVersion) throw new Error(`runtime --version ${JSON.stringify(version)} does not match release`);
    const acp = await runAcpLifecycle(binary, launcher, env, { acpHandshake: release.runtime.acpHandshake });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', target: args.target, version, acp })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`dsh-source-runtime-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
