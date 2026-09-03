# DSH F0 Local Validation Report

Result: **LOCAL-PASS (darwin-arm64 development scope)** — the local source build, extracted-runtime smoke and
Desktop Main E2E below meet the user-approved local macOS F0 gate. This is not a release, product registration,
remote-runner result or claim about another platform.

Date: 2026-09-03
Historical issue (do not update): [#3771 — DSH: prove the Cindy-owned bridge gate](https://github.com/makecindy/cindy/issues/3771)
Requirements: [`dsh-native-integration-requirements.md`](../issues/dsh-native-integration/dsh-native-integration-requirements.md)
Specification: [`dsh-native-integration-technical-spec.md`](../issues/dsh-native-integration/dsh-native-integration-technical-spec.md)
Plan: [`dsh-native-integration-development-plan.md`](../issues/dsh-native-integration/dsh-native-integration-development-plan.md)
Validation plan: [`dsh-native-integration-validation-plan.md`](../issues/dsh-native-integration/dsh-native-integration-validation-plan.md)

## Sources checked

- [`source-release.json`](../../tools/dsh/source-release.json): fixed alpha3 commit/tree, frozen pnpm/pkg
  closure, the exact local `darwin-arm64` SEA base archive, and the one-file exact-target adaptation.
- [`dsh-source-build-release.mjs`](../../scripts/dsh-source-build-release.mjs),
  [`dsh-native-host-gate.mjs`](../../scripts/dsh-native-host-gate.mjs), and
  [`dsh-source-runtime-smoke.mjs`](../../scripts/dsh-source-runtime-smoke.mjs).
- Desktop Main ACP transport/control-plane and the real-binary integration fixture.

## Commands run

- Fresh fixed-source checkout: source tag/commit/tree and input digest verification passed.
- Frozen upstream dependency install and Cindy frozen pkg closure install passed.
- Exact `node24.20.0-macos-arm64` source build passed after the release-bound parser adaptation; the official
  SEA base archive was SHA-256 verified both before and after build.
- Package, archive verification and fresh extraction passed.
- `node scripts/dsh-source-runtime-smoke.mjs ... darwin-arm64 ...`: passed version and ACP
  initialize/new/cancel/close/list/resume/close lifecycle.
- `CINDY_DSH_E2E_BINARY=... CINDY_DSH_E2E_PROMPT=1 pnpm --filter desktop exec vitest run
  src/main/maker-host/__tests__/dshControlPlane.integration.test.ts`: 3/3 passed, including a real
  `session/request_permission` round trip. The fixture's runtime `bash` call asks to widen from read-only to
  workspace-write; the F0 Main bridge returns `cancelled`, the runtime completes its turn, and the requested
  fixture file is absent.
- F0 source-build/support script tests: 27/27 passed; maker-core ACP test: 12/12 passed; Desktop DSH unit tests:
  23 passed, 1 skipped (the Windows-only path); maker-core and Desktop typechecks passed; developer-docs checks
  passed. No workflow YAML is present or checked in this local-only scope.
- `pnpm test:unit:related`: passed after the repository-wide local test gate was released. Because the
  workflow/package-toolchain changes are classified as wide, this ran the root runner (522 passed, 1 existing
  skip) and the complete applicable unit-workspace matrix, including Desktop (143.1s) and maker-core (201.2s).
- Current final DSH security diff audit: scan `9177d8b6-2ac3-4475-89fe-eede8dc72c79` reviewed all 21
  executable change surfaces, including the new permission round trip, and produced zero reportable findings.

## Findings

No scoped implementation defect was found in the local F0 delivery. Linux, Windows, Intel macOS, remote runners,
GitHub artifacts and provenance attestations are deliberately outside this user-approved scope and are not claimed.

## Scope and acceptance check

The local code and documentation match F0's Cindy-owned public-ACP evidence scope: no upstream Native Host API,
private runtime state, user credential, product registration, persistent F3 binding or F2 installer was used.
The local F0 acceptance condition is met only for the declared `darwin-arm64` development target. DSH remains
unregistered in the product until later local phase gates prove their own contracts.

## Routing and close readiness

Routing: proceed only with subsequent local macOS phases. Do not start remote, Mobile, release or non-macOS work
without a new user authorization. No upstream PR or issue update is required or authorized.
