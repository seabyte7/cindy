#!/usr/bin/env node
/**
 * Replace the upstream source build's mutable `pnpm dlx @yao-pkg/pkg@6.21.0`
 * call with the same version from Cindy's frozen toolchain lock. Every other
 * pnpm call delegates to the release-integrity-verified pnpm CLI selected by
 * CI. The workflow exposes this wrapper only as a temporary PATH shim for the
 * upstream build subprocess, never as npm_execpath, so pnpm's own dependency
 * state checks cannot recursively select it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLCHAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pkg-toolchain');
const PKG_ENTRY = path.join(TOOLCHAIN_ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const PINNED_SPEC = '@yao-pkg/pkg@6.21.0';

export function isPinnedPkgDlx(args) {
  return args[0] === 'dlx' && args[1] === PINNED_SPEC;
}

function verifiedPnpmCli() {
  const candidate = process.env.CINDY_DSH_PNPM_CLI;
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error('CINDY_DSH_PNPM_CLI must identify the integrity-verified pnpm CLI');
  }
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('CINDY_DSH_PNPM_CLI must be a regular file');
  return candidate;
}

function main() {
  const args = process.argv.slice(2);
  const pinnedPkg = isPinnedPkgDlx(args);
  const command = process.execPath;
  const commandArgs = pinnedPkg ? [PKG_ENTRY, ...args.slice(2)] : [verifiedPnpmCli(), ...args];
  if (pinnedPkg && !fs.statSync(PKG_ENTRY).isFile()) {
    throw new Error(`Cindy DSH pkg toolchain is missing ${PKG_ENTRY}; install its frozen lock before building`);
  }
  const env = { ...process.env };
  delete env.npm_execpath;
  const child = spawn(command, commandArgs, { stdio: 'inherit', env });
  child.once('error', (error) => {
    process.stderr.write(`pnpm-dsh-build-wrapper: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
