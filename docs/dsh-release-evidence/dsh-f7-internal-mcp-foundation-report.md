# DSH F7 internal MCP lease foundation report

Result: **LOCAL-PARTIAL — a fixed Main-owned internal MCP lease can be mounted before native session creation or
resume, authenticated only by a memory-only bearer token, and released through the local signed `darwin-arm64`
Helper path. No production endpoint, user-native MCP configuration, remote/Mobile route or product MCP capability is
enabled. A separate, narrow existing-Home launch handoff is now wired in the production Main bridge, but its real
user-selected signed-package acceptance remains outstanding.**

Date: 2026-09-05

## Delivered boundary

- [`internal-mcp-lease.ts`](../../apps/desktop/src/main/dsh-host/internal-mcp-lease.ts) has no Electron, IPC,
  persistence or configuration dependency. It accepts only static Main-owned endpoint definitions, so a Renderer,
  provider record, profile, native Home or user configuration cannot choose an MCP URL, header, command, token or
  account identity.
- A loopback HTTP endpoint must use exactly `127.0.0.1` or `[::1]`, an explicit port and a non-root route prefix.
  A non-loopback endpoint must match its static HTTPS origin and its non-root route prefix exactly. `localhost`,
  missing ports, root prefixes, query/fragment/userinfo, path escape and HTTPS origin drift are rejected.
- Acquiring a lease reserves the exact `(cindySessionId, sessionInstanceId)` pair and passes the owning scope only to
  Main's endpoint registration callback. It creates a fresh 32-byte bearer token per registered endpoint and puts
  it only in the ACP `authorization: Bearer ...` declaration. The token is not persisted, logged, projected,
  returned by an IPC API or printed by a fixture assertion.
- Registration happens before `DshControlPlane` sends native `session/new` or `session/resume`. Failed registration
  rolls back already-created endpoints in reverse order. Failed create/resume, normal session close and carrier
  shutdown release or revoke leases; repeated/stale release cannot close a later lease with the same identity.
- [`dsh-control-plane.ts`](../../apps/desktop/src/main/maker-host/dsh-control-plane.ts) uses this capability only
  when a Main owner explicitly injects a factory. The production bridge currently supplies no endpoint factory,
  so ordinary local DSH create requests retain the pre-F7 empty MCP declaration and legacy resume requests omit an
  MCP field altogether.
- The later existing-Home launch branch remains separate from this MCP foundation: Main converts the protected
  persistent bookmark to a fresh implicit bookmark, passes it only once over fd 3 to the fixed Helper, and leaves
  both the child environment and generic scope type without `DSH_HOME` or a raw Home path. A changed or reset
  selection rejects subsequent DSH operations; the selection is restart-effective and does not tear down unrelated
  live Maker tasks.

## Local verification

- `pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/internal-mcp-lease.test.ts
  src/main/maker-host/__tests__/dshControlPlane.test.ts src/main/dsh-host/__tests__/existing-home-settings.test.ts
  src/main/maker-ipc/__tests__/dshExistingHomeIpc.test.ts` — PASS, 71 tests. The lease-specific tests cover exact
  endpoint validation, token isolation, reservation, reverse rollback and factory revocation. The control-plane
  tests cover session-instance admission, create/resume declaration wiring and carrier-close revocation.
- `pnpm --filter @cindy/maker-core exec vitest run src/agents/dsh/index.test.ts
  src/agents/dsh/acp-client.test.ts` — PASS, 22 tests. The legacy resume request retains its old wire shape when
  Main has no lease, while a Main lease is attached only to that exact resume request.
- `pnpm --filter desktop run typecheck` — PASS.
- `pnpm --filter desktop package:dsh:local-macos --archive <local-build.9.tar.gz> --manifest
  <local-build.9.json> --region global` — PASS. The local package rebuilt Cindy's `darwin-arm64` App, verified its
  signed Helper structure, and ran 7/7 signed-Helper E2Es. The F7 case starts a fixed Main-injected loopback
  Streamable HTTP MCP server, requires its unknown bearer token, observes the real DSH runtime's authenticated
  `initialize` and `tools/list`, then closes the binding and proves no endpoint remains. It resumes that same
  Cindy binding with a fresh session-instance lease, observes a second authenticated `initialize` and `tools/list`,
  then closes again and confirms the second registration is gone with no active endpoint left.

## Deliberately not proved or enabled

- No default, remote, configurable or user-owned MCP endpoint exists. The signed-package fixture is test-only and
  has no renderer, preload, settings, database or device-link surface.
- `revokeAll()` is called on carrier shutdown; a future account-switch, Home-reset or endpoint-configuration owner
  must call it before its own cleanup and add the corresponding race tests. Abort-specific teardown, concurrent
  multi-scope ownership and production endpoint lifecycle are likewise not yet a completed F7 result.
- Existing-Home code coverage is not a user permission claim. The selection/bookmark foundation and its private
  Main-to-Helper handoff still require real user-selected-directory signed-package acceptance, including resolve,
  start, stop, reset and restart behavior, before F7 can claim Home execution.
- Native profile, skill, plugin and extension discovery or mutation is unavailable. No generic command, fabricated
  native API, secret-bearing profile or silent permanent disable was added.
- This was a local macOS `darwin-arm64` build and test only. No remote runner, GitHub Action, upload, release,
  Linux, Windows, Intel macOS, SSH, Mobile or upstream operation was run or claimed.

## Audit conclusion

This foundation makes the exact Main-to-native MCP mount lifecycle testable without broadening any product surface.
Together with the narrow existing-Home handoff, it still does not satisfy F7's user-native configuration,
user-selected Home acceptance or extension-recovery acceptance. DSH MCP therefore remains
`CapabilityStatus { supported: false, reason: 'not-implemented' }` until a later scoped owner and its security,
product and end-to-end acceptance gates are complete.
