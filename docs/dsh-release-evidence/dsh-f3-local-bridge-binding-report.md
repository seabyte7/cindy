# DSH F3 Local Bridge and Binding Report

Result: **LOCAL-PARTIAL — the local macOS supervised bridge now has a durable, Main-only ownership-binding foundation. It is not a product DSH integration or a completed recovery feature.**

Date: 2026-09-03, updated 2026-09-04
Requirements: [`dsh-native-integration-requirements.md`](../issues/dsh-native-integration/dsh-native-integration-requirements.md)
Specification: [`dsh-native-integration-technical-spec.md`](../issues/dsh-native-integration/dsh-native-integration-technical-spec.md)
Plan: [`dsh-native-integration-development-plan.md`](../issues/dsh-native-integration/dsh-native-integration-development-plan.md)

## Delivered locally

- Migration `0100_dsh-session-bindings` adds `dsh_session_bindings` without rewriting legacy session rows. A binding has exactly one Cindy session owner and a scope-local unique runtime session key. SQLite rejects deletion of its owning Cindy session while the binding exists.
- The Main-only [`dshSessionBindings.ts`](../../apps/desktop/src/main/localDb/dshSessionBindings.ts) store persists only the opaque runtime session id, Cindy owner id, scope id, fixed runtime/controller/capability identity, home mode, lifecycle state, revision and projection cursor. It rejects malformed or corrupt rows before a native reconciliation path can consume them. It does not accept tokens, endpoints, profile bodies, Home paths, prompts or raw ACP events.
- [`DshControlPlane`](../../apps/desktop/src/main/maker-host/dsh-control-plane.ts) records an acknowledged ACP create receipt before it exposes a live binding, uses compare-and-set lifecycle updates, fails closed when persistence cannot acknowledge an ACP result, and marks active persisted bindings `needs_reconcile` after carrier EOF/exit. Follow sequence is owner-local rather than bridge-global; a restored binding resumes its generated sequence from its durable cursor, so another session cannot manufacture a false gap.
- A new bridge can read only bindings for its own scope and requires a fresh public `session/list` response plus the exact runtime release, runtime version, ACP version, capability fingerprint and home mode. A listed persisted session becomes inactive/closed and requires an explicit later resume; a missing or mismatched record becomes `needs_reconcile`. Active sessions are not falsely declared missing merely because the alpha.3 runtime omits them from `session/list`.
- [`macos-supervised-bridge.ts`](../../apps/desktop/src/main/dsh-host/macos-supervised-bridge.ts) composes only the previously verified F2 fixed `Helper.app` topology. It obtains the closed capability fingerprint after ACP initialization, attaches durable binding before any session is created, and exposes neither bridge nor runtime identity over IPC.
- Its opt-in prompt fixture now uses the same fixed Main-owned loopback route/profile contract as production code;
  it no longer pre-writes a test profile or accepts arbitrary E2E credential variable names. Main canonicalizes the
  adapter base without a terminal slash, because the sealed DeepSeek adapter appends `/chat/completions`. The real
  build.4 signed-Helper run then passed the unchanged strict fixture, including committed text/usage projection,
  second-turn public cancel, durable receipt acknowledgement and leakage checks.

## Local verification

- `pnpm --filter desktop db:validate && pnpm --filter desktop db:check`: PASS — 101 migrations (`0000` through `0100`), journal/snapshot alignment and no historical schema drift.
- `pnpm --filter desktop exec vitest run src/main/localDb/__tests__/dshSessionBindings.test.ts src/main/maker-host/__tests__/dshControlPlane.test.ts src/main/localDb/__tests__/migrationReplay.test.ts src/main/dsh-host/__tests__/macos-supervised-runtime.test.ts`: PASS — 43 tests at the recorded run, including the rule that durable binding cannot be attached before the ACP handshake, per-owner follow sequence isolation, restored-cursor continuation and default-deny permission correlation.
- `CINDY_DSH_E2E_APP=<local signed Helper test app> CINDY_DSH_E2E_HOME=<local home> CINDY_DSH_E2E_RELEASE_ID=cindy-dsh-0.1.2-alpha.3-build.4-macos-supervised CINDY_DSH_E2E_PROMPT=1 pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/macos-supervised-runtime.integration.test.ts`: PASS — 3/3 against the fixed local Helper.app. The strict loopback prompt case proves two exact `/chat/completions` calls, committed text/usage projection, public cancel and durable receipts without runtime id or fixture-key leakage.
- 2026-09-04 route/profile regression: the focused Desktop suite passed 21 tests before the artifact inputs were
  supplied, the broader binding/control-plane/translator suite passed 85 tests with six unrelated opt-in cases
  skipped, and the later real signed-Helper prompt E2E passed 3/3. The bounded evidence refreshes only its local
  contained prompt path; it is not a release or product-availability claim.

The concrete app path and local home are intentionally omitted: they are machine-local test inputs, not distributable runtime configuration.

## Not proved and unavailable

- This is not cross-process runtime recovery proof. The bridge has a conservative reconciliation contract, but no real restart A→B resume round, completed prompt turn, history continuity, permission continuity, cleanup or production release acceptance has been demonstrated.
- `DshAgent` is not registered in maker-core or the Desktop catalog. There is no IPC, preload, renderer, user-facing capability state, i18n, Desktop package integration, SSH, device-link or Mobile path.
- The durable event/history projection slice is Main-only and its cursor is not a product history source. It does not
  prove packaged-Helper prompt/follow behavior, cross-process recovery or a renderer-visible event contract.
- Prompt receipts, permissions/interactions, usage, tools, model/effort, attachments, MCP, profiles and extensions are not durable or product-ready.
- No Linux, Windows, Intel macOS, remote runner, CI, GitHub operation, artifact upload, release, upstream write or remote build was run.

This report upgrades no `CapabilityStatus` and does not authorize product launch. It records the narrow F3 foundation so later phases cannot mistake an owner-scoped reconciliation key for a complete DSH session experience.
