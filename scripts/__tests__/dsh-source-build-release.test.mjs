import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyReleaseAdaptations,
  createDeterministicTarGz,
  extractVerifiedRuntimeBundle,
  inspectRuntimeArchive,
  packageSourceRuntime,
  readSourceRelease,
  runtimeTreeManifest,
  validateSourceRelease,
  verifyPinnedPnpmTarball,
  verifyReleaseBundle,
  verifyAppliedReleaseAdaptations,
  verifySeaBaseArchive,
  verifyPinnedBuildToolchain,
  verifySourceInput,
} from '../dsh-source-build-release.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const releasePath = path.join(repoRoot, 'tools/dsh/source-release.json');
const supervisedReleasePath = path.join(repoRoot, 'tools/dsh/macos-supervised-source-release.json');
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dsh-source-release-'));
  temporaryRoots.push(root);
  return root;
}

function fixtureRelease() {
  const release = structuredClone(readSourceRelease(releasePath));
  release.runtime.directory = 'runtime';
  return release;
}

function writeRuntime(root, release, targetKey = 'darwin-arm64') {
  const runtime = path.join(root, release.runtime.directory);
  fs.mkdirSync(runtime, { recursive: true });
  const target = release.targets[targetKey];
  const nativeAddonSources = (target.nativeAddons ?? []).map((addon) => addon.sourcePath);
  for (const [index, filename] of [target.executable, ...target.sidecars, ...nativeAddonSources].entries()) {
    const file = path.join(runtime, filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `fixture-${index}\n`);
    fs.chmodSync(file, 0o755);
  }
  return runtime;
}

test.after(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('checked-in source release schema is valid and declares the user-approved immutable source tuple', () => {
  const release = readSourceRelease(releasePath);
  assert.equal(release.source.tagKind, 'lightweight');
  assert.equal(release.source.tagSignature, 'not-applicable');
  assert.equal(release.builder.install.join(' '), 'pnpm install --frozen-lockfile');
  assert.match(release.builder.pnpmIntegrity, /^sha512-/);
  assert.equal(release.targets['darwin-arm64'].buildTarget, 'node24.20.0-macos-arm64');
  assert.equal(release.targets['darwin-arm64'].seaBase.archive, 'node-v24.20.0-darwin-arm64.tar.gz');
  assert.equal(release.source.adaptations.length, 1);
  assert.equal(release.source.adaptations[0].files[0].afterSha256, '8053640bda901c12bb9003f5943100721604c0f01f39efa97b9b79272109e957');
  assert.deepEqual(Object.keys(release.targets).sort(), ['darwin-arm64']);
});

test('macOS supervised source release seals bootstrap and pkg native-cache inputs', () => {
  const release = readSourceRelease(supervisedReleasePath);
  const adaptationPatch = fs.readFileSync(
    path.join(repoRoot, release.source.adaptations[0].patch.path),
    'utf8',
  );
  assert.equal(release.releaseId, 'cindy-dsh-0.1.6-alpha.2-build.1-macos-supervised');
  assert.equal(release.source.adaptations.length, 1);
  assert.deepEqual(
    release.source.adaptations[0].files.map((file) => [file.path, file.afterSha256]),
    [
      ['scripts/build-exe-for-python-sdk.ts', 'd720fc949c98621dcac2cbcd37f62f1aa5e1614c7a752967b1ae6d3529e3c9e5'],
      ['packages/subprocess/subprocess/src/index.ts', '441c14ca9a3c6462bf36385b49162d16d1623ad580397339be93348bd7ec195f'],
      ['packages/subprocess/subprocess-local/tests/spawn.spec.ts', '05b7cf6f6f188e9c7c85e84477415543b9c024c2b7ee654bd112604e83124db9'],
    ],
  );
  assert.equal(
    release.source.adaptations.some((adaptation) =>
      adaptation.files.some((file) => file.path === 'packages/bundle/acp-app/cordis.patch.yml'),
    ),
    false,
  );
  assert.deepEqual(release.targets['darwin-arm64'].nativeAddons, [
    {
      sourcePath: 'node/node_modules/node-addon-require-builtin-darwin-arm64/prebuilt/darwin-arm64-napi-v9.node',
      cachePath: 'node-addon-require-builtin-darwin-arm64/0.1.6/darwin-arm64/darwin-arm64-napi-v9.node',
    },
  ]);
  assert.deepEqual(release.targets['darwin-arm64'].pkgNativeCache, {
    sourceDirectory: 'pkg-native-cache',
    cacheDirectory: 'pkg',
  });
  assert.match(
    adaptationPatch,
    /node-addon-system-darwin-arm64\\\/bin\\\/system\\\.node/,
    'the alpha.2 persistence add-on must be present in the signed sealed cache',
  );
});

test('checked-in pkg build-tool closure is digest-bound and declares the pinned package integrity', () => {
  const release = readSourceRelease(releasePath);
  const verified = verifyPinnedBuildToolchain({ release, repoRoot });
  assert.equal(verified.packageName, '@yao-pkg/pkg');
  assert.equal(verified.version, '6.21.0');
  assert.match(
    fs.readFileSync(path.join(repoRoot, release.builder.toolchain.workspace.path), 'utf8'),
    /^\s*esbuild:\s*true\s*$/m,
  );
  assert.equal(verified.wrapper, path.join(repoRoot, 'tools/dsh/pnpm-dsh-build-wrapper.mjs'));
});

test('source input verification is fully local and rejects a checkout without its pinned tag', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const sourceRoot = path.join(root, 'source');
  fs.mkdirSync(path.join(sourceRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'pnpm-lock.yaml'), 'lockfile fixture\n');
  fs.writeFileSync(path.join(sourceRoot, 'scripts', 'build-exe-for-python-sdk.ts'), 'build fixture\n');
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{"name":"fixture"}\n');
  execFileSync('git', ['init', '--quiet'], { cwd: sourceRoot });
  execFileSync('git', ['config', 'user.email', 'dsh-test@example.invalid'], { cwd: sourceRoot });
  execFileSync('git', ['config', 'user.name', 'DSH local test'], { cwd: sourceRoot });
  execFileSync('git', ['add', '.'], { cwd: sourceRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: sourceRoot });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  release.source.tag = 'local-only-fixture';
  release.source.commit = commit;
  release.source.tree = tree;
  release.source.lockfile.sha256 = createHash('sha256').update('lockfile fixture\n').digest('hex');
  release.source.buildScript.sha256 = createHash('sha256').update('build fixture\n').digest('hex');
  release.source.packageManifest.sha256 = createHash('sha256').update('{"name":"fixture"}\n').digest('hex');

  // There is deliberately no `origin`. The old fetch-on-verify behavior would
  // fail here; the local tag is the whole source proof for this task.
  assert.throws(() => verifySourceInput({ release, sourceRoot }), /must already contain/);
  execFileSync('git', ['tag', release.source.tag], { cwd: sourceRoot });
  assert.deepEqual(verifySourceInput({ release, sourceRoot }), { head: commit, tagCommit: commit, tree });
});

test('pnpm bootstrap tarball must match the release-bound npm integrity before execution', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const tarball = path.join(root, 'pnpm.tgz');
  fs.writeFileSync(tarball, 'verified pnpm fixture');
  release.builder.pnpmIntegrity = `sha512-${createHash('sha512').update('verified pnpm fixture').digest('base64')}`;
  const verified = verifyPinnedPnpmTarball({ release, tarballPath: tarball });
  assert.equal(verified.tarball, tarball);
  fs.appendFileSync(tarball, ' mutation');
  assert.throws(() => verifyPinnedPnpmTarball({ release, tarballPath: tarball }), /integrity/);
});

test('SEA base archive must be a release-bound platform filename and digest', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const base = release.targets['darwin-arm64'].seaBase;
  const archive = path.join(root, base.archive);
  fs.writeFileSync(archive, 'verified SEA base fixture');
  base.sha256 = createHash('sha256').update('verified SEA base fixture').digest('hex');
  const verified = verifySeaBaseArchive({ release, targetKey: 'darwin-arm64', archivePath: archive });
  assert.equal(verified.archive, archive);
  fs.appendFileSync(archive, ' mutation');
  assert.throws(() => verifySeaBaseArchive({ release, targetKey: 'darwin-arm64', archivePath: archive }), /digest/);
});

test('reviewed source adaptation has one declared file and exact pre/postimage binding', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const sourceRoot = path.join(root, 'source');
  const targetPath = path.join(sourceRoot, 'scripts', 'build-exe-for-python-sdk.ts');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const before = `function isArch(value: string): value is Arch {\n}\n\n/**\n * A parsed pkg target triple, constructed from \`--targets\` or the host.\n */\nclass Target {\n  private constructor(\n    /** pkg Node range (\`node<major>\`). */\n    readonly nodeRange: string,\n    /** pkg platform tag. */\n    readonly platform: Platform,\n  ) {}\n\n  /** The pkg \`--targets\` spec string \`<nodeRange>-<platform>-<arch>\`. */\n  get spec(): string {\n    return \`\${this.nodeRange}-\${this.platform}-\${this.arch}\`\n  }\n\n  /**\n   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.\n   * @param spec - the raw triple, e.g. \`node24-linux-x64\`.\n   * @returns the parsed target.\n   */\n  static parse(spec: string): Target {\n    const parts = spec.split('-')\n    const [nodeRange, platform, arch] = parts\n    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {\n      throw new Error(\`build-exe-for-python-sdk: target \${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-linux-x64.\`)\n    }\n    if (!/^node\\d+$/.test(nodeRange)) {\n      throw new Error(\`build-exe-for-python-sdk: target \${JSON.stringify(spec)}: node range must look like node24, got \${JSON.stringify(nodeRange)}.\`)\n    }\n    if (!isPlatform(platform)) {\n      throw new Error('unrelated')\n    }\n  }\n}\n`;
  const after = before
    .replace('`node<major>`). */', '`node<major>` or exact `node<major>.<minor>.<patch>`). */')
    .replace('e.g. `node24-linux-x64`.', 'e.g. `node24-linux-x64` or `node24.20.0-linux-x64`.')
    .replace('if (!/^node\\d+$/.test(nodeRange)) {', 'if (!/^node\\d+(?:\\.\\d+\\.\\d+)?$/.test(nodeRange)) {')
    .replace('node range must look like node24, got', 'node range must look like node24 or node24.20.0, got');
  fs.writeFileSync(targetPath, before);
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  release.source.adaptations[0].files[0].beforeSha256 = sha256(before);
  release.source.adaptations[0].files[0].afterSha256 = sha256(after);
  assert.doesNotThrow(() => applyReleaseAdaptations({ release, repoRoot, sourceRoot }));
  assert.equal(fs.readFileSync(targetPath, 'utf8'), after);
  assert.doesNotThrow(() => verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot }));
  fs.appendFileSync(targetPath, 'unexpected mutation');
  assert.throws(() => verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot }), /postimage/);
  assert.throws(() => applyReleaseAdaptations({ release, repoRoot, sourceRoot }), /preimage/);
});

test('post-install adaptation verification uses the final reviewed postimage for a sequentially patched source file', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const sourceRoot = path.join(root, 'source');
  const targetPath = path.join(sourceRoot, 'scripts', 'build-exe-for-python-sdk.ts');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  const first = structuredClone(release.source.adaptations[0]);
  const second = structuredClone(release.source.adaptations[0]);
  first.files[0].afterSha256 = sha256('first reviewed postimage');
  second.files[0].afterSha256 = sha256('final reviewed postimage');
  release.source.adaptations = [first, second];
  fs.writeFileSync(targetPath, 'final reviewed postimage');
  assert.doesNotThrow(() => verifyAppliedReleaseAdaptations({ release, repoRoot, sourceRoot }));
});

test('a lightweight source tag cannot be represented as a signed tag', () => {
  const release = fixtureRelease();
  release.source.tagSignature = 'verified';
  const validation = validateSourceRelease(release);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /lightweight tag/i);
});

test('source release rejects every target outside the approved local macOS scope', () => {
  const release = fixtureRelease();
  release.targets['linux-x64'] = structuredClone(release.targets['darwin-arm64']);
  const validation = validateSourceRelease(release);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /approved local macOS development platform key/);
});

test('runtime manifest rejects unexpected direct artifacts', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  fs.writeFileSync(path.join(runtime, 'unreviewed-runtime-file'), 'nope');
  assert.throws(
    () => runtimeTreeManifest(runtime, [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars]),
    /unexpected or missing direct artifacts/,
  );
});

test('runtime manifest rejects missing sidecars and symlinks', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  const sidecar = path.join(runtime, release.targets['darwin-arm64'].sidecars[0]);
  fs.rmSync(sidecar);
  assert.throws(
    () => runtimeTreeManifest(runtime, [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars]),
    /ENOENT/,
  );
});

test('runtime manifest rejects a non-executable POSIX runtime artifact', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  fs.chmodSync(path.join(runtime, release.targets['darwin-arm64'].executable), 0o600);
  assert.throws(
    () => runtimeTreeManifest(runtime, [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars]),
    /not executable/,
  );
});

test('runtime manifest rejects a group/world writable runtime artifact', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  fs.chmodSync(path.join(runtime, release.targets['darwin-arm64'].executable), 0o777);
  assert.throws(
    () => runtimeTreeManifest(runtime, [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars]),
    /group\/world writable/,
  );
});

test('declared nested native add-ons are archive-bound and cannot traverse a symlinked runtime parent', () => {
  const release = fixtureRelease();
  const addon = 'node/node_modules/fixture-native/prebuilt/darwin-arm64-napi-v9.node';
  const cachePath = 'fixture-native/0.0.1/darwin-arm64/darwin-arm64-napi-v9.node';
  release.targets['darwin-arm64'].nativeAddons = [{ sourcePath: addon, cachePath }];
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  fs.chmodSync(path.join(runtime, addon), 0o644);
  const output = packageSourceRuntime({
    release,
    sourceRoot: root,
    targetKey: 'darwin-arm64',
    outputDir: path.join(root, 'out'),
  });
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  assert.deepEqual(manifest.runtime.requiredNativeAddons, [{ sourcePath: addon, cachePath }]);
  assert.deepEqual(inspectRuntimeArchive(output.archivePath).map((entry) => entry.path), [
    release.targets['darwin-arm64'].executable,
    ...release.targets['darwin-arm64'].sidecars,
    addon,
  ].sort());
  const extracted = path.join(root, 'extracted');
  assert.doesNotThrow(() => extractVerifiedRuntimeBundle({ manifest, archivePath: output.archivePath, outputDir: extracted }));
  assert.equal(fs.readFileSync(path.join(extracted, addon), 'utf8'), 'fixture-3\n');

  const safeDirectory = path.join(root, 'safe-directory');
  fs.mkdirSync(safeDirectory);
  fs.writeFileSync(path.join(safeDirectory, 'darwin-arm64-napi-v9.node'), 'fixture');
  const firstParent = path.join(runtime, 'node');
  fs.rmSync(firstParent, { recursive: true, force: true });
  fs.symlinkSync(safeDirectory, firstParent);
  assert.throws(
    () => runtimeTreeManifest(runtime, [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars, addon]),
    /symlink parent/,
  );
});

test('declared pkg native-cache trees are archive-bound as data and reject symlinks', () => {
  const release = fixtureRelease();
  release.targets['darwin-arm64'].pkgNativeCache = {
    sourceDirectory: 'pkg-native-cache',
    cacheDirectory: 'pkg',
  };
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  const cacheFile = path.join(runtime, 'pkg-native-cache', 'pkg', 'fixture-hash', '@scope', 'addon', 'native.node');
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, 'fixture sealed native cache');
  fs.chmodSync(cacheFile, 0o644);
  const output = packageSourceRuntime({
    release,
    sourceRoot: root,
    targetKey: 'darwin-arm64',
    outputDir: path.join(root, 'out'),
  });
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  assert.deepEqual(manifest.runtime.requiredPkgNativeCache, release.targets['darwin-arm64'].pkgNativeCache);
  assert.ok(inspectRuntimeArchive(output.archivePath).some((entry) => entry.path.endsWith('/native.node')));
  const extracted = path.join(root, 'extracted');
  extractVerifiedRuntimeBundle({ manifest, archivePath: output.archivePath, outputDir: extracted });
  assert.equal(fs.readFileSync(path.join(extracted, 'pkg-native-cache', 'pkg', 'fixture-hash', '@scope', 'addon', 'native.node'), 'utf8'), 'fixture sealed native cache');

  const linked = path.join(runtime, 'pkg-native-cache', 'pkg', 'linked.node');
  fs.symlinkSync(cacheFile, linked);
  assert.throws(
    () => packageSourceRuntime({ release, sourceRoot: root, targetKey: 'darwin-arm64', outputDir: path.join(root, 'out-link') }),
    /contains a symlink/,
  );
});

test('deterministic archive has stable bytes and only regular declared files', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  const runtime = writeRuntime(root, release);
  const files = [release.targets['darwin-arm64'].executable, ...release.targets['darwin-arm64'].sidecars];
  const first = createDeterministicTarGz(runtime, files);
  const second = createDeterministicTarGz(runtime, files);
  assert.deepEqual(first, second);
  const archive = path.join(root, 'runtime.tar.gz');
  fs.writeFileSync(archive, first);
  assert.deepEqual(inspectRuntimeArchive(archive).map((entry) => entry.path), [...files].sort());
});

test('package output binds source input, artifact digest and tree manifest', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  writeRuntime(root, release);
  const output = packageSourceRuntime({
    release,
    sourceRoot: root,
    targetKey: 'darwin-arm64',
    outputDir: path.join(root, 'out'),
  });
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  const checked = verifyReleaseBundle({ manifest, archivePath: output.archivePath });
  assert.equal(manifest.artifact.filename, path.basename(output.archivePath));
  assert.equal(checked.files.length, 1 + release.targets['darwin-arm64'].sidecars.length);
});

test('bundle verification rejects an archive whose bytes change after manifest creation', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  writeRuntime(root, release);
  const output = packageSourceRuntime({
    release,
    sourceRoot: root,
    targetKey: 'darwin-arm64',
    outputDir: path.join(root, 'out'),
  });
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  fs.appendFileSync(output.archivePath, 'tampered');
  assert.throws(() => verifyReleaseBundle({ manifest, archivePath: output.archivePath }), /SHA-256/);
});

test('verified bundle extraction runs only the archive files in a new private directory', () => {
  const release = fixtureRelease();
  const root = temporaryRoot();
  writeRuntime(root, release);
  const output = packageSourceRuntime({
    release,
    sourceRoot: root,
    targetKey: 'darwin-arm64',
    outputDir: path.join(root, 'out'),
  });
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  const extracted = path.join(root, 'extracted');
  const result = extractVerifiedRuntimeBundle({ manifest, archivePath: output.archivePath, outputDir: extracted });
  assert.equal(result.outputDir, extracted);
  assert.deepEqual(fs.readdirSync(extracted).sort(), [
    release.targets['darwin-arm64'].executable,
    ...release.targets['darwin-arm64'].sidecars,
  ].sort());
  assert.throws(
    () => extractVerifiedRuntimeBundle({ manifest, archivePath: output.archivePath, outputDir: extracted }),
    /must not already exist/,
  );
});
