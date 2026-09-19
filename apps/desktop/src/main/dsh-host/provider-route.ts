/**
 * Main-owned DSH provider-route admission and immutable ACP profile assembly.
 *
 * App Sandbox's network-client entitlement is intentionally coarse: it lets a
 * signed Helper initiate TCP connections, including to localhost. This module
 * therefore never accepts a Renderer URL, a user Home profile, or an ambient
 * environment override. A route must be admitted in this Main process, then
 * its non-secret endpoint and API key travel in the two exact environment
 * variables consumed by a fixed Cindy-managed ACP profile.
 *
 * This is an application policy boundary, not a claim that App Sandbox itself
 * filters destinations. Only the owning Main registrar may consume an
 * approved external-origin capability after it has revalidated the current
 * account's persisted DSH configuration.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DshHomeMode } from './scope.js';

export const DSH_PROVIDER_BASE_URL_ENV = 'CINDY_DSH_PROVIDER_BASE_URL' as const;
export const DSH_PROVIDER_API_KEY_ENV = 'CINDY_DSH_PROVIDER_API_KEY' as const;

export type DshProviderRouteKind = 'approved-external-https' | 'loopback-e2e';

export interface DshProviderRoute {
  readonly kind: DshProviderRouteKind;
  /** Canonical absolute URL with no credential, query, fragment or ambiguity. */
  readonly baseUrl: string;
  /** Origin-only correlation label; it is not a credential and never crosses IPC. */
  readonly origin: string;
}

export interface CreateApprovedExternalDshProviderRouteOptions {
  readonly baseUrl: string;
  /**
   * Main-owned exact origins. Production composition obtains this list only
   * from the current account's revalidated persisted DSH configuration; it
   * must never derive it from Renderer data, a DSH profile, or ambient input.
   */
  readonly approvedOrigins: readonly string[];
}

const admittedRoutes = new WeakSet<object>();

function unsafeUrl(message: string): never {
  throw new Error(`DSH provider route ${message}`);
}

function parseEndpoint(value: string): URL {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.trim() !== value
  ) {
    unsafeUrl('URL is invalid');
  }
  // URL() normalizes dot segments before exposing pathname. Reject them in
  // the supplied spelling too, so Main policy does not accidentally admit a
  // route whose reviewed text and effective path differ.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(value)) unsafeUrl('path is invalid');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    unsafeUrl('URL is invalid');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    unsafeUrl('must not contain credentials, query, or fragment');
  }
  if (
    !parsed.pathname.startsWith('/') ||
    parsed.pathname.split('/').some((segment) => segment === '..')
  ) {
    unsafeUrl('path is invalid');
  }
  return parsed;
}

function canonicalExternalOrigin(value: string): string {
  const parsed = parseEndpoint(value);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/') {
    unsafeUrl('approved external origin is invalid');
  }
  return parsed.origin;
}

/**
 * The selected DeepSeek adapter appends its fixed operation path. Preserve an
 * approved path prefix, but strip a terminal slash so its Messages root cannot
 * turn an origin-only Main route into a different `//v1/messages` input than
 * the source-runtime control path.
 */
function canonicalAdapterBaseUrl(parsed: URL): string {
  return parsed.toString().replace(/\/+$/, '');
}

function admit(kind: DshProviderRouteKind, parsed: URL): DshProviderRoute {
  const route = Object.freeze({
    kind,
    baseUrl: canonicalAdapterBaseUrl(parsed),
    origin: parsed.origin,
  });
  admittedRoutes.add(route);
  return route;
}

/**
 * Admit a production route only when its exact HTTPS origin is already owned
 * by Main policy. There is intentionally no default public origin.
 */
export function createApprovedExternalDshProviderRoute(
  options: CreateApprovedExternalDshProviderRouteOptions,
): DshProviderRoute {
  const parsed = parseEndpoint(options.baseUrl);
  if (parsed.protocol !== 'https:') unsafeUrl('must use HTTPS');
  const approvedOrigins = new Set(options.approvedOrigins.map(canonicalExternalOrigin));
  if (approvedOrigins.size === 0 || !approvedOrigins.has(parsed.origin)) {
    unsafeUrl('origin is not approved by Main policy');
  }
  return admit('approved-external-https', parsed);
}

/**
 * Test-only admission. Literal IPv4 loopback avoids a DNS or hostname alias
 * becoming an accidental external route. It is never a product fallback.
 */
export function createLoopbackE2eDshProviderRoute(baseUrl: string): DshProviderRoute {
  const parsed = parseEndpoint(baseUrl);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    unsafeUrl('loopback E2E route must be http://127.0.0.1:<port>');
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    unsafeUrl('loopback E2E port is invalid');
  }
  return admit('loopback-e2e', parsed);
}

/** Reject object literals, structured-cloned routes and cross-process input. */
export function assertAdmittedDshProviderRoute(route: DshProviderRoute): void {
  if (!admittedRoutes.has(route)) unsafeUrl('was not admitted by this Main process');
}

function assertRealDirectory(candidate: string, label: string): string {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a real directory`);
  return fs.realpathSync(candidate);
}

function writeAtomicManagedFile(directory: string, name: string, contents: string): void {
  const target = path.join(directory, name);
  if (path.dirname(target) !== directory)
    throw new Error('DSH managed ACP patch filename is invalid');
  try {
    const existing = fs.lstatSync(target);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('DSH managed ACP patch file is not a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = path.join(directory, `.cindy-dsh-profile-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
    const written = fs.lstatSync(target);
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      fs.readFileSync(target, 'utf8') !== contents
    ) {
      throw new Error('DSH managed ACP patch write could not be verified');
    }
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The target replacement is already verified above; a failed best-effort
      // cleanup only matters when the original write itself has failed.
    }
  }
}

const PROFILE_PATCH = [
  '- id: llm-deepseek',
  "  name: '@deepseek-ai/dsh-llm-deepseek'",
  '  config:',
  '    protocol: messages',
  `    apiKeyEnv: ${DSH_PROVIDER_API_KEY_ENV}`,
  `    baseURL: !!js process.env.${DSH_PROVIDER_BASE_URL_ENV}`,
  // DeepSeek V4 exposes both non-thinking and thinking modes. Keep thinking
  // enabled at the provider boundary so the runtime can advertise Off/Low/
  // High/Max instead of being restricted to Off-only.
  '    thinking: enabled',
  '',
].join('\n');

/**
 * Materialize the sole Cindy-owned ACP policy layer before a supervised spawn.
 * The public `acp` profile owns and may recreate its own template, so policy
 * must live in the documented Home-level patch applied after that template.
 * The patch contains no endpoint or key: Main injects both into the child
 * environment for this one launch. This helper itself refuses every Home mode
 * except cindy-managed.
 */
export function materializeDshManagedAcpProviderPatch(
  // Keep the mode broad at this defensive filesystem boundary. Production
  // managed launch paths remain the only normal caller with `dshHome`, but a
  // structurally valid existing-Home-shaped input must be rejected here too,
  // before the path is inspected or a profile file is touched.
  paths: Readonly<{ dshHome: string; homeMode: DshHomeMode }>,
  route: DshProviderRoute,
): void {
  assertAdmittedDshProviderRoute(route);
  if (paths.homeMode !== 'cindy-managed') {
    throw new Error('DSH provider profile may be materialized only in a cindy-managed Home');
  }
  const home = assertRealDirectory(paths.dshHome, 'DSH managed Home');
  writeAtomicManagedFile(home, 'cordis.patch.yml', PROFILE_PATCH);
}
