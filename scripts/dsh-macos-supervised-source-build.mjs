#!/usr/bin/env node
/**
 * Reproducible local-only macOS source-build entrypoint for the supervised DSH
 * runtime. It deliberately accepts every mutable input as an explicit local
 * path, verifies them before changing the disposable source checkout, and
 * gives pkg only a temporary HOME containing the pre-verified SEA base.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyReleaseAdaptations,
  packageSourceRuntime,
  readSourceRelease,
  verifyAppliedReleaseAdaptations,
  verifyPinnedBuildToolchain,
  verifyPinnedPnpmTarball,
  verifyReleaseBundle,
  verifySeaBaseArchive,
  verifySourceInput,
} from './dsh-source-build-release.mjs';

const TARGET = 'darwin-arm64';

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}

function assertRealDirectory(value, label) {
  const candidate = requireAbsolutePath(value, label);
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
  // macOS commonly exposes /var through /private/var. Canonicalize that
  // system alias, while still rejecting a symlink at the admitted directory.
  return fs.realpathSync(candidate);
}

function assertRegularFile(value, label) {
  const candidate = requireAbsolutePath(value, label);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return candidate;
}

/**
 * A preinstalled dependency tree is neither a release input nor a safe cache:
 * a pinned pnpm can otherwise prompt to replace it, or reuse dependencies
 * whose store/provenance was never admitted.  The caller must supply a fresh
 * disposable checkout rather than letting a headless build make that choice.
 */
export function assertSourceCheckoutHasNoNodeModules(sourceRoot) {
  const root = assertRealDirectory(sourceRoot, 'disposable source checkout');
  const dependencyTree = path.join(root, 'node_modules');
  try {
    fs.lstatSync(dependencyTree);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return root;
    throw error;
  }
  throw new Error('disposable source checkout must not contain node_modules');
}

/** The build creates its evidence directory; it must never overwrite an old one. */
export function assertFreshOutputDirectory(value) {
  const requested = requireAbsolutePath(value, 'output directory');
  if (fs.existsSync(requested)) throw new Error('output directory must not already exist');
  const parent = assertRealDirectory(path.dirname(requested), 'output directory parent');
  const destination = path.join(parent, path.basename(requested));
  if (fs.existsSync(destination)) throw new Error('output directory must not already exist');
  return destination;
}

function run(command, args, options, label) {
  // The source build may emit a package-manager diagnostic before it exits.
  // Inheriting stdio preserves that evidence and, critically, does not leave
  // an upstream interactive prompt hidden behind a private sync pipe.
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    const reason = (result.error?.message || '').trim();
    throw new Error(`${label} failed${result.status === null ? '' : ` (exit ${result.status})`}${reason ? `: ${reason}` : ''}`);
  }
  return result;
}

/** Parse an explicit, non-interactive local build request. */
export function parseDshMacosSourceBuildArgs(argv) {
  // pnpm forwards the conventional script separator.  Accept exactly one at
  // the beginning so the documented `pnpm run <script> -- --flag value`
  // invocation remains explicit while an injected separator cannot be parsed
  // as a build argument later in the list.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const values = {};
  const expected = new Set(['--release', '--repo-root', '--source-root', '--node-archive', '--pnpm-tarball', '--output-dir']);
  if (args.length % 2 !== 0) throw new Error('DSH macOS source build requires flag/value pairs');
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!expected.has(flag) || typeof value !== 'string' || !value || values[flag] !== undefined) {
      throw new Error('invalid or duplicate DSH macOS source-build argument');
    }
    values[flag] = value;
  }
  for (const flag of expected) {
    if (values[flag] === undefined) throw new Error(`DSH macOS source build requires ${flag}`);
  }
  return Object.freeze({
    releasePath: values['--release'],
    repoRoot: values['--repo-root'],
    sourceRoot: values['--source-root'],
    nodeArchive: values['--node-archive'],
    pnpmTarball: values['--pnpm-tarball'],
    outputDir: values['--output-dir'],
  });
}

/** The release is Mac-arm64 only and is built by the exact pinned local Node. */
export function assertMacosSourceBuildHost(release, host = process) {
  if (host.platform !== 'darwin' || host.arch !== 'arm64') {
    throw new Error(`DSH supervised source build is limited to local ${TARGET}`);
  }
  const target = release.targets?.[TARGET];
  if (!target || target.buildTarget !== 'node24.20.0-macos-arm64') {
    throw new Error('DSH supervised source release does not declare the fixed darwin-arm64 target');
  }
  if (host.versions?.node !== release.builder.node) {
    throw new Error(`DSH supervised source build requires Node ${release.builder.node}`);
  }
  return target;
}

function assertRegularTree(root, label) {
  const actualRoot = assertRealDirectory(root, label);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symlink`);
      if (stat.isDirectory()) visit(candidate);
      else if (!stat.isFile()) throw new Error(`${label} contains a special file`);
    }
  }
  visit(actualRoot);
  return actualRoot;
}

/** Extract only the integrity-verified pnpm npm package into a private root. */
export function extractVerifiedPnpm({ tarball, destination }) {
  const packageRoot = assertRealDirectory(destination, 'pnpm extraction root');
  run('/usr/bin/tar', ['-xzf', tarball, '-C', packageRoot], {}, 'extract verified pnpm tarball');
  const extracted = assertRegularTree(path.join(packageRoot, 'package'), 'verified pnpm package');
  return assertRegularFile(path.join(extracted, 'bin', 'pnpm.cjs'), 'verified pnpm CLI');
}

/** Seed pkg's private SEA cache only after the source-release digest check. */
export function stageVerifiedSeaBase({ archive, cacheHome }) {
  const source = assertRegularFile(archive, 'verified SEA base archive');
  const home = assertRealDirectory(cacheHome, 'private pkg cache Home');
  const seaDirectory = path.join(home, '.pkg-cache', 'sea');
  fs.mkdirSync(seaDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(seaDirectory, path.basename(source));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
  fs.writeFileSync(`${destination}.ok`, '', { mode: 0o600, flag: 'wx' });
  return destination;
}

/** Make the upstream's PATH lookup reach only Cindy's digest-bound wrapper. */
export function writePnpmShim({ directory, wrapperPath }) {
  const shimDirectory = assertRealDirectory(directory, 'pnpm shim directory');
  const wrapper = assertRegularFile(wrapperPath, 'Cindy pnpm wrapper');
  const target = path.join(shimDirectory, 'pnpm');
  const source = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(wrapper)}, ...process.argv.slice(2)], { stdio: 'inherit' });\nif (result.error) throw result.error;\nprocess.exitCode = result.status ?? 1;\n`;
  fs.writeFileSync(target, source, { mode: 0o700, flag: 'wx' });
  return target;
}

/** Keep child shebangs on the already host-verified Node without admitting PATH. */
export function writeNodeShim({ directory }) {
  const shimDirectory = assertRealDirectory(directory, 'Node shim directory');
  const target = path.join(shimDirectory, 'node');
  const source = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst result = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });\nif (result.error) throw result.error;\nprocess.exitCode = result.status ?? 1;\n`;
  fs.writeFileSync(target, source, { mode: 0o700, flag: 'wx' });
  return target;
}

/**
 * The pinned upstream build's root script uses `npm run` for script nesting.
 * Preserve that narrow compatibility surface without admitting the host npm
 * client or allowing npm install/publish/network commands.
 */
export function writeNpmRunShim({ directory, wrapperPath }) {
  const shimDirectory = assertRealDirectory(directory, 'npm shim directory');
  const wrapper = assertRegularFile(wrapperPath, 'Cindy pnpm wrapper');
  const target = path.join(shimDirectory, 'npm');
  const source = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst args = process.argv.slice(2);\nif (args[0] !== 'run' && args[0] !== 'run-script') {\n  process.stderr.write('Cindy DSH build permits only npm run compatibility calls\\n');\n  process.exitCode = 1;\n} else {\n  const result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(wrapper)}, ...args], { stdio: 'inherit' });\n  if (result.error) throw result.error;\n  process.exitCode = result.status ?? 1;\n}\n`;
  fs.writeFileSync(target, source, { mode: 0o700, flag: 'wx' });
  return target;
}

export function sourceBuildEnvironment({ temporaryRoot, pnpmCli, wrapperPath }) {
  const home = path.join(temporaryRoot, 'home');
  const temporary = path.join(temporaryRoot, 'tmp');
  const shim = path.join(temporaryRoot, 'bin');
  const corepackRoot = path.join(temporaryRoot, 'corepack-disabled');
  const pnpmStore = path.join(temporaryRoot, 'pnpm-store');
  for (const directory of [home, temporary, shim, corepackRoot, pnpmStore]) fs.mkdirSync(directory, { mode: 0o700 });
  writePnpmShim({ directory: shim, wrapperPath });
  writeNodeShim({ directory: shim });
  writeNpmRunShim({ directory: shim, wrapperPath });
  return {
    home,
    pnpmStore,
    env: Object.freeze({
      CI: 'true',
      CINDY_DSH_NO_COREPACK: '1',
      COREPACK_ROOT: corepackRoot,
      CINDY_DSH_OFFLINE_BUILD: '1',
      CINDY_DSH_PNPM_CLI: pnpmCli,
      HOME: home,
      // The caller admits only a checkout with no node_modules, and the
      // entire build happens in a disposable worktree.  Still set the pnpm
      // config explicitly so a future upstream install phase can never park
      // a headless local build behind a destructive-confirmation prompt.
      npm_config_confirm_modules_purge: 'false',
      // Source dependencies are populated only into this new private store.
      // No user-level pnpm store may influence either fetch or offline install.
      npm_config_store_dir: pnpmStore,
      // Every descendant package-manager command, including upstream's
      // `pnpm --filter … deploy`, must fail closed if the pre-fetched store is
      // incomplete. The initial, separately invoked `fetch` below is the sole
      // ingress and explicitly overrides this flag.
      npm_config_offline: 'true',
      PATH: `${shim}:/usr/bin:/bin`,
      TMPDIR: temporary,
    }),
  };
}

/**
 * `pnpm deploy` rewrites a workspace `file:` dependency to an absolute file
 * URL before it evaluates lifecycle-build policy.  The reviewed source policy
 * deliberately names the original relative locator, so inject one exact,
 * disposable equivalent for this verified checkout only.  It is restored
 * before the build returns (including on failure), leaving the release-bound
 * source postimage intact.
 */
export function applyDeployBuildPolicyOverlay({ sourceRoot }) {
  const root = assertRealDirectory(sourceRoot, 'disposable source checkout');
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const original = fs.readFileSync(workspacePath, 'utf8');
  const marker = 'allowBuilds:\n';
  const reviewedRule = "  '@deepseek-ai/dsh-subprocess-local@file:packages/subprocess/subprocess-local': true\n";
  if (original.indexOf(marker) !== original.lastIndexOf(marker) || !original.includes(reviewedRule)) {
    throw new Error('reviewed DSH workspace build policy is missing or ambiguous');
  }
  const absoluteLocator = `@deepseek-ai/dsh-subprocess-local@${pathToFileURL(path.join(root, 'packages/subprocess/subprocess-local')).href}`;
  const overlayRule = `  '${absoluteLocator}': true\n`;
  if (original.includes(overlayRule)) throw new Error('DSH workspace deploy policy overlay already exists');
  fs.writeFileSync(workspacePath, original.replace(marker, `${marker}${overlayRule}`), { mode: 0o600 });
  return () => fs.writeFileSync(workspacePath, original, { mode: 0o600 });
}

export function buildMacosSupervisedDshRuntime(options) {
  const releasePath = assertRegularFile(options.releasePath, 'source release');
  const repoRoot = assertRealDirectory(options.repoRoot, 'repository root');
  const sourceRoot = assertSourceCheckoutHasNoNodeModules(options.sourceRoot);
  const nodeArchive = assertRegularFile(options.nodeArchive, 'Node SEA base archive');
  const pnpmTarball = assertRegularFile(options.pnpmTarball, 'pnpm tarball');
  const outputDir = assertFreshOutputDirectory(options.outputDir);
  const release = readSourceRelease(releasePath);
  const target = assertMacosSourceBuildHost(release, options.host ?? process);

  // These checks occur before the one permitted mutation (applying the
  // release-declared adaptations) to the caller's disposable source checkout.
  verifyPinnedBuildToolchain({ release, repoRoot });
  verifyPinnedPnpmTarball({ release, tarballPath: pnpmTarball });
  verifySeaBaseArchive({ release, targetKey: TARGET, archivePath: nodeArchive });
  verifySourceInput({ release, sourceRoot });

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-macos-build-'));
  try {
    const pnpmExtraction = path.join(temporaryRoot, 'pnpm');
    fs.mkdirSync(pnpmExtraction, { mode: 0o700 });
    const pnpmCli = extractVerifiedPnpm({ tarball: pnpmTarball, destination: pnpmExtraction });
    const wrapperPath = path.resolve(repoRoot, release.builder.toolchain.wrapper.path);
    const build = sourceBuildEnvironment({ temporaryRoot, pnpmCli, wrapperPath });
    stageVerifiedSeaBase({ archive: nodeArchive, cacheHome: build.home });

    // The source lockfile is pinned and verified above. Populate a fresh
    // private store before adapting the checkout, with scripts disabled. The
    // following install remains offline; no user/global store is admitted.
    run(process.execPath, [pnpmCli, 'fetch', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: sourceRoot,
      env: { ...build.env, npm_config_offline: 'false' },
    }, 'locked DSH dependency fetch');
    applyReleaseAdaptations({ release, repoRoot, sourceRoot });
    verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot });
    run(process.execPath, [wrapperPath, ...release.builder.install.slice(1)], { cwd: sourceRoot, env: build.env }, 'offline DSH dependency install');
    const restoreDeployBuildPolicy = applyDeployBuildPolicyOverlay({ sourceRoot });
    try {
      run(process.execPath, [wrapperPath, ...release.builder.command.slice(1), `--targets=${target.buildTarget}`], { cwd: sourceRoot, env: build.env }, 'local DSH darwin-arm64 source build');
    } finally {
      restoreDeployBuildPolicy();
      verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot });
    }

    const packaged = packageSourceRuntime({ release, sourceRoot, targetKey: TARGET, outputDir });
    // packageSourceRuntime returns the generated manifest object.  The bundle
    // verifier deliberately accepts that evidence object, rather than the
    // source-release input that was used to produce it.
    const verified = verifyReleaseBundle({ manifest: packaged.manifest, archivePath: packaged.archivePath });
    return Object.freeze({ releaseId: release.releaseId, target: TARGET, ...packaged, verified });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function main() {
  const options = parseDshMacosSourceBuildArgs(process.argv.slice(2));
  const result = buildMacosSupervisedDshRuntime(options);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
