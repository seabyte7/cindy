# DSH alpha.3 Public Transport Source Audit

Date: 2026-09-02
Packet: `deepseek-harness-runtime-bin-0.1.2a3-darwin-arm64.json`
Decision: **INCOMPLETE — a local, exact-source darwin-arm64 controlled archive now passes its extracted-artifact ACP and Desktop Main E2E probes, but no multi-platform GitHub provenance gate has completed and Windows runtime execution remains withheld pending F2 containment.**

This human review complements the legacy, machine-readable F0 wheel packet and records the source selection
that Cindy's controlled build must re-verify. It does not use a source-only class as proof that either the
reviewed wheel or a future Cindy-built archive exposes a transport. The wheel is comparison-only after the
source-build decision; it is not a production input or fallback.

## Exact source inspected

- Repository: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Tag: [`dsh-v0.1.2-alpha.3`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.3)
- Resolved commit: `dd6322d604e00eec1ba5e0c8541159906a21094a`
- Wheel line under review: PyPI `deepseek-harness-runtime-bin` `0.1.2a3`, executable `0.1.2-alpha.3`.

The tag and wheel share the alpha.3 version line, but no published provenance attestation binds the wheel
SHA-256 to that commit. A 2026-09-02 read-only GitHub release lookup found the lightweight release tag pointing
to `master` with no release assets; the wheel metadata has only the repository URL and version, not a source
commit or build attestation. PyPI reports that this wheel used Trusted Publishing, but its exact PEP 740 Integrity
API provenance endpoint returned HTTP 404 on the same date. Trusted Publishing upload status is not a source-build
attestation, so it cannot promote the packet. The packet correctly retains
`wheelToSourceBinding: "unverified"`.

## Public automation transport

The source documents `pnpm dsh --profile acp` as a standard Agent Client Protocol (ACP) server. It exposes
`initialize`, `session/new`, `session/list`, `session/resume`, `session/close`, `session/prompt`,
`session/cancel`, semantic `session/update`, and one-shot `session/request_permission`. The runtime capability
advertisement is therefore the only upstream surface Cindy needs for the transport layer.

The source also contains internal `api/session-controller` and gateway packages. They are composition libraries,
not a prerequisite for Cindy: this project does not rely on them, launch an undocumented listener, or read
private session files. The user-authorized architecture is a Cindy-owned control plane over public ACP, not a
proxy for an upstream Host API.

## Legacy wheel comparison observations

The legacy F0 runner validates the reviewed wheel's hash, archive tree, executable and macOS sidecars. In temporary
managed Homes it successfully ran `--version`, SDK initialize/shutdown, SDK EOF, SDK SIGTERM, ACP initialize,
ACP `session/new`, idle `session/cancel` notification, `session/close`, `session/list`, `session/resume`, a
second close, and ACP EOF. The observed ACP identity is `deepseek-harness-acp` `0.0.1`, protocol version 1,
with close/list/resume advertised.

The Desktop Main `DshControlPlane` fixtures now run the same alpha.3 executable through the real
`DshAcpClient` and Main-owned stdio transport. The lifecycle fixture proves create, close, list/reconcile,
resume, idle cancel and close with scoped binding ownership and receipt generation. A separate opt-in prompt
fixture uses only a temporary ACP profile under the fresh managed Home, a `127.0.0.1` OpenAI-compatible mock and
a deliberately fake fixture key. It proves a bridge-owned prompt, an ACP `session/update`
`agent_message_chunk` routed through the Cindy bridge only to its owned runtime session, cancellation while a
streamed turn is open, and close. The bridge returns only the validated prompt terminal result `end_turn` or
`cancelled`; the fixture specifically observed `cancelled`. It neither reads a user credential nor makes an
external network call. The runtime lists a session only after its active handle closes; resuming an active session
is invalid. Cindy therefore preserves the binding on close and only permits resume after that transition.

The F0 bridge also serializes public notification delivery and exposes no raw runtime-id subscription API. Its
runtime-facing operations have a bounded control-plane timeout. A timeout, unexpected carrier EOF or exit closes
the carrier, marks the in-memory scope `needs-reconcile` and rejects every later operation; it does not retry a
prompt, infer that the native session closed, or make the runtime carrier accessible to a caller. This is a
fail-closed F0 boundary, not F3's durable recovery implementation. The unit contract sends malformed and
unrecognized JSON-RPC frames through stdout and proves the carrier is closed without writing a payload preview to
the logger. It additionally rejects a missing `jsonrpc: "2.0"` envelope, invalid request/response shape, malformed
error object, or a runtime session id with control characters or more than 4 KiB; those semantic protocol failures
also close the carrier. Any initialize rejection or malformed required session capability closes the carrier rather
than leaving a partially negotiated scope available. The bridge also requires Main to inject a workdir authorization
assertion; absolute path syntax alone cannot authorize `session/new` or `session/resume`, and unit plus real-binary
fixtures exercise that boundary.

The Main and admission-gate NDJSON decoders enforce the byte ceiling before decoding and use fatal UTF-8 decoding.
Malformed bytes are not normalized into replacement characters: the Main destroys the child carrier and the evidence
runner fails its probe. A local child fixture emits a raw invalid byte then loops, and proves the Main carrier closes
without exposing a decoded payload.

The regular close path is equally bounded: EOF, then `SIGTERM`, then `SIGKILL`, then an explicit failure if no close
event confirms exit after the final grace period. Therefore a non-observable child is never reported as safely cleaned
up merely to settle a Promise. An in-memory fake child that accepts both signals yet never emits `close` locks this
last failure path in the Desktop unit suite.
The Main stdio transport closes a child as EOF → bounded TERM → bounded KILL; a local fixture that explicitly
ignores TERM proves the KILL escalation settles the carrier without an orphan. The source-runtime smoke runner
now launches POSIX runtime roots as dedicated process groups and tests a root-first exit with a same-group
descendant. It signals TERM then KILL to the group and refuses to report cleanup when group exit cannot be
confirmed. This is ordinary-descendant evidence only: `setsid` / double-fork escapes are explicitly deferred to
F2, and Windows runtime execution is withheld until a launch-time identity-bound Job Object exists.

No tool call or permission request was run. The prompt fixture is a provider-wire and bridge-lifecycle proof, not
a user credential, production route, Desktop UI, Windows/Linux, remote, Mobile, durable-binding migration, or
release result.

## Local controlled-source execution record (not release provenance)

On 2026-09-03, a fresh local checkout at the fixed commit first passed the tag→commit→tree and input digest
checks. Cindy then applied exactly one release-bound patch:
`tools/dsh/upstream-patches/deepseek-harness-alpha3-exact-node-target.patch`
(`f361e93e013864417ef17912c6f333d4a505e055e79c84211732bdc757f73d19`). Its sole declared target,
`scripts/build-exe-for-python-sdk.ts`, matched the recorded preimage
`bf9061085f202d3afc25ff9208c53bc0facd3e6c50baaf1f28c36a678d620881` and postimage
`8053640bda901c12bb9003f5943100721604c0f01f39efa97b9b79272109e957`. The patch only lets the upstream
parser pass the already-supported exact `node24.20.0-macos-arm64` target to the pinned pkg toolchain; it does
not alter runtime logic.

The build used release-pinned pnpm 11.7.0, the Cindy frozen `@yao-pkg/pkg@6.21.0` closure and the locally
verified official `node-v24.20.0-darwin-arm64.tar.gz` SHA-256
`40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8`. The generated runtime was packaged,
its deterministic archive reverified, freshly extracted, and then passed `--version`, public ACP initialize,
new/cancel/close/list/resume/close, and clean exit. The same extracted binary passed both Desktop Main real-ACP
E2E fixtures: scope lifecycle/reconcile/resume/cancel and a loopback-only prompt/follow/running-turn-cancel
fixture using a fake key. This is local darwin-arm64 implementation evidence only; it is not an uploaded CI
artifact, GitHub provenance attestation, multi-platform result, Windows runtime smoke, or an F0 PASS.

## Historical source-build reproducibility investigation

Cindy previously built the exact inspected commit twice with the upstream's documented
`scripts/build-exe-for-python-sdk.ts --targets=node24-macos-arm64` route, the same clean tracked source and the
same `pnpm-lock.yaml` (`17bbd38216e31a8b821957f77d2e3f57b859046cc3a18076ad16e94ca952a8da`). Both builds
completed and their `rg` and `spawn-helper` sidecars were byte-identical. The main executables were **not**
byte-identical (`5c3c40033329ade06de556651801060bb394f7cb3fc5a746c7bb52972c039201` versus
`0e12c29a0256af1559e86fcc5ed4eb2f52bc0c22cff0c555d84982ff85fc565b`), and the two locally packaged wheels
also differed. Inspection shows `@yao-pkg/pkg` embeds a per-build temporary `pkg-sea-*/sea-main.js` path in the
main executable. A direct comparison of the reviewed executable with the second local build also found different
lengths (260,549,968 vs 260,878,288 bytes) and 152,852,853 differing overlapping bytes; this rules out a safe
"strip the temporary path and compare" normalization. This is evidence of a non-reproducible build input, not a
justification to weaken provenance. Those exploratory builds used the upstream command path before the
undeclared `pnpm dlx @yao-pkg/pkg@6.21.0` closure was frozen in Cindy's committed toolchain, so they are neither
the controlled build nor a production artifact. They do not change any packet field to `verified`, and they do
not satisfy the source-build gate.

## Gate result and required evidence

`INCOMPLETE` is correct because the checked-in packet is still a legacy wheel comparison packet, the local
darwin-arm64 result lacks a GitHub provenance attestation, no Linux runner has produced an admitted result, and
Windows runtime execution is deliberately withheld before F2 containment. The missing upstream wheel-to-source
provenance is retained as comparison evidence only; it is **not** the production gate after the user-selected
source-build policy. F0 unit tests prove an abrupt child exit closes the carrier, rejects later writes and leaves
the control plane in an explicit non-retrying `needs-reconcile` state. Durable binding / receipt persistence and
process-restart recovery intentionally belong to F3; they remain product-registration requirements, but cannot
be made an F0 PASS condition because F3 depends on F1 and F2. The core Desktop Main bridge result becomes an F1
handoff input only after the controlled CI evidence below is admitted. This is not a claim that DSH lacks a
separate Host API, and it does not require one to proceed.

F0 passes as a release-evidence handoff for F1 only after:

1. each declared target is built from the committed tag→commit→tree and frozen Cindy toolchain by the reviewed
   Cindy workflow. Linux and macOS additionally require the controlled archive, tree manifest, public runtime
   smoke and build provenance attestation to be reviewed and accepted. Windows remains archive-only and
   unavailable until F2 adds its Job Object containment plus a separately reviewed runtime smoke;
2. the reviewed Desktop Main bridge retains the currently passing public-ACP create, resume, follow/update,
   prompt, cancellation during a running turn and close fixtures without exposing credentials or raw runtime data.

F3 separately delivers persistent scope/session ownership, receipt correlation, recovery after EOF/exit and no
uncertain-prompt replay across a process restart. F0 PASS does not register DSH in the product; it only releases
the F1 → F3 foundation sequence from an impossible circular dependency.

Until the controlled CI evidence is admitted, DSH remains unavailable in the product and F1–F11 stay blocked.
After F0 passes, DSH still remains unregistered until the later phase gates, including F3 recovery, have passed.
Cindy is not waiting for a new upstream Native Host API.
