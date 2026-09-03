# DSH Cindy 控制面接入 Issue Map

Status: published historical map; active execution revised for local fork-only development
Requirements: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
Technical spec: docs/issues/dsh-native-integration/dsh-native-integration-technical-spec.md
Development plan: docs/issues/dsh-native-integration/dsh-native-integration-development-plan.md
Validation plan: docs/issues/dsh-native-integration/dsh-native-integration-validation-plan.md
Repository: historical publication `makecindy/cindy`; active code remote is the user's `origin` fork only
Publication authorization: historical user authorization applied on 2026-09-02; no current upstream issue mutation
Canonical-document notice: these repository-relative paths become clickable GitHub links when the planning documents
are included in their documentation PR; issue bodies retain the paths as the canonical source before that merge.

## Scope Adjustment — Local Fork-Only Development (2026-09-03)

This map records already-published upstream issue numbers for traceability only. The user now authorizes only local
`darwin-arm64` Desktop development/build/validation and code pushes to the user's `origin` fork. Do not update,
comment on, create, close or link any upstream issue/PR; do not trigger a remote build, GitHub Actions, artifact
upload, attestation, distribution or non-macOS build. F8–F11 are deferred design, not executable current work.

## Active Local Execution Status

F0 and F1 are complete only for their documented local Desktop boundaries. F1 retains `dsh` through maker-core,
model-provider type boundaries and Desktop persistence/IPC/renderer paths, rejects present unknown identity values,
and leaves DSH unregistered and unavailable for execution. It made no Mobile, device-link, SSH, remote-build or
release change. Evidence: [`dsh-f1-local-identity-closure-report.md`](../../dsh-release-evidence/dsh-f1-local-identity-closure-report.md).

The historical issue bodies below are planning snapshots. Their upstream numbers are references, not commands to
write to `makecindy/cindy`; this local document is the only execution-status record being updated.

## Parent Issue Draft

Title: feat(dsh): deliver Cindy-owned DSH control plane

Requested label: enhancement
Published labels: none — the authenticated GitHub identity lacks AddLabelsToLabelable permission.

Body:

## 背景

DSH 需要作为 Cindy 的第四个 Agent harness 完整接入。完整含义是 Cindy 自己拥有经准入 release
的 task/session、tool approval、activity、extension、remote 与多端控制面，而不是创建一个可发文字的
兼容壳。完整路径的前置是 F0 Cindy Bridge Gate；Gate 未通过时，后续完整实现不开始。

## 总目标

按 F0–F11 交付可审计、可回滚的 Cindy-owned DSH integration，同时保持 Claude Code、Codex、Pi 和
用户现有数据不退化。所有暴露能力以真实 runtime evidence 和 Cindy-side contract 为准。

## 文档来源

- Requirements: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
- Technical spec: docs/issues/dsh-native-integration/dsh-native-integration-technical-spec.md
- Development plan: docs/issues/dsh-native-integration/dsh-native-integration-development-plan.md
- Validation plan: docs/issues/dsh-native-integration/dsh-native-integration-validation-plan.md

## 成功标准

- F0 对同一官方制品证明公开 ACP v1 加 Cindy bridge 能完成 create/resume（若 advertise）/
  follow/prompt/cancel/close。
- dsh 在所有已触及的 identity、DB、IPC、Desktop、SSH、device-link 与 Mobile 边界均不静默
  回退为其它 Agent。
- runtime state、secret、remote location、extension 与 Orca provenance 的红线按验证计划通过。
- F11 的独立发布证据和维护者批准之前，不称为“完整 DSH”。

## 子 Issue

按本 map 的 F0–F11 依赖图创建。每一子 issue 只能以 one focused PR 交付；不得合并跨阶段的
未验证高级能力。

## 范围限制

不修改 DSH 上游/服务端仓；不新增 Cindy system prompt；不以私有 state/log scraping、PATH
fallback、Web UI 或不受控 ACP client 绕过 Cindy Bridge Gate。

## 依赖

Blocked by:
- none

Blocks:
- F0–F11 子 issue（以发布后的真实 issue number 回填）

## Remote Publication

Parent remote number: 3770
Parent remote URL: https://github.com/makecindy/cindy/issues/3770

## Child Issue Drafts

### F0 — DSH: prove the Cindy-owned bridge gate

Purpose: 证明一个同一版本的 Cindy source-built runtime、binary、公开 ACP v1 与 Cindy bridge 核心 operation
可被真实运行、审计和重跑地绑定。

Deliverables:
- secret-free release evidence packet, redacted fixtures and verifier;
- source tag→commit→tree/upstream-lockfile/Cindy-pkg-toolchain/build-script verification, local macOS
  archive/hash/sidecar/tree manifest/platform/license; no provenance or release claim;
- real binary ACP handshake plus create/prompt/follow/history/cancel/close/resume/exit evidence;
- Cindy bridge scope/session ownership, receipt, ordered follow routing, fail-closed EOF/exit and reconcile evidence;
- local macOS POSIX ordinary-descendant process-group teardown evidence, including root-first exit; it is not
  product containment or an assertion about another platform. Product launch/supervisor work remains deferred;
- PASS/FAIL/INCOMPLETE gate record.

Acceptance:
- 公共、版本化的 ACP 加 Cindy bridge 覆盖所有核心操作；私有 JSONL/DB/未公开 endpoint/source-only
  class 不构成通过。
- F1 cannot begin without a maintainer-approved PASS; failed or incomplete result blocks complete integration.

Tests and audit:
- schema/hash/manifest/redaction negative cases and local `darwin-arm64` real-binary integration only;
- audit for secret leakage, mutable-version inference, non-reproducible source-build overclaim and ACP/Web/private-state workaround.

Scope and authorization:
- F0-only unregistered bridge/evidence implementation is allowed: ACP framing/client, Desktop Main control-plane
  core, bounded test fixtures and release verifier; no production runtime registration, no `dsh` AgentKind,
  source-prompt change or external service change.
- read DSH/environment/desktop/credentials rules before implementation.

Dependency: blocked by none; blocks F1.
Remote number: 3771

### F1 — DSH: close the fourth-Agent identity across all boundaries

Local status: **completed for local Desktop identity preservation only**. The historical deliverables below remain
the full future issue scope; Mobile, device-link, SSH and release work are deferred and were not implied complete.

Purpose: add dsh as a fourth identity while retaining unavailable-by-default behavior.

Deliverables:
- exhaustive inventory of every closed agent-kind union/schema/serializer/decoder/selector;
- typed dsh paths or explicit unavailable/fail-closed result across core, shared, Main, preload, renderer,
  device-link, Mobile, scheduler/search/remote;
- inventory guard and legacy regression fixtures.

Acceptance:
- a dsh value remains dsh across all covered routes; unknown or invalid value never becomes cc/codex/pi;
- list/create availability stays controlled by future F2 handshake, not by type presence.

Tests and audit:
- exhaustive typed tests, unknown decode, cc/codex/pi persistence/search/scheduler/Mobile regressions;
- audit every inventory item and stale three-value union.

Scope and authorization:
- no DSH process, binding, UI capability or system-prompt work.
- read DSH/maker-core/architecture/protocol/remote-mobile/i18n rules.

Dependency: blocked by F0; blocks F2.
Remote number: 3772

### F2 — DSH: supply-chain-verified runtime and scoped bridge supervisor

Purpose: safely provision the DSH directory runtime and operate local Cindy DSH scopes in Desktop Main.

Deliverables:
- tools/dsh reviewed-pin updater with dual hash/tree-manifest/sidecar validation;
- optional agent-binaries dsh asset and platform registration from F0 only;
- Main-only DshHostManager, managed Home, non-project launcher cwd, env allowlist, health and teardown.

Acceptance:
- unsupported/missing/corrupt runtime is scoped unavailable; no PATH/npm/pnpm/pip/curl/system Node fallback;
- Renderer/Mobile cannot access executable, Home, endpoint or secret; failed scope cannot impair other Agents.

Tests and audit:
- asset integrity/extraction/platform tests, real binary version/handshake/close and process/env/redaction/
  account-switch/orphan tests;
- security audit for Electron boundary, files, credentials and logs.

Scope and authorization:
- do not create DSH session binding or user extension UI.
- read DSH/Electron/credentials/storage/config/log/architecture rules.

Dependency: blocked by F1; blocks F3.
Remote number: 3773

### F3 — DSH: bridge ACP sessions to durable Cindy bindings

Purpose: create/resume/follow ACP sessions via a narrow Cindy-owned port and persist only safe identity/cursor state.

Deliverables:
- maker-core DshAgent and typed DshBridgePort; Main-owned bridge client;
- append-only dsh_session_bindings migration/repository/mapper;
- receipt correlation, follow-before-history projection, sequence dedupe and needs-reconcile behavior.

Acceptance:
- one runtime session has one bridge owner; no raw log scraping, token/endpoint/profile persistence or blind replay;
- multi-account/scope/session isolation and restart recovery are proven, otherwise state is explicitly reconcile.

Tests and audit:
- migration replay/legacy regression/collision/corruption; real bridge multi-scope lifecycle and uncertainty cases;
- DB/IPC/security audit and historical-migration immutability check.

Scope and authorization:
- no advanced activity panels, mobile commands, remote fallback or system prompt change.
- read DSH/maker-core/database/Electron/credentials/protocol/remote-mobile/architecture rules.

Dependency: blocked by F2; blocks F4.
Remote number: 3774

### F4 — DSH: translate ACP events and one-shot interactions safely

Purpose: make the event, capability and permission contracts safe before any rich product surface opens.

Deliverables:
- versioned DshBridgeEnvelope, capability snapshot and finite cindy-dsh activity contract;
- semantic mapping for supported core events; deterministic unknown/reconcile handling;
- toolCallId one-shot interaction resolver with timeout/disconnect fail closed behavior.

Acceptance:
- unknown/malformed/stale/duplicate/cross-session events cannot produce done/text/tool_result or an approval;
- only F0-proven and Cindy-tested capabilities become supported.

Tests and audit:
- real and malformed event fixtures, ordering/EOF/child-exit/backpressure cases, permission association suite;
- no raw native payload or secret crosses Renderer/Mobile boundary.

Scope and authorization:
- no system prompt, arbitrary vendor JSON IPC or advanced UI implementation.
- read DSH/maker-core/Electron/credentials/log/protocol rules.

Dependency: blocked by F3; blocks F5.
Remote number: 3775

### F5 — DSH: deliver the capability-gated Desktop core task flow

Purpose: let Desktop users safely create, continue, observe, approve, cancel and recover basic DSH tasks.

Deliverables:
- selector/availability, create/resume, capability/model/effort/attachment gates, timeline, approval/cancel/
  unavailable/reconcile presentation;
- named schema-validated Main/preload actions and all locale/theme treatment.

Acceptance:
- a real local DSH task can complete/recover without leaking Home/endpoint/token/profile/raw event;
- unsupported capability/action has an accurate user-visible reason; UI does not claim full DSH prematurely.

Tests and audit:
- preloader/renderer/session/capability/attachment/recovery tests, real create-to-resume smoke, i18n/glossary;
- Light/Dark check where runnable and explicit missing evidence otherwise.

Scope and authorization:
- no Cindy activity panel, user extension mutation, SSH or Mobile protocol release.
- read DSH/design/governance/glossary/product/Electron/media/remote-mobile rules.

Dependency: blocked by F4; blocks F6 and F7.
Remote number: 3776

### F6 — DSH: add Cindy-owned activity panels and controlled terminal lifecycle

Purpose: expose Cindy-owned plan/todo, interactions, terminal and task/job/workflow/schedule activity without conflating
them with text, tool output or Orca.

Deliverables:
- versioned activity reducers/panels and named observe/control actions;
- owner-scoped terminal attach/input/signal/close and native object cancel/reconnect semantics.

Acceptance:
- every shipped object/action has stable identity, capability, owner check, cancel/disconnect/recovery behavior;
- no cindy-dsh activity record enters Orca storage/worker UI or claims native provenance.

Tests and audit:
- lifecycle, stale/foreign owner, terminal race, reconnect/restart limitation and raw-payload rejection tests;
- UI/IPC security and DSH-origin audit.

Scope and authorization:
- do not implement DSH plugins/MCP settings, remote runtime or device-link expansion.
- read DSH/design/maker-core/Electron/credentials/config rules.

Dependency: blocked by F5; blocks F8.
Remote number: 3778

### F7 — DSH: preserve native MCP, skills, profiles and extension recovery

Purpose: expose explicit native configuration/recovery while keeping Cindy internal MCP separately authorized.

Deliverables:
- cindy-managed/existing-dsh-home mode projection and recoverable switch;
- Main-only internal MCP factory with allowlist/token/lease/generation/account cleanup;
- native profile/skill/plugin/extension action projection preserving DSH self-repair semantics.

Acceptance:
- no credential copying or permanent safety-based lockout of an explicit native operation;
- internal MCP cannot assume native configuration authority, and failure preserves recoverable state.

Tests and audit:
- Home isolation, MCP source/lease/secret/remote cases, interrupted update/recovery tests;
- plugin/credential/configuration compatibility audit.

Scope and authorization:
- no Cindy plugin-base contract alteration and no arbitrary Renderer command/endpoint.
- read DSH/plugin-security/credentials/config/Electron/protocol/remote/design/i18n rules.

Dependency: blocked by F5; blocks F8.
Remote number: 3777

### F8 — DSH: execute complete Host scopes on SSH remotes

Purpose: make remote DSH genuinely remote for runtime, Home, files, terminal, MCP and recovery.

Deliverables:
- remote installer/probe/manifest, remote Home/Host, authenticated loopback forward and scoped teardown;
- remote semantic adapters and one-scope reconnect/reconcile behavior.

Acceptance:
- no local fallback for remote workdir/path/credential; remote failure is isolated to that host scope;
- uncertain remote request is reconciled, not replayed or replaced with a new session.

Tests and audit:
- real remote install/Host/session/terminal, forward loss/recovery and local/two-remote/mobile failure-radius matrix;
- remote credential/path/endpoint ownership audit.

Scope and authorization:
- no Mobile control UI or Orca interop; no remote Home deletion.
- read DSH/remote-mobile/protocol/credentials/media/Electron/config/architecture rules.

Dependency: blocked by F6 and F7; blocks F9.
Remote number: 3779

### F9 — DSH: make device-link and Mobile task continuity explicit

Purpose: let Mobile control the same Desktop-hosted DSH task with safe version-skew behavior.

Deliverables:
- append-only dsh shared/device-link payloads and Desktop validator/allowlist;
- Mobile view/continue/input-condition/approval/stop/queue/read-only activity experience;
- old/new Desktop and Mobile compatibility state plus two-peer behavior.

Acceptance:
- Mobile never receives controller endpoint/token/profile/secret and never creates a substitute session;
- unsupported operations say why/where to continue; one peer loss does not disrupt another or the native session.

Tests and audit:
- four-version matrix, two-peer disconnect, sender/owner validation and no-secret projection tests;
- cold-update approval if and only if native mobile fingerprint inputs must change.

Scope and authorization:
- no direct mobile-to-DSH connection and no unapproved cold update.
- read DSH/mobile/remote-mobile/protocol/design/glossary/media rules.

Dependency: blocked by F8; blocks F10.
Remote number: 3780

### F10 — DSH: define explicit Orca interoperability without identity collapse

Purpose: permit only proven DSH-to-Orca cooperation while retaining distinct native and Orca origins.

Deliverables:
- explicit DSH-as-Orca policy, provenance, budget/permission/concurrency/result/stop/recovery contracts;
- DB/UI/audit handling that keeps `cindy-dsh` child/task/job separate from Orca workers.

Acceptance:
- every consumer can identify origin and authority; unsupported nested combinations reject visibly;
- existing Claude/Codex/Pi Orca flows do not regress.

Tests and audit:
- native-versus-Orca identity/control/recovery, nested policy, budget/permission and remote/Mobile projections;
- independent Orca architecture and cross-agent regression audit.

Scope and authorization:
- no coercion of a native DSH object into orca_teams/orca_workers.
- read DSH/Orca/maker-core/protocol/remote-mobile/credentials/design/i18n rules.

Dependency: blocked by F9; blocks F11.
Remote number: 3781

### F11 — DSH: govern release, upgrade and complete-availability claim

Purpose: provide repeatable release, upgrade and adversarial review evidence for every promoted DSH release.

Deliverables:
- platform runners, F0 refresh/capability diff, release fixtures, upgrade/rollback ledger, diagnostics/support runbook;
- final update path for dsh-harness.md only after all evidence and approval.

Acceptance:
- exact promoted release has matrix evidence for local supported platforms, SSH, device-link/Mobile and old state
  preservation/reversible block;
- maintainer approval and zero unresolved P0/P1 redlines precede any “complete DSH” status claim.

Tests and audit:
- packet rebuild/negative integrity/controller diff, pnpm test:all, supported runner and upgrade/rollback suites;
- independent P0/P1 review: secret leak, scope mix-up, lost native state, unsafe fallback, remote misexecution,
  extension regression.

Scope and authorization:
- no production rollout, push, merge or status-claim change without explicit release authority.
- read DSH/development-workflow/desktop/mobile/updater-if-touched/log/credentials/protocol rules.

Dependency: blocked by F10.
Remote number: 3782

## Delivery Order

1. F0 must finish and pass the Cindy Bridge Gate.
2. F1 → F2 → F3 → F4 establish identity, runtime, bindings and event safety.
3. F5 enables Desktop core; F6 and F7 may then proceed as separate focused PRs.
4. F8 requires both F6 and F7; F9 requires F8; F10 requires F9; F11 is the release closure.
5. A blocked predecessor freezes dependent issue implementation; the child issue must link the exact gate evidence.

## Publication Verification Checklist

After remote creation, verify every issue title/body/label, parent link, real-number Blocked by/Blocks references,
no assignees unless explicitly chosen, and the required final PR close policy:

Final delivery PR fully resolves this issue and must use Closes #<issue-number> in the PR body so GitHub
auto-closes it after merge.

## Publication Constraints

- The authenticated identity created all 13 issues and their textual parent/dependency references, but GitHub
  rejected native sub-issue mutation with AddSubIssue permission denial. The verified #3770 parent-program
  reference and each real-number Blocked by/Blocks chain are the current traceability mechanism.
- GitHub also rejected enhancement label mutation with AddLabelsToLabelable permission denial. All issues
  intentionally remain unlabeled; no label is claimed as applied.

## Final Remote Map

Published and read back on 2026-09-02. After the user confirmed Cindy-owned control plane architecture, the
parent and all F0–F11 issue titles/bodies were updated through authorized `gh issue edit`; #3770, #3774, #3778
and #3782 were then read back for independent remote verification. Issue numbers and dependency order remain the
canonical traceability anchors.

| Draft ID | Title | Remote issue | Blocks |
|---|---|---|---|
| Parent | feat(dsh): deliver Cindy-owned DSH control plane | [#3770](https://github.com/makecindy/cindy/issues/3770) | F0–F11 |
| F0 | DSH: prove the Cindy-owned bridge gate | [#3771](https://github.com/makecindy/cindy/issues/3771) | F1 |
| F1 | DSH: close the fourth-Agent identity across all boundaries | [#3772](https://github.com/makecindy/cindy/issues/3772) | F2 |
| F2 | DSH: supply-chain-verified runtime and scoped bridge supervisor | [#3773](https://github.com/makecindy/cindy/issues/3773) | F3 |
| F3 | DSH: bridge ACP sessions to durable Cindy bindings | [#3774](https://github.com/makecindy/cindy/issues/3774) | F4 |
| F4 | DSH: translate ACP events and one-shot interactions safely | [#3775](https://github.com/makecindy/cindy/issues/3775) | F5 |
| F5 | DSH: deliver the capability-gated Desktop core task flow | [#3776](https://github.com/makecindy/cindy/issues/3776) | F6, F7 |
| F6 | DSH: add Cindy-owned activity panels and controlled terminal lifecycle | [#3778](https://github.com/makecindy/cindy/issues/3778) | F8 |
| F7 | DSH: preserve native MCP, skills, profiles and extension recovery | [#3777](https://github.com/makecindy/cindy/issues/3777) | F8 |
| F8 | DSH: execute complete Host scopes on SSH remotes | [#3779](https://github.com/makecindy/cindy/issues/3779) | F9 |
| F9 | DSH: make device-link and Mobile task continuity explicit | [#3780](https://github.com/makecindy/cindy/issues/3780) | F10 |
| F10 | DSH: define explicit Orca interoperability without identity collapse | [#3781](https://github.com/makecindy/cindy/issues/3781) | F11 |
| F11 | DSH: govern release, upgrade and complete-availability claim | [#3782](https://github.com/makecindy/cindy/issues/3782) | none |
