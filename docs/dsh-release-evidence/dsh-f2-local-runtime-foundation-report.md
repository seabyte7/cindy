# DSH F2 Local Runtime Foundation Report

Result: **LOCAL-PARTIAL — admission and Main-only Host foundation passed; product launch remains unavailable.**

Date: 2026-09-03
Requirements: [`dsh-native-integration-requirements.md`](../issues/dsh-native-integration/dsh-native-integration-requirements.md)
Specification: [`dsh-native-integration-technical-spec.md`](../issues/dsh-native-integration/dsh-native-integration-technical-spec.md)
Plan: [`dsh-native-integration-development-plan.md`](../issues/dsh-native-integration/dsh-native-integration-development-plan.md)

## Delivered and verified

- [`tools/dsh/latest.json`](../../tools/dsh/latest.json) is a local-only `darwin-arm64` pin for the exact F0
  source-built archive. It fixes archive name, byte length and SHA-256 plus all executable/sidecar tree entries;
  it contains no URL and no runtime bytes.
- [`tools/dsh/update.mjs`](../../tools/dsh/update.mjs) accepted a current F0 bundle manifest and explicitly supplied
  local archive only after `verifyReleaseBundle`; it copied neither source checkout nor a user-installed DSH binary.
  A stale F0 manifest that still declared non-macOS targets was rejected before import.
- [`local-runtime.ts`](../../apps/desktop/src/main/dsh-host/local-runtime.ts) verifies the pin before extraction,
  checks the promoted tree again, and rechecks realpath, file type, mode and SHA-256 before every future launch.
  Unit tests cover unsupported platform, mismatched bundle, archive tree mismatch and post-install symlink mutation.
- The opt-in local integration test installed the fresh F0 archive to a unique temporary user-data-shaped root,
  then passed `--version` and Desktop Main ACP `initialize → create → close` using the installed executable.
- [`scope.ts`](../../apps/desktop/src/main/dsh-host/scope.ts) and
  [`host-manager.ts`](../../apps/desktop/src/main/dsh-host/host-manager.ts) passed unit tests for hashed account
  scopes, managed Home, non-project launcher cwd, allowlisted memory-only child environment, single-flight start,
  failed-start cleanup and account-switch teardown. Existing DSH Home remains non-secret metadata only and cannot
  execute before F7.

## Commands and results

- `pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/local-runtime.test.ts src/main/dsh-host/__tests__/scope-and-host-manager.test.ts`: 12 passed.
- `CINDY_DSH_F2_E2E_ARCHIVE=<local-f0-archive> CINDY_DSH_F2_E2E_MANIFEST=<local-f0-manifest> pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/local-runtime.integration.test.ts`: 1 passed.
- `node tools/dsh/update.mjs --bundle-manifest <local-f0-manifest> --archive <local-f0-archive> --output-dir <fresh-local-directory>`: PASS.
- A no-network macOS Seatbelt shell-descendant fixture passed: a background child could write only its dedicated
  temporary directory and could not write its sibling path. This demonstrates inheritance only, not DSH compatibility.

## Not proved and therefore unavailable

- Product DSH spawn/registration is blocked. `DshHostManager` accepts only an injected launch-time,
  identity-bound containment client; it has no default implementation and cannot convert F0 process-group cleanup
  into a product safety claim.
- The no-network macOS Seatbelt experiment is a negative result. Shell → `sandbox-exec` → installed DSH
  `--version` exited successfully, but Node/Desktop Main `spawn()` of the same binary/profile exited `SIGABRT`
  before ACP initialize (with and without a detached process group). The experimental adapter was removed;
  DSH-under-native-containment handshake, compatibility and real tree teardown remain F2 exit work. No
  network-capable profile was run.
- No CDN, remote runner, GitHub Actions, artifact upload, release, Linux, Windows, Intel macOS, SSH, Mobile or
  upstream operation was run or claimed.
