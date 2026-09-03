# DSH F0 Local Validation Report

Result: **BLOCKED** — the local implementation and branch commit are verified to the limits below, but the
required GitHub source-build matrix, uploaded controlled artifacts and provenance attestations are still absent.
This is not an F0 PASS and does not permit F1 to begin.

Date: 2026-09-03
Issue: [#3771 — DSH: prove the Cindy-owned bridge gate](https://github.com/makecindy/cindy/issues/3771)
Requirements: [`dsh-native-integration-requirements.md`](../issues/dsh-native-integration/dsh-native-integration-requirements.md)
Specification: [`dsh-native-integration-technical-spec.md`](../issues/dsh-native-integration/dsh-native-integration-technical-spec.md)
Plan: [`dsh-native-integration-development-plan.md`](../issues/dsh-native-integration/dsh-native-integration-development-plan.md)
Validation plan: [`dsh-native-integration-validation-plan.md`](../issues/dsh-native-integration/dsh-native-integration-validation-plan.md)

## Sources checked

- [`source-release.json`](../../tools/dsh/source-release.json): fixed alpha3 commit/tree, frozen pnpm/pkg
  closure, exact per-platform SEA base archives, and the one-file exact-target adaptation.
- [`dsh-source-runtime.yml`](../../.github/workflows/dsh-source-runtime.yml): archive is verified/uploaded
  before runtime execution; Linux/macOS smoke only an extracted archive; a fresh attest job re-verifies the
  downloaded artifact; Windows is `smoke-withheld` until F2 containment. It auto-runs for controlled DSH
  changes because GitHub cannot manually dispatch a workflow before the file exists on its default branch.
  A fork run is no-secret build/smoke evidence only: only `makecindy/cindy` can issue a trusted attestation.
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
- F0 script tests: 28/28 passed; maker-core ACP test: 12/12 passed; Desktop DSH unit tests: 23 passed,
  1 skipped (the Windows-only path); maker-core and Desktop typechecks passed; developer-docs and
  workflow-YAML checks passed.
- `pnpm test:unit:related`: passed after the repository-wide local test gate was released. Because the
  workflow/package-toolchain changes are classified as wide, this ran the root runner (522 passed, 1 existing
  skip) and the complete applicable unit-workspace matrix, including Desktop (143.1s) and maker-core (201.2s).
- Current final DSH security diff audit: scan `9177d8b6-2ac3-4475-89fe-eede8dc72c79` reviewed all 21
  executable change surfaces, including the new permission round trip, and produced zero reportable findings.

## Findings

No scoped implementation defect was found in the local F0 delivery. The following are blockers, not passes:

1. The initial manual dispatch was rejected because GitHub requires `workflow_dispatch` files to exist on the
   default branch. The workflow now has a narrow automatic push/PR trigger; its first branch run and evidence
   are pending.
2. Linux runner evidence and all Cindy provenance attestations are absent. The current fork cannot substitute
   its own CI identity for `makecindy/cindy`; an upstream same-repository PR or post-merge push is required.
3. Windows runtime execution is intentionally withheld: build/archive/attestation are not runtime-smoke proof
   before F2 provides launch-time, identity-bound whole-tree containment.

## Scope and acceptance check

The local code and documentation match F0's Cindy-owned public-ACP evidence scope: no upstream Native Host API,
private runtime state, user credential, product registration, persistent F3 binding or F2 installer was used.
The required F0 acceptance condition — reviewed GitHub controlled artifacts and provenance for each declared
target under the documented smoke policy — remains unproven.

## Routing and close readiness

Routing: **blocked** pending the path-filtered branch CI run and review of its actual artifact digests and
attestations. After it finishes, rerun this validation report against those records. The issue and any future PR
are **not close-ready**.
