# DSH F1 Local Identity-Closure Report

Result: **LOCAL-PASS (Desktop identity closure only)** — DSH is now a retained fourth agent identity in the
local Desktop codebase, but remains unavailable for creation, execution, model routing, scheduler, Orca worker
creation, remote execution and Mobile. This is neither a managed-runtime registration nor a release claim.

Date: 2026-09-03
Historical issue (do not update): [#3772 — DSH: close the fourth-Agent identity across all boundaries](https://github.com/makecindy/cindy/issues/3772)
Prerequisite: [F0 local validation report](dsh-f0-local-validation-report.md)

## Delivered boundary

- `packages/maker-core` accepts `dsh` as an `AgentKind`, but `agents/index.ts` does not register a DSH adapter;
  an attempted Maker session fails instead of selecting Claude Code.
- `apps/desktop/src/shared/agentKindConversion.ts` round-trips `dsh`; only absent legacy values default to `cc`.
  A present unknown value throws `AgentKindConversionError`.
- Desktop session storage, local-DB decoders, history/search/display projections, context/fork history and IPC retain
  `dsh` identity. Skill analytics retains the known identity but has no DSH transcript parser or exposure semantics.
  This phase changes no SQLite schema or migration: `agent_kind` remains a text field.
- A DSH creation request is rejected before workspace/bootstrap work. Model catalogs, New Maker, model pricing,
  scheduler routes, slash-command loading, send-to-session and Orca worker creation have explicit unavailable or
  non-route behavior. No fallback model, worker engine or scheduled run is synthesized.
- The renderer uses a neutral `D` harness glyph and does not add DSH to selectable model-provider or New Maker
  controls. The proposed glossary term is `deepseek-harness`.

## Local verification

- `pnpm --filter desktop run typecheck` — passed.
- `pnpm --filter @cindy/maker-core exec vitest run src/maker.test.ts` — 90 passed.
- Desktop identity/Main tests — 124 passed: conversion, DB decoder, session creation and Orca worker rejection.
- Desktop retained-history tests — 49 passed: DSH fork rejects explicitly without a legacy agent fork, and skill
  analytics preserves dsh while dropping an unknown stored kind.
- Desktop renderer identity tests — 36 passed: capabilities, availability roster and glyph mapping.
- Desktop state/Main regression tests — 155 passed: New Maker sanitization, title persistence and status/usage
  handlers.
- `pnpm --filter @cindy/model-providers exec vitest run src/__tests__/catalog.test.ts` — 58 passed, including
  rejection of a DSH catalog route.
- `pnpm test:unit:related` — passed through the repository's local test gate. The changed source-build tooling made
  the runner choose its full related-unit plan; this stayed local and did not run a remote build or test another
  platform.

The expected test diagnostics for missing optional Pi/DSH capability adapters are warnings; no test failed.

## Explicitly not delivered

- No `DshAgent`, managed runtime installer, DSH Home, durable binding, launch supervisor or product session.
- No DSH model/provider route, prompt, tool, permission, extension, activity, terminal or UI capability.
- No SSH, device-link, Mobile, Orca interoperability, remote/CI build, artifact, release or upstream write.

## Audit conclusion

The source changes and tests show one-way identity preservation and fail-closed execution boundaries. A later F2
may register a runtime only after its local macOS supervisor and security gates are implemented and independently
validated; it must not widen this report into cross-platform or distribution evidence.
