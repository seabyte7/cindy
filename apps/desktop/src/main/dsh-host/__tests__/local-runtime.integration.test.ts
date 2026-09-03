import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DshAcpClient, createConsoleLogger } from '@cindy/maker-core';
import { afterEach, describe, expect, it } from 'vitest';

import { createDshAcpStdioTransport } from '../../maker-host/dsh-acp-stdio-transport.js';
import { DshControlPlane } from '../../maker-host/dsh-control-plane.js';
import {
  installDshLocalRuntime,
  readDshLocalRuntimePin,
} from '../local-runtime.js';

// A release-evidence caller supplies these two F0-produced local files. CI and
// ordinary unit runs intentionally skip this test rather than discovering a
// user installation, PATH binary, network artifact, or non-macOS runtime.
const archivePath = process.env.CINDY_DSH_F2_E2E_ARCHIVE;
const bundleManifestPath = process.env.CINDY_DSH_F2_E2E_MANIFEST;
const describeRuntime = archivePath && bundleManifestPath ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describeRuntime('DSH F2 locally installed runtime integration', () => {
  it('installs the exact F0 archive, then proves version and ACP create/close through Desktop Main', async () => {
    // Keep the real local-runtime proof out of the desktop test runner's
    // per-user temporary container. F2 intentionally validates a normal
    // macOS filesystem path and a fresh process-owned directory; `/private/tmp`
    // is also what the local source-build evidence uses.
    const root = mkdtempSync('/private/tmp/cindy-dsh-f2-install-e2e-');
    temporaryRoots.push(root);
    const launcher = join(root, 'launcher');
    const home = join(root, 'home');
    const dshHome = join(root, 'dsh-home');
    mkdirSync(launcher, { mode: 0o700 });
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(dshHome, { mode: 0o700 });
    const pin = readDshLocalRuntimePin(resolve(process.cwd(), '../../tools/dsh/latest.json'));
    const installed = installDshLocalRuntime({
      archivePath: archivePath!,
      bundleManifestPath: bundleManifestPath!,
      pin,
      installRoot: join(root, 'user-data', 'dsh-runtime'),
    });
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: home,
      // Match buildDshChildEnvironment: the runtime may use TMPDIR during
      // process startup, and only the per-launcher directory is writable.
      TMPDIR: launcher,
      DSH_HOME: dshHome,
    };
    const version = spawnSync(installed.binaryPath, ['--version'], {
      cwd: launcher,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (version.error || version.status !== 0) {
      // The integration environment holds no credentials. Preserve a bounded
      // startup diagnostic without treating child stderr as product telemetry.
      const diagnostic = version.stderr.trim().slice(0, 512).replaceAll(/[\r\n]+/g, ' ');
      throw new Error(`DSH F2 version probe failed (status=${version.status}, signal=${version.signal}, diagnostic=${diagnostic || 'none'})`);
    }
    expect(version.stdout.trim()).toBe(pin.runtime.expectedVersion);

    const client = new DshAcpClient({
      logger: createConsoleLogger('dsh-f2-local-runtime-e2e'),
      createTransport: () => createDshAcpStdioTransport({
        binaryPath: installed.binaryPath,
        launcherCwd: launcher,
        env,
        forceKillGraceMs: 1_000,
      }),
    });
    const bridge = new DshControlPlane({
      scopeId: 'f2-local-install-e2e',
      client,
      assertAuthorizedCwd: (cwd) => {
        if (cwd !== root) throw new Error(`unexpected F2 E2E workdir: ${cwd}`);
      },
    });
    try {
      await bridge.initialize();
      const created = await bridge.create({ cindySessionId: 'f2-installed-session', cwd: root });
      expect(created.operation).toBe('create');
      const binding = (await bridge.list({ scopeId: 'f2-local-install-e2e' }))[0]!;
      await expect(bridge.close(binding)).resolves.toMatchObject({ operation: 'close' });
    } finally {
      await client.close('DSH F2 local-install integration complete');
    }
  }, 30_000);
});
