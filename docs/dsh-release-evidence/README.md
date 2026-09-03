# DSH F0 Cindy Bridge Evidence

This directory stores public, repeatable, secret-free F0 evidence packets. It is not a DSH runtime cache,
installation location, or user-data directory. Never commit a wheel, executable, `DSH_HOME`, profile, session,
full stderr, or credential.

The current wheel verifier is retained for **comparison-only** alpha.3 protocol evidence. It cannot admit a
production runtime after the source-build decision; production admission requires the controlled source-build
workflow, its archive manifest and Cindy provenance attestation.

The controlled workflow reads [`tools/dsh/source-release.json`](../../tools/dsh/source-release.json), verifies
the upstream tag→commit→tree tuple, then applies its SHA-256-bound, preimage/postimage-checked minimal build
adaptation that permits the exact Node SEA target the alpha.3 parser otherwise rejects. It downloads the
release-SRI-pinned pnpm tarball with npm scripts disabled and verifies it before execution, then uses the frozen
`tools/dsh/pkg-toolchain/` closure for the one upstream `@yao-pkg/pkg` invocation that is not included in the
upstream lockfile. The exact Node SEA archive is SHA-256-checked before and after build. The workflow verifies
and uploads each archive **before** executing its generated runtime, tests only a fresh extraction of that
uploaded archive, then uses a separate no-runtime attestation runner to verify and attest the service-side
artifact. Linux and macOS execute this smoke under a dedicated POSIX process group; Windows remains
`smoke-withheld` until F2 supplies launch-time, identity-bound whole-tree containment. A workflow definition or
local build is not itself release evidence: the resulting artifact, provenance and every claimed-platform smoke
must be reviewed before F1 can begin.

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

- `PASS`: only the controlled source-build CI evidence packet may claim this state, after its fixed-source,
  Cindy-attested archive and Desktop Main-owned, versioned Cindy bridge prove
  create/resume/follow/prompt/cancel/close under the accepted lifecycle contract.
- `FAIL`: a comparison packet, source input, controlled archive, tree, version, ACP lifecycle, or an operation
  declared as passed is inconsistent or failed.
- `INCOMPLETE`: the real runtime works only for the subset evidenced so far, or required Cindy source-build
  provenance / production-bridge boundaries remain unproven. This is the expected current state; it does not authorize DSH
  registration.

The alpha.3 darwin-arm64 packet proves binary/SDK lifecycle, ACP initialize/new/close/list/resume, and the
Desktop Main `DshControlPlane` core lifecycle (create, close, reconcile, resume, idle cancel, close), plus a
loopback-only prompt, ordered session-owned `session/update` follow, running-turn cancellation and an explicit
constrained `stopReason: cancelled` result. Every runtime operation has a bounded control-plane timeout; a timeout
closes the carrier and puts the F0 bridge into a no-retry `needs-reconcile` state, just like EOF/exit. This only
proves the in-memory fail-closed boundary, not a durable recovery record. Unit coverage additionally proves that
malformed or unrecognized ACP stdout closes the carrier without logging a runtime-content preview. It does not prove tool or permission handling, Desktop UI, other
platforms, remote, Mobile, durable binding persistence, process-restart recovery, or a release. The source review
is in [`deepseek-harness-alpha3-source-controller-audit.md`](deepseek-harness-alpha3-source-controller-audit.md).
