# DSH Local Development Evidence

This directory stores public, repeatable, secret-free local DSH development evidence packets. It is not a DSH runtime cache,
installation location, or user-data directory. Never commit a wheel, executable, `DSH_HOME`, profile, session,
full stderr, or credential.

The current wheel verifier is retained for **comparison-only** alpha.3 protocol evidence. The approved runtime
development path is a local `darwin-arm64` source build; it is not a production or distribution admission path.

F1 local Desktop identity-closure evidence is in
[`dsh-f1-local-identity-closure-report.md`](dsh-f1-local-identity-closure-report.md). It proves identity retention
and unavailable-by-default boundaries only; it does not expand F0 into a managed runtime, product session,
cross-platform, remote, Mobile or release claim.

The local controlled build reads [`tools/dsh/source-release.json`](../../tools/dsh/source-release.json), verifies
the upstream tag→commit→tree tuple, then applies its SHA-256-bound, preimage/postimage-checked minimal build
adaptation that permits the exact Node SEA target the alpha.3 parser otherwise rejects. It downloads the
release-SRI-pinned pnpm tarball with npm scripts disabled and verifies it before execution, then uses the frozen
`tools/dsh/pkg-toolchain/` closure for the one upstream `@yao-pkg/pkg` invocation that is not included in the
upstream lockfile. The exact Node SEA archive is SHA-256-checked before and after build. The local build flow
packages and verifies the `darwin-arm64` archive **before** executing its generated runtime, then tests only a fresh
local extraction. It does not upload artifacts, request a GitHub identity token, create an attestation, run a
remote workflow, or build another platform. This local evidence admits only the next local development phase;
it is not release evidence.

Run the legacy verifier with a reviewer-supplied wheel in a temporary directory:

```sh
node scripts/dsh-native-host-gate.mjs \
  --packet docs/dsh-release-evidence/deepseek-harness-runtime-bin-0.1.2a3-darwin-arm64.json \
  --wheel /absolute/path/to/reviewed-wheel.whl \
  --out /private/tmp/dsh-f0-result.json
```

The legacy script filename is retained for early-F0 compatibility; its policy is now the **Cindy Bridge Gate**.
It is a pure Node verifier: it checks filename, size, SHA-256, ZIP paths/types, whole file tree, executable and
sidecars; then starts the shipped executable only in fresh temporary directories with an empty `DSH_HOME` and a
non-project launcher cwd. It never calls `pip`, npm, pnpm, `curl`, a user PATH `dsh`, or system Node, and never
writes a runtime to the repository.

It performs both the SDK lifecycle smoke and the public ACP lifecycle: ACP initialize, new, idle-cancel
notification, close, list, resume, close, and clean EOF. The pure Node verifier intentionally does not send a
model prompt. A separate opt-in Desktop Main real-binary fixture creates a temporary ACP profile that routes only
to a loopback mock with a deliberately fake key; it provides prompt, `session/update` follow and
cancel-under-turn evidence without an external credential or network route.

Result states:

- `LOCAL-PASS`: the controlled local `darwin-arm64` source build and Desktop Main-owned, versioned Cindy bridge prove
  create/resume/follow/prompt/cancel/close under the accepted lifecycle contract.
- `FAIL`: a comparison packet, source input, controlled archive, tree, version, ACP lifecycle, or an operation
  declared as passed is inconsistent or failed.
- `INCOMPLETE`: the real runtime works only for a subset of the local contract. Neither result authorizes a
  product registration, release, remote runner or non-macOS platform claim.

The alpha.3 darwin-arm64 packet proves binary/SDK lifecycle, ACP initialize/new/close/list/resume, and the
Desktop Main `DshControlPlane` core lifecycle (create, close, reconcile, resume, idle cancel, close), plus a
loopback-only prompt, ordered session-owned `session/update` follow, running-turn cancellation and an explicit
constrained `stopReason: cancelled` result. Every runtime operation has a bounded control-plane timeout; a timeout
closes the carrier and puts the F0 bridge into a no-retry `needs-reconcile` state, just like EOF/exit. This only
proves the in-memory fail-closed boundary, not a durable recovery record. Unit coverage additionally proves that
malformed or unrecognized ACP stdout closes the carrier without logging a runtime-content preview. The F0 real-binary
fixture also proves that a workspace-write `session/request_permission` is returned as `cancelled` and makes no
write; it does not prove an allow path, Desktop UI, other platforms, remote, Mobile, durable binding persistence,
process-restart recovery, or a release. The source review
is in [`deepseek-harness-alpha3-source-controller-audit.md`](deepseek-harness-alpha3-source-controller-audit.md).
