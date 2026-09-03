# DSH Cindy 控制面接入 Validation Plan

Status: confirmed
Requirements: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
Technical spec: docs/issues/dsh-native-integration/dsh-native-integration-technical-spec.md
Development plan: docs/issues/dsh-native-integration/dsh-native-integration-development-plan.md
Artifact: docs/issues/dsh-native-integration/dsh-native-integration-validation-plan.md

## Project Testing Profile

本仓当前没有 .codex/testing-profile.md 或 docs/ai/testing-profile.md。以下以根 package.json 和根
AGENTS.md 的强制门禁为准：

- 文档-only：pnpm check:dev-docs、git diff --check。
- 任意提交：pnpm test:unit:related、每个受影响 package 的 pnpm --filter <package-name> run
  --if-present typecheck、pnpm check:dco、git diff --check。
- 迁移：pnpm --filter desktop db:validate 和 pnpm --filter desktop test:migration-replay，另加
  本阶段的 targeted migration tests。
- UI 文案：pnpm check:i18n 和 pnpm check:i18n-glossary。
- 跨模块、高风险、运行时、DB、协议、remote 或 Mobile 变更按阶段追加 targeted integration；
  final release 使用 pnpm test:all 及发布 runner。未运行的检查必须如实标记为未验证。

所有 F0–F11 PR 在开始前和提交前复核当前 AGENTS.md、嵌套 AGENTS.md、专项规则和当前测试脚本；
本文件不授权跳过或弱化测试。

## Evidence Levels

| Level | 要证明什么 | 不能替代什么 |
|---|---|---|
| Static | 类型、schema、路径/依赖、redaction、manifest、迁移和 diff 基本正确 | 真实 DSH binary、UI、SSH、Mobile 或发布 runner。 |
| Unit/contract | pure mapper、validator、reducer、failure branch 和存量兼容 | ACP/Cindy bridge 的真实 wire/lifecycle。 |
| Real binary | 固定 release 的 executable、ACP handshake、Cindy bridge operation、stdout/exit/lifecycle | 其他平台、remote、Mobile 或用户真实数据。 |
| Desktop integration | Main/preload/renderer 与 local DSH 的端到端任务 | SSH、device-link、新旧版本矩阵。 |
| Remote/mobile integration | 远端 ownership、forward、协议和多端任务连续性 | 发布全平台或完整生态兼容。 |
| Release evidence | 每一声明的平台/版本/升级状态都由独立 runner 和治理记录支持 | 后续 runtime release 或未测能力。 |

测试报告必须分别列出这些层，禁止把其中任一层泛称“DSH 已验证”。

## Automated Checks

### F0: Release Evidence

- Parse source-build evidence schema; validate tag→commit→tree, upstream lockfile/Cindy pnpm SRI and pkg-toolchain lock/integrity/build-script digest, fixed builder,
  Cindy provenance reference, archive URL/version/size/hash, executable/sidecar list and extracted tree
  manifest against the same signed-off tuple.
- Negative cases: hash mismatch, zip-slip/path traversal, symlink/special entry, unexpected top-level entry,
  missing sidecar, missing executable, changed API version, non-absolute or Main-unauthorized session cwd,
  unredacted token/path/header pattern.
- Use the real pinned binary in a temporary managed Home and non-project cwd for version, ACP handshake,
  create, close, list/reconcile, resume (when advertised), prompt, follow/history, cancel, EOF and SIGTERM
  fixtures. Assert the release-specific active-session rule: an active session is not inferred missing from list
  and cannot be resumed before close.
- Run the same lifecycle through Cindy `DshBridgePort`; assert single owner, scoped receipt correlation,
  timeout/EOF/exit reconciliation and no uncertain prompt replay.
- Assert F0 ordinary-descendant cleanup: on POSIX, fixtures cover both a live root and a root that exits before
  its same-group descendant, proving EOF/TERM/KILL still target the dedicated process group; on Windows, the
  unregistered transport declares DSH unavailable. This is not OS containment: F2 must add an escape fixture
  (`setsid` / double-fork) and prove it is contained by a platform-specific supervisor before product launch.
- Record platform runner results separately. A macOS result does not pass Linux; Windows is explicitly
  `smoke-withheld` and unavailable until F2's launch-time, identity-bound Job Object (or equivalent) exists, so an
  archive/attestation result cannot be represented as a Windows runtime pass.

### F1: Identity Closure

- Compile/exhaustive tests for AgentKind dsh across maker-core, maker-shared, Desktop, device-link and Mobile.
- Inventory test covers every enumerated closed union plus a negative unknown-kind decoder test.
- Regression fixtures preserve cc/codex/pi session creation, persistence, search, scheduler, remote routing,
  agent switch and Mobile projection.
- Assert unavailable DSH cannot be selected merely because its type exists.

### F2: Runtime and Host Supervisor

- Unit tests for reviewed pin resolution, archive hash, tree manifest, sidecar requirement, optional asset,
  unsupported platform and no fallback to PATH/npm/pnpm/pip/curl/system Node.
- Provisioner/launch negative tests reject a caller-supplied binary, command, argument or environment; reject a
  symlink or post-promotion path whose `realpath` leaves the verified install root; and reject a non-regular,
  non-executable or digest/mode-mismatched executable or sidecar before spawn.
- Scope tests: non-project cwd, explicit Home, unique scope key, allowlisted environment, no secret in argv/log/
  profile/DB, stale endpoint, timeout, crash, account switch, quit and orphan cleanup.
- Real binary smoke uses F0 release for version/handshake/close; mock-only tests are insufficient.

### F3: Bridge and Binding

- Desktop schema/migration/replay tests for binding creation, uniqueness, indexes, corruption, legacy rows and
  an interrupted upgrade.
- Contract tests for command scope/ACP capability/session/request correlation, receipt persistence, sequence dedupe,
  follow-before-history, gap reconcile and no uncertain prompt replay.
- Integration tests run two accounts/scopes/sessions and reject duplicate bridge ownership or cross-scope ids.

### F4: Events and Interactions

- Schema fuzz/fixture tests for unknown enum/field, missing field, bad version, stale/out-of-order sequence,
  duplicate terminal, child exit, stdout noise and bounded diagnostic behavior.
- Translation tests prove exact mapping for enabled text/thought/tool/usage/status/error/done; Cindy-owned
  records use `cindy-dsh` activity only. Error fixtures prove raw ACP `error.data`, stderr and stacks never cross
  the Main-to-Renderer projection.
- Permission tests cover matched toolCallId, missing/foreign/stale/cleared id, timeout, disconnect,
  allow-once/reject-once and no persistent allow state.
- Measure event reducer/backpressure bounds under a representative real native trace.

### F5: Desktop Core

- Main/preload/renderer tests for sender/session/scope/action validation, capabilities, unavailable state,
  model/effort gate, attachment rejection, approval/cancel, reload/reconnect and reconcile.
- End-to-end local real-binary smoke: create -> prompt -> tool decision -> result/cancel -> renderer reload ->
  resume/history.
- i18n and glossary gates; visual confirmation of Light and Dark on supported Desktop environment.

### F6: Cindy DSH Activity

- Reducer/UI contract tests for plan/todo, command/elicitation, terminal, task/job/workflow/schedule identity,
  action availability, complete/fail/cancel/disconnect/reconnect and unsupported APIs.
- Terminal owner/session/scope validation, input/signal/close race, stale activity and host restart limitations.
- Persistence and broadcast tests reject arbitrary raw native payloads.

### F7: MCP, Skills, Profiles and Extensions

- Managed/existing Home isolation, switch/reset, no credential copying and no destructive cleanup tests.
- Separate native and Cindy-internal MCP origin/transport/allowlist/loopback/token/lease/generation/account
  cleanup tests, including remote bridge when present.
- Explicit native operation tests: install/update/enable/disable/recover, interrupted state and recovery; no
  secret, header or command reaches Renderer/Mobile/logs.

### F8: SSH Remote

- Remote installer/probe/manifest/version/Host smoke on supported remote targets.
- Assert runtime/Home/workdir/file/attachment/terminal/MCP credentials stay remote; no local path or secret
  substitution.
- Real create/resume/prompt/approval/terminal plus SSH-forward loss/reconnect; run failure-radius matrix over
  local DSH, two remote scopes and a Mobile peer.

### F9: device-link and Mobile

- Shared payload schema, versioning, Desktop allowlist and Mobile reducer tests.
- old Desktop × old Mobile, old Desktop × new Mobile, new Desktop × old Mobile and new Desktop × new Mobile
  matrix; each unsupported path is explicit.
- Two concurrent control peers: approval/cancel/queue ownership, one-peer disconnect and no duplicate native
  session/prompt.
- If native Mobile inputs change, execute the cold-update approval and native build evidence required by
  mobile-development.md.

### F10: Orca Boundary

- Origin/provenance persistence, UI, audit and control tests distinguish `cindy-dsh` objects from Orca worker.
- Nested/unsupported policy, permission/budget/result handoff, stop/failure/recovery and remote/Mobile
  projection tests.
- Full regressions for existing Claude/Codex/Pi Orca paths.

### F11: Release Governance

- Rebuild F0 packet for the release candidate and compare ACP/Cindy bridge capability diff to the accepted packet.
- Run selected local Desktop, supported Windows/Linux/macOS runner, remote, device-link/Mobile, upgrade and
  rollback suites; record each platform/version result separately.
- pnpm test:all, DCO, lint/typecheck/test gates and independent P0/P1 adversarial review.
- Upgrade test begins from an earlier binding/Home/profile/plugin state and proves preservation or a documented,
  reversible block; never masks incompatibility by reinstallation.

## Manual / Browser / Device Checks

| Surface | Required manual proof | Minimum evidence |
|---|---|---|
| F0 bridge | Inspect redacted real ACP responses and Cindy bridge lifecycle receipts | review record linked to evidence packet. |
| Desktop core | Create/reopen/cancel/reconcile a local DSH task; inspect unsupported and permission language | screen recording or reproducible manual checklist, plus real-binary log ids without secrets. |
| Theme/locales | Inspect Light/Dark and en/zh-CN/zh-TW/ja/ko for touched DSH UI | screenshots/checklist; state omitted environments honestly. |
| Cindy activity panels | Observe and control each enabled plan/terminal/job/etc. object; test disconnect | object/action matrix with provenance, version and capability snapshot. |
| Existing Home | Switch modes; make an explicit native extension change; simulate failure and recover | before/after state hashes or safe manifest, never credentials. |
| SSH | Verify remote location and reconnect on a non-local host | host label, process location and scoped recovery checklist. |
| Mobile | View/continue/approve/stop from a real paired device and test version skew | four-version compatibility matrix plus two-peer result. |
| Release | Test installation/upgrade from prior supported release | signed release evidence and rollback report. |

No browser/device evidence is substituted by code inspection. If unavailable, leave the corresponding release
claim blocked.

## Static Searches

Run these as review aids; every hit is classified as intended, fixed or blocked before merge.

- Find stale three-value unions and display switches: rg for claude-code, codex, pi in packages, apps and scripts;
  compare against the F1 inventory rather than blanket-replacing strings.
- Find forbidden fallbacks and leakage: rg for DSH_HOME, process.env, PATH, execPath, npm, pnpm, pip, curl,
  controller token, authorization/header and raw DSH payload paths.
- Ensure no private-state workaround: rg for DSH JSONL, direct DSH database file, log parsing and unknown-to-done
  conversion.
- Ensure `cindy-dsh` never enters Orca storage/projection unless F10's explicit contract says so.
- Ensure Desktop/Mobile code has no direct controller endpoint or generic privileged IPC.
- Run secret scanning and inspect staged diff manually; test fixtures may contain only generated/fake secrets.
- For migrations, check append-only journal/snapshot additions and no edits to historical migration files.

Static searches are guardrails, not acceptance proof; newly discovered references must be added to F1's inventory
or an explicit follow-up issue.

## Regression Scenarios

1. Existing Claude/Codex/Pi local, remote, scheduled and Mobile sessions remain readable, runnable and correctly
   labelled after every dsh phase.
2. DSH unavailable, unsupported platform, changed release, missing asset, bad Home, bad credential and host crash
   leave Cindy usable and do not offer a false replacement Agent.
3. Two accounts, two scopes and two sessions cannot exchange native event, approval, binding, Home, token, path,
   terminal or usage state.
4. Renderer reload, Mobile disconnect, SSH forward drop and app restart do not delete a native session or replay a
   side-effecting request; uncertain state shows reconcile.
5. A missing/foreign/expired toolCallId rejects once and no action becomes persistent allow.
6. A native unknown event/type/version never becomes done, ordinary text, tool output, Orca worker or a new
   session.
7. Existing-dsh-home, profile, skill/plugin and extension transitions preserve prior state and have recovery.
8. Runtime upgrade preserves valid binding/history/extensions or blocks reversibly; downgrade does not corrupt
   old DSH state.
9. `cindy-dsh` activity and Orca workers remain distinguishable through DB, UI, stop, audit, remote and Mobile.
10. No test log, evidence packet, screenshot, DB row, crash marker or IPC payload contains a credential/token.

## Pass Criteria

A child issue passes only when its phase-specific tests, root mandatory checks, scoped rule review and code/diff
audit all pass; it is not merged merely because a later phase is planned. A phase may expose only capabilities
with both F0 evidence and Cindy contract/UI tests.

The program passes only when F11 has a single release matrix showing:

- F0 Cindy Bridge Gate is PASS for the exact promoted release;
- every enabled F1–F10 capability has successful evidence at its required layers;
- unsupported/unverified capabilities retain a correct reason and invisible/disabled action path;
- P0/P1 issues for secret exposure, ownership mix-up, unsafe fallback, native-state loss, remote misexecution or
  extension regression are resolved and independently reviewed;
- maintainer explicitly approves updating the DSH design status from unadmitted to complete availability.

## Known Validation Gaps

Current F0 evidence for the darwin-arm64 alpha.3 wheel (comparison-only, not a production input) covers version, SDK lifecycle, ACP
initialize/new/list/close/resume, Cindy-controlled prompt, session/update follow, running-turn cancellation and
the constrained terminal result. The F0 handoff remains incomplete until Cindy CI produces and attests the fixed
source-built release on every declared platform; an upstream wheel-to-source signature is no longer the required
trust mechanism. Durable binding/receipt persistence, control-plane EOF/exit recovery across a process restart and
no-uncertain-prompt-replay are open F3 requirements; they prevent product registration but must not be used as an
F0 PASS precondition because F3 depends on F1 and F2. F0 only proves a fail-closed in-memory
`needs-reconcile` boundary after carrier EOF/exit. Later phases must not infer the F3 work as complete.

The repository testing-profile file is absent as of this planning pass. If one is introduced before delivery, its
more specific requirements must be added to every affected issue before implementation begins.
