import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertAdmittedDshProviderRoute,
  createApprovedExternalDshProviderRoute,
  createLoopbackE2eDshProviderRoute,
  materializeDshManagedAcpProviderPatch,
} from '../provider-route.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const result = mkdtempSync(join(tmpdir(), 'cindy-dsh-provider-route-'));
  temporaryRoots.push(result);
  return result;
}

describe('Main-owned DSH provider route', () => {
  it('admits only an exact Main-approved HTTPS origin and no default external endpoint', () => {
    const route = createApprovedExternalDshProviderRoute({
      baseUrl: 'https://api.example.test/v1',
      approvedOrigins: ['https://api.example.test'],
    });
    expect(route).toMatchObject({
      kind: 'approved-external-https',
      baseUrl: 'https://api.example.test/v1',
      origin: 'https://api.example.test',
    });
    expect(() => createApprovedExternalDshProviderRoute({
      baseUrl: 'https://other.example.test/v1',
      approvedOrigins: ['https://api.example.test'],
    })).toThrow('not approved by Main policy');
    expect(() => createApprovedExternalDshProviderRoute({
      baseUrl: 'http://api.example.test/v1',
      approvedOrigins: ['https://api.example.test'],
    })).toThrow('must use HTTPS');
    expect(() => createApprovedExternalDshProviderRoute({
      baseUrl: 'https://api.example.test/v1?key=forbidden',
      approvedOrigins: ['https://api.example.test'],
    })).toThrow('must not contain credentials, query, or fragment');
    expect(() => createApprovedExternalDshProviderRoute({
      baseUrl: 'https://api.example.test/reviewed/../effective',
      approvedOrigins: ['https://api.example.test'],
    })).toThrow('path is invalid');
    expect(() => createApprovedExternalDshProviderRoute({
      baseUrl: 'https://api.example.test/v1',
      approvedOrigins: [],
    })).toThrow('not approved by Main policy');
  });

  it('admits the E2E provider only as literal IPv4 loopback with an explicit port', () => {
    expect(createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123/v1/')).toMatchObject({
      kind: 'loopback-e2e',
      baseUrl: 'http://127.0.0.1:43123/v1',
      origin: 'http://127.0.0.1:43123',
    });
    expect(createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123/')).toMatchObject({
      baseUrl: 'http://127.0.0.1:43123',
    });
    for (const candidate of [
      'http://localhost:43123',
      'https://127.0.0.1:43123',
      'http://127.0.0.1',
      'http://127.0.0.2:43123',
      'http://example.test:43123',
    ]) {
      expect(() => createLoopbackE2eDshProviderRoute(candidate)).toThrow('loopback E2E');
    }
  });

  it('rejects a structured-cloned or object-literal route at the Main boundary', () => {
    expect(() => assertAdmittedDshProviderRoute({
      kind: 'approved-external-https',
      baseUrl: 'https://api.example.test/',
      origin: 'https://api.example.test',
    })).toThrow('was not admitted by this Main process');
  });

  it('writes a fixed secret-free ACP Home patch without persisting its endpoint or credential', () => {
    const base = root();
    const dshHome = join(base, 'dsh-home');
    mkdirSync(dshHome, { mode: 0o700 });
    const route = createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123/v1');

    materializeDshManagedAcpProviderPatch({ dshHome, homeMode: 'cindy-managed' }, route);

    const patch = readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain('- id: acp\n  config:\n    provider: deepseek-official\n    model: deepseek-flash');
    expect(patch).toContain('protocol: messages');
    expect(patch).toContain('CINDY_DSH_PROVIDER_API_KEY');
    expect(patch).toContain('CINDY_DSH_PROVIDER_BASE_URL');
    expect(patch).toContain('thinking: enabled');
    expect(patch).not.toContain('thinking: disabled');
    expect(patch).not.toContain(route.baseUrl);
    expect(patch).not.toContain('fixture-secret');
    // The Home-level patch is repaired rather than merged with stale route
    // configuration from an earlier failed launch.
    writeFileSync(join(dshHome, 'cordis.patch.yml'), 'untrusted profile content');
    materializeDshManagedAcpProviderPatch({ dshHome, homeMode: 'cindy-managed' }, route);
    expect(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf8')).toBe(patch);
  });

  it('refuses a symlinked managed ACP Home patch', () => {
    const base = root();
    const dshHome = join(base, 'dsh-home');
    const outside = join(base, 'outside');
    mkdirSync(dshHome, { recursive: true, mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(outside, 'cordis.patch.yml'), 'outside');
    symlinkSync(join(outside, 'cordis.patch.yml'), join(dshHome, 'cordis.patch.yml'));

    expect(() => materializeDshManagedAcpProviderPatch(
      { dshHome, homeMode: 'cindy-managed' },
      createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
    )).toThrow('DSH managed ACP patch file is not a regular file');
  });

  it('refuses to touch an existing user DSH Home even with an admitted route', () => {
    const dshHome = root();
    const userOwnedPatch = 'user-owned ACP profile\n';
    writeFileSync(join(dshHome, 'cordis.patch.yml'), userOwnedPatch, { mode: 0o600 });

    expect(() => materializeDshManagedAcpProviderPatch(
      { dshHome, homeMode: 'existing-dsh-home' },
      createLoopbackE2eDshProviderRoute('http://127.0.0.1:43123'),
    )).toThrow('only in a cindy-managed Home');

    // The mode check must run before any inspection, repair, or replacement
    // of a user-owned DSH profile.
    expect(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf8')).toBe(userOwnedPatch);
  });
});
