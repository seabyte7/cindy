#!/usr/bin/env node
/**
 * Daily DSH Desktop development entrypoint.
 *
 * It always uses one named isolated profile (`dsh-dev`) and the one local
 * signed DSH capsule produced by package:dsh:local-macos.  No production
 * userData, database, refresh token, or safe-storage ciphertext is copied.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDesktopDevRegion } from './shared/desktop-dev-region.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH_CAPSULE_RELATIVE_PATH = Object.freeze([
  'apps', 'desktop', 'out', 'Cindy-darwin-arm64', 'Cindy.app',
]);
const DSH_DESCRIPTOR_RELATIVE_PATH = Object.freeze([
  'Contents', 'Helpers', 'Cindy DSH Supervisor.app', 'Contents', 'Resources',
  'cindy-dsh-supervised-runtime.json',
]);
const DSH_MAIN_BRIDGE_RELATIVE_PATH = Object.freeze([
  'Contents', 'Resources', 'cindy-dsh-main-bookmark-bridge.node',
]);

function usage() {
  return [
    'usage: pnpm dsh:dev -- [--region cn|global|dev] [--local] [--endpoints-cdn] [--isolated-auth]',
    'Starts the persistent named dsh-dev profile; configuration entered in that profile is reused on later runs.',
  ].join('\n');
}

function assertRealDirectory(candidate, label) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  return fs.realpathSync(candidate);
}

function assertRealFile(candidate, label) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real file`);
  }
  return fs.realpathSync(candidate);
}

function readPinnedDshRelease(root = rootDir) {
  const candidate = path.join(root, 'tools', 'dsh', 'macos-supervised-source-release.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    throw new Error('checked-in DSH macOS release pin is unreadable');
  }
  if (
    !parsed || typeof parsed !== 'object'
    || typeof parsed.releaseId !== 'string' || !parsed.releaseId
    || typeof parsed.runtime?.expectedVersion !== 'string' || !parsed.runtime.expectedVersion
  ) {
    throw new Error('checked-in DSH macOS release pin is invalid');
  }
  return Object.freeze({
    releaseId: parsed.releaseId,
    expectedVersion: parsed.runtime.expectedVersion,
  });
}

export function developmentDshCapsulePath(root = rootDir) {
  return path.join(root, ...DSH_CAPSULE_RELATIVE_PATH);
}

/**
 * A source run may use only the stable local package made by the dedicated
 * DSH packaging command.  The Main process repeats topology/signature checks
 * before every bridge launch; this launcher adds an early actionable error.
 */
export function assertDevelopmentDshCapsule(
  root = rootDir,
  run = spawnSync,
  runtime = { platform: process.platform, arch: process.arch },
) {
  if (runtime.platform !== 'darwin' || runtime.arch !== 'arm64') {
    throw new Error(`DSH development requires darwin-arm64; current platform is ${runtime.platform}-${runtime.arch}`);
  }
  const capsule = assertRealDirectory(developmentDshCapsulePath(root), 'DSH development capsule');
  const descriptorPath = assertRealFile(
    path.join(capsule, ...DSH_DESCRIPTOR_RELATIVE_PATH),
    'DSH development capsule descriptor',
  );
  assertRealFile(
    path.join(capsule, ...DSH_MAIN_BRIDGE_RELATIVE_PATH),
    'DSH development capsule Main bookmark bridge',
  );
  let descriptor;
  try {
    descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  } catch {
    throw new Error('DSH development capsule descriptor is unreadable');
  }
  const pin = readPinnedDshRelease(root);
  if (
    !descriptor || typeof descriptor !== 'object'
    || descriptor.target !== 'darwin-arm64'
    || descriptor.releaseId !== pin.releaseId
    || descriptor.expectedVersion !== pin.expectedVersion
  ) {
    throw new Error('DSH development capsule does not match the checked-in DSH release pin');
  }
  const signature = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', capsule], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (signature.error || signature.status !== 0) {
    throw new Error('DSH development capsule signature is invalid or unavailable');
  }
  return Object.freeze({ capsule, ...pin });
}

export function parseDshDevArgs(argv, env = process.env) {
  const region = resolveDesktopDevRegion(argv, env);
  const forwarded = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--region') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--region=')) continue;
    if (arg === '--' || arg === '--local' || arg === '--endpoints-cdn' || arg === '--isolated-auth') {
      if (arg !== '--') forwarded.push(arg);
      continue;
    }
    throw new Error(usage());
  }
  return Object.freeze({
    region,
    restartArgs: Object.freeze([
      `--region=${region}`,
      '--isolated=dsh-dev',
      ...forwarded,
    ]),
  });
}

export function buildDshDevCommand(argv, env = process.env) {
  const parsed = parseDshDevArgs(argv, env);
  return Object.freeze({
    command: process.execPath,
    args: [path.join(rootDir, 'scripts', 'desktop-restart-runner.mjs'), ...parsed.restartArgs],
    env: Object.freeze({
      ...env,
      XDT_DSH_DEVELOPMENT_CAPSULE: '1',
    }),
  });
}

function main() {
  try {
    if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
      console.log(usage());
      return;
    }
    assertDevelopmentDshCapsule();
    const command = buildDshDevCommand(process.argv.slice(2));
    const result = spawnSync(command.command, command.args, {
      cwd: rootDir,
      env: command.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
