import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  applyDeployBuildPolicyOverlay,
  assertMacosSourceBuildHost,
  assertFreshOutputDirectory,
  assertSourceCheckoutHasNoNodeModules,
  buildMacosSupervisedDshRuntime,
  parseDshMacosSourceBuildArgs,
  sourceBuildEnvironment,
  stageVerifiedSeaBase,
  writeNodeShim,
  writeNpmRunShim,
  writePnpmShim,
} from '../dsh-macos-supervised-source-build.mjs';
import { readSourceRelease } from '../dsh-source-build-release.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const release = readSourceRelease(path.join(repoRoot, 'tools/dsh/macos-supervised-source-release.json'));

test('macOS supervised source build accepts only explicit local paths once each', () => {
  const explicitPaths = [
    '--release', '/tmp/release.json',
    '--repo-root', '/tmp/repo',
    '--source-root', '/tmp/source',
    '--node-archive', '/tmp/node.tar.gz',
    '--pnpm-tarball', '/tmp/pnpm.tgz',
    '--output-dir', '/tmp/output',
  ];
  const parsed = parseDshMacosSourceBuildArgs(explicitPaths);
  assert.equal(parsed.sourceRoot, '/tmp/source');
  assert.deepEqual(parseDshMacosSourceBuildArgs(['--', ...explicitPaths]), parsed);
  assert.throws(
    () => parseDshMacosSourceBuildArgs(['--release', '/tmp/release.json']),
    /flag\/value pairs|requires/,
  );
  assert.throws(
    () => parseDshMacosSourceBuildArgs([
      '--release', '/tmp/release.json', '--release', '/tmp/other.json',
      '--repo-root', '/tmp/repo', '--source-root', '/tmp/source',
      '--node-archive', '/tmp/node.tar.gz', '--pnpm-tarball', '/tmp/pnpm.tgz', '--output-dir', '/tmp/output',
    ]),
    /invalid or duplicate/,
  );
});

test('macOS supervised source build rejects any host other than the release-pinned local darwin-arm64 Node', () => {
  assert.equal(
    assertMacosSourceBuildHost(release, { platform: 'darwin', arch: 'arm64', versions: { node: '24.20.0' } }).buildTarget,
    'node24.20.0-macos-arm64',
  );
  assert.throws(
    () => assertMacosSourceBuildHost(release, { platform: 'linux', arch: 'arm64', versions: { node: '24.20.0' } }),
    /limited to local darwin-arm64/,
  );
  assert.throws(
    () => assertMacosSourceBuildHost(release, { platform: 'darwin', arch: 'arm64', versions: { node: '24.21.0' } }),
    /requires Node 24.20.0/,
  );
});

test('macOS supervised source build will create, never overwrite, its output evidence directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-output-'));
  try {
    const missing = path.join(root, 'new-output');
    assert.equal(assertFreshOutputDirectory(missing), path.join(fs.realpathSync(root), 'new-output'));
    fs.mkdirSync(missing);
    assert.throws(() => assertFreshOutputDirectory(missing), /must not already exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS supervised source build rejects a source checkout with an existing dependency tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-source-node-modules-'));
  try {
    fs.mkdirSync(path.join(root, 'node_modules'));
    assert.throws(
      () => assertSourceCheckoutHasNoNodeModules(root),
      /must not contain node_modules/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS supervised source build makes pnpm module cleanup non-interactive inside its private environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-source-environment-'));
  try {
    const pnpmCli = path.join(root, 'pnpm.cjs');
    const wrapper = path.join(root, 'wrapper.mjs');
    fs.writeFileSync(pnpmCli, 'fixture pnpm cli');
    fs.writeFileSync(wrapper, 'fixture wrapper');
    const build = sourceBuildEnvironment({ temporaryRoot: root, pnpmCli, wrapperPath: wrapper });
    assert.equal(build.env.CI, 'true');
    assert.equal(build.env.npm_config_confirm_modules_purge, 'false');
    assert.equal(build.env.npm_config_offline, 'true');
    assert.equal(build.env.HOME, path.join(root, 'home'));
    assert.equal(build.pnpmStore, path.join(root, 'pnpm-store'));
    assert.equal(build.env.npm_config_store_dir, build.pnpmStore);
    assert.equal(fs.lstatSync(build.pnpmStore).isDirectory(), true);
    assert.match(build.env.PATH, new RegExp(`^${path.join(root, 'bin')}:`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deploy policy overlay permits only the verified checkout absolute file locator and restores the reviewed policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-deploy-policy-overlay-'));
  try {
    const workspace = path.join(root, 'pnpm-workspace.yaml');
    const original = [
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local@file:packages/subprocess/subprocess-local': true",
      '  unrelated: false',
      '',
    ].join('\n');
    fs.writeFileSync(workspace, original);
    const restore = applyDeployBuildPolicyOverlay({ sourceRoot: root });
    const overlaid = fs.readFileSync(workspace, 'utf8');
    const expectedLocator = `@deepseek-ai/dsh-subprocess-local@${pathToFileURL(path.join(fs.realpathSync(root), 'packages/subprocess/subprocess-local')).href}`;
    assert.equal(overlaid.includes(expectedLocator), true);
    assert.equal(overlaid.includes("  '@deepseek-ai/dsh-subprocess-local': true"), false);
    restore();
    assert.equal(fs.readFileSync(workspace, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bad pinned input fails before the source checkout can be adapted or an output directory is created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-preflight-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const marker = path.join(sourceRoot, 'must-not-change');
    const pnpmTarball = path.join(root, 'pnpm-11.7.0.tgz');
    const nodeArchive = path.join(root, 'node-v24.20.0-darwin-arm64.tar.gz');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(sourceRoot, { mode: 0o700 });
    fs.writeFileSync(marker, 'original checkout state');
    fs.writeFileSync(pnpmTarball, 'wrong pnpm input');
    fs.writeFileSync(nodeArchive, 'not reached because pnpm is invalid');

    assert.throws(() => buildMacosSupervisedDshRuntime({
      releasePath: path.join(repoRoot, 'tools/dsh/macos-supervised-source-release.json'),
      repoRoot,
      sourceRoot,
      nodeArchive,
      pnpmTarball,
      outputDir,
      host: { platform: 'darwin', arch: 'arm64', versions: { node: '24.20.0' } },
    }), /pnpm tarball integrity/);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'original checkout state');
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SEA cache staging copies only the verified local base and marks the private cache complete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-sea-cache-'));
  try {
    const archive = path.join(root, 'node-v24.20.0-darwin-arm64.tar.gz');
    const home = path.join(root, 'home');
    fs.writeFileSync(archive, 'fixture node archive');
    fs.mkdirSync(home, { mode: 0o700 });
    const staged = stageVerifiedSeaBase({ archive, cacheHome: home });
    assert.equal(fs.readFileSync(staged, 'utf8'), 'fixture node archive');
    assert.equal(fs.existsSync(`${staged}.ok`), true);
    assert.equal(path.dirname(staged), path.join(fs.realpathSync(home), '.pkg-cache', 'sea'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PATH shim delegates every upstream pnpm lookup to the pinned wrapper', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-pnpm-shim-'));
  try {
    const shimDirectory = path.join(root, 'bin');
    const wrapper = path.join(root, 'wrapper.mjs');
    fs.mkdirSync(shimDirectory, { mode: 0o700 });
    fs.writeFileSync(wrapper, 'process.stdout.write(process.argv.slice(2).join(","));\n', { mode: 0o700 });
    const shim = writePnpmShim({ directory: shimDirectory, wrapperPath: wrapper });
    const result = spawnSync(shim, ['dlx', '@yao-pkg/pkg@6.21.0'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'dlx,@yao-pkg/pkg@6.21.0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node shim keeps child shebangs on the host-verified Node executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-node-shim-'));
  try {
    const shimDirectory = path.join(root, 'bin');
    fs.mkdirSync(shimDirectory, { mode: 0o700 });
    const shim = writeNodeShim({ directory: shimDirectory });
    const result = spawnSync(shim, ['-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, process.execPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('npm shim permits only script nesting through the pinned pnpm wrapper', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-npm-shim-'));
  try {
    const shimDirectory = path.join(root, 'bin');
    const wrapper = path.join(root, 'wrapper.mjs');
    fs.mkdirSync(shimDirectory, { mode: 0o700 });
    fs.writeFileSync(wrapper, 'process.stdout.write(process.argv.slice(2).join(","));\n', { mode: 0o700 });
    const shim = writeNpmRunShim({ directory: shimDirectory, wrapperPath: wrapper });
    const run = spawnSync(shim, ['run', 'build:lib'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, 'run,build:lib');
    const rejected = spawnSync(shim, ['install'], { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /only npm run compatibility calls/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
