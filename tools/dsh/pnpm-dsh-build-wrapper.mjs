#!/usr/bin/env node
/**
 * Replace the upstream source build's mutable `pnpm dlx @yao-pkg/pkg@6.21.0`
 * call with the same version from Cindy's frozen toolchain lock. Every other
 * pnpm call delegates to the release-integrity-verified pnpm CLI selected by
 * CI. The workflow exposes this wrapper only as a temporary PATH shim for the
 * upstream build subprocess, never as npm_execpath, so pnpm's own dependency
 * state checks cannot recursively select it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLCHAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pkg-toolchain');
const PKG_ENTRY = path.join(TOOLCHAIN_ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const PKG_ROOT = path.resolve(PKG_ENTRY, '..', '..');
const PKG_REAL_ROOT = fs.realpathSync(PKG_ROOT);
const PKG_VIRTUAL_STORE = path.join(TOOLCHAIN_ROOT, 'node_modules', '.pnpm');
const PKG_VIRTUAL_DIRECTORY = path.basename(path.dirname(path.dirname(path.dirname(PKG_REAL_ROOT))));
const SEA_BOOTSTRAP_BUNDLE = path.join(PKG_REAL_ROOT, 'prelude', 'sea-bootstrap.bundle.js');
const PINNED_SPEC = '@yao-pkg/pkg@6.21.0';
const SEA_BOOTSTRAP_BUNDLE_SHA256 = '0af9332434f92534c523f483ad665775fbe75cf0f486af1d0d431bbab14a2857';

const SEALED_DLOPEN = String.raw`function patchDlopen(insideSnapshot) {
      var ancestor = process.dlopen;
      var PKG_NATIVE_CACHE_BASE = process.env.PKG_NATIVE_CACHE_PATH || path.join(homedir(), ".cache");
      var sealedCacheRoot = process.env.CINDY_DSH_SEALED_PKG_CACHE_DIR;
      var sealed = typeof sealedCacheRoot === "string" && sealedCacheRoot.length > 0;
      function revertMakingLong(f) {
        if (/^\\\\\\\\?\\/.test(f)) return f.slice(4);
        return f;
      }
      function sealedPath(hash, moduleFolder, moduleBaseName) {
        if (!path.isAbsolute(sealedCacheRoot)) {
          throw new Error("pkg: sealed native cache root is not absolute");
        }
        var parts = moduleFolder.split(path.sep);
        var mIndex = parts.lastIndexOf("node_modules");
        if (mIndex < 0) {
          throw new Error("pkg: sealed native module is outside node_modules");
        }
        var relativeParts = parts.slice(mIndex + 1);
        return path.join.apply(path, [sealedCacheRoot, "pkg", hash].concat(relativeParts, [moduleBaseName]));
      }
      function assertSealedFile(candidate) {
        var rootStat;
        try {
          rootStat = fs.lstatSync(sealedCacheRoot);
        } catch (_) {
          throw new Error("pkg: sealed native cache root is invalid");
        }
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
          throw new Error("pkg: sealed native cache root is invalid");
        }
        var relative = path.relative(sealedCacheRoot, candidate);
        if (!relative || relative === ".." || relative.indexOf(".." + path.sep) === 0 || path.isAbsolute(relative)) {
          throw new Error("pkg: sealed native cache path escapes its root");
        }
        var cursor = sealedCacheRoot;
        var segments = relative.split(path.sep);
        for (var index = 0; index < segments.length; index += 1) {
          cursor = path.join(cursor, segments[index]);
          var stat;
          try {
            stat = fs.lstatSync(cursor);
          } catch (_) {
            throw new Error("pkg: sealed native cache entry is unavailable");
          }
          var last = index === segments.length - 1;
          if ((last && (!stat.isFile() || stat.isSymbolicLink())) || (!last && (!stat.isDirectory() || stat.isSymbolicLink()))) {
            throw new Error("pkg: sealed native cache entry is unavailable");
          }
        }
        return candidate;
      }
      process.dlopen = function dlopen() {
        var args = Array.prototype.slice.call(arguments);
        var modulePath = revertMakingLong(args[1]);
        var moduleBaseName = path.basename(modulePath);
        var moduleFolder = path.dirname(modulePath);
        if (insideSnapshot(modulePath)) {
          var moduleContent = fs.readFileSync(modulePath);
          var hash = createHash("sha256").update(moduleContent).digest("hex");
          var newPath;
          if (sealed) {
            newPath = assertSealedFile(sealedPath(hash, moduleFolder, moduleBaseName));
          } else {
            var tmpFolder = path.join(PKG_NATIVE_CACHE_BASE, "pkg", hash);
            fs.mkdirSync(tmpFolder, { recursive: true });
            var parts = moduleFolder.split(path.sep);
            var mIndex = parts.lastIndexOf("node_modules") + 1;
            if (mIndex > 0) {
              var modulePackagePath = parts.slice(mIndex).join(path.sep);
              var modulePkgFolder = parts.slice(0, mIndex + 1).join(path.sep);
              var destFolder = path.join(tmpFolder, path.basename(modulePkgFolder));
              cpRecursive(modulePkgFolder, destFolder);
              newPath = path.join(tmpFolder, modulePackagePath, moduleBaseName);
            } else {
              var tmpModulePath = path.join(tmpFolder, moduleBaseName);
              if (fs.existsSync(tmpModulePath)) {
                var dContent = fs.readFileSync(tmpModulePath);
                var dHash = createHash("sha256").update(dContent).digest("hex");
                if (hash !== dHash) fs.writeFileSync(tmpModulePath, moduleContent);
              } else {
                fs.writeFileSync(tmpModulePath, moduleContent);
              }
              newPath = tmpModulePath;
            }
          }
          args[1] = newPath;
        }
        return ancestor.apply(process, args);
      };
    }
`;

export function isPinnedPkgDlx(args) {
  return args[0] === 'dlx' && args[1] === PINNED_SPEC;
}

/**
 * The local F0/F2 build path must never turn a missing cache entry into a
 * registry request. The upstream build invokes `pnpm install --production`
 * inside its temporary deployed closure, so the outer frozen install alone
 * cannot enforce that boundary. Keep this opt-in: normal package-manager
 * calls remain byte-for-byte delegated unless the local builder explicitly
 * sets the one-way offline guard.
 */
export function delegatedPnpmArgs(args, offline, noCorepack = false) {
  // `npm_config_offline` is not reliably retained by every nested pnpm
  // invocation in the upstream build (notably `pnpm --filter … deploy`). Put
  // the guard on dependency-materializing commands. `pnpm exec` itself
  // rejects `--offline`, but inherits the environment guard while it runs the
  // upstream script; the sole online fetch is called directly through the
  // verified CLI and never reaches this wrapper.
  const materializesDependencies = args.includes('install') || args.includes('deploy');
  const result = offline && materializesDependencies ? ['--offline', ...args] : [...args];
  if (offline && args[0] === 'install') {
    // The source closure's production install otherwise runs the repository's
    // developer-only lefthook postinstall. It is absent by design from that
    // production graph and has no bearing on the runtime payload; allowing it
    // to run would make the local build depend on unrelated dev tooling.
    if (!result.includes('--offline')) result.push('--offline');
    if (!result.includes('--ignore-scripts')) result.push('--ignore-scripts');
  }
  // Only `install` runs pnpm's package-manager check. The checked-in release
  // defines the exact CLI, so suppress Corepack/version-manager fallback for
  // that command alone. `pnpm exec` treats this setting as a script argument,
  // so adding it there would be both ineffective and unsafe.
  if (noCorepack && args[0] === 'install' && !result.some((argument) => argument === '--pm-on-fail=ignore' || argument.startsWith('--pm-on-fail='))) {
    result.push('--pm-on-fail=ignore');
  }
  return result;
}

export function patchSealedPkgPrelude(bundle) {
  const start = bundle.indexOf('    function patchDlopen(insideSnapshot) {');
  const end = bundle.indexOf('    function patchChildProcess(', start);
  if (start < 0 || end < 0) {
    throw new Error('Cindy DSH pkg toolchain does not contain the reviewed SEA dlopen prelude');
  }
  return `${bundle.slice(0, start)}    ${SEALED_DLOPEN}${bundle.slice(end)}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * A pnpm package's transitive dependencies span its complete virtual store.
 * Stage that frozen store as one regular temporary tree so sealed pkg
 * resolution cannot fall back to Cindy's installed toolchain.
 */
export function stageSealedPkgToolchain(temporaryRoot) {
  const stagedVirtualStore = path.join(temporaryRoot, '.pnpm');
  const copied = spawnSync('/bin/cp', ['-RL', PKG_VIRTUAL_STORE, stagedVirtualStore], { encoding: 'utf8' });
  if (copied.error || copied.status !== 0) {
    throw new Error(`Cindy DSH pkg toolchain staging failed${copied.stderr ? `: ${copied.stderr.trim()}` : ''}`);
  }
  function assertRegularTree(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error('Cindy DSH pkg toolchain staging contains a non-regular entry');
      }
      if (stat.isDirectory()) assertRegularTree(candidate);
    }
  }
  assertRegularTree(stagedVirtualStore);
  const stagedRoot = path.join(stagedVirtualStore, PKG_VIRTUAL_DIRECTORY, 'node_modules', '@yao-pkg', 'pkg');
  const stagedEntry = path.join(stagedRoot, 'lib-es5', 'bin.js');
  if (!fs.statSync(stagedEntry).isFile()) {
    throw new Error('Cindy DSH pkg toolchain staging omitted the pkg entrypoint');
  }
  const stagedFetch = path.join(stagedVirtualStore, PKG_VIRTUAL_DIRECTORY, 'node_modules', '@yao-pkg', 'pkg-fetch');
  if (!fs.statSync(stagedFetch).isDirectory()) {
    throw new Error('Cindy DSH pkg toolchain staging omitted pkg-fetch');
  }
  return { stagedRoot, stagedEntry };
}

/**
 * The package manager never mutates Cindy's frozen toolchain. For the one
 * supervised SEA build, materialize its whole dependency closure in a
 * temporary regular tree and pin its exact prelude digest.
 */
function preparePkgEntry() {
  if (process.env.CINDY_DSH_SEALED_PKG_CACHE_BUILD !== '1') {
    return { entry: PKG_ENTRY, cleanup: () => {} };
  }
  const original = fs.readFileSync(SEA_BOOTSTRAP_BUNDLE, 'utf8');
  if (sha256(original) !== SEA_BOOTSTRAP_BUNDLE_SHA256) {
    throw new Error('Cindy DSH pkg SEA bootstrap digest does not match the reviewed toolchain');
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-pkg-sealed-'));
  try {
    const { stagedRoot, stagedEntry } = stageSealedPkgToolchain(temporaryRoot);
    fs.writeFileSync(path.join(stagedRoot, 'prelude', 'sea-bootstrap.bundle.js'), patchSealedPkgPrelude(original), { mode: 0o600 });
    return {
      entry: stagedEntry,
      cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
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
  const preparedPkg = pinnedPkg ? preparePkgEntry() : { entry: PKG_ENTRY, cleanup: () => {} };
  const command = process.execPath;
  const commandArgs = pinnedPkg
    ? [preparedPkg.entry, ...args.slice(2)]
    : [verifiedPnpmCli(), ...delegatedPnpmArgs(
      args,
      process.env.CINDY_DSH_OFFLINE_BUILD === '1',
      process.env.CINDY_DSH_NO_COREPACK === '1',
    )];
  if (pinnedPkg && !fs.statSync(PKG_ENTRY).isFile()) {
    throw new Error(`Cindy DSH pkg toolchain is missing ${PKG_ENTRY}; install its frozen lock before building`);
  }
  const env = { ...process.env };
  // Sealed pkg runs from the staged regular closure. Do not carry NODE_PATH
  // from Cindy's original toolchain into the subprocess.
  delete env.NODE_PATH;
  delete env.npm_execpath;
  const child = spawn(command, commandArgs, { stdio: 'inherit', env });
  child.once('error', (error) => {
    preparedPkg.cleanup();
    process.stderr.write(`pnpm-dsh-build-wrapper: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    preparedPkg.cleanup();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
