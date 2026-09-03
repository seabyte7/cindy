# DSH Cindy 控制面接入 Development Plan

Status: confirmed
Requirements: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
Technical spec: docs/issues/dsh-native-integration/dsh-native-integration-technical-spec.md
Artifact: docs/issues/dsh-native-integration/dsh-native-integration-development-plan.md

## Scope Adjustment — Local Fork-Only Development (2026-09-03)

Active delivery is local macOS arm64 Desktop work only. It may verify the pinned source locally, build one
`darwin-arm64` archive locally, and run its local smoke/real-binary E2E. It must not build another target, use a
remote runner or GitHub Actions, upload/attest/distribute a runtime, or write to `upstream`. Any code push goes
only to the user's `origin` fork. The F8–F11 branches below are deferred architecture; do not start them, or any
SSH/Mobile/release work, without a new explicit user authorization. Existing GitHub issue numbers remain a
historical local index and must not be updated.

## Delivery Model

- 一个阶段对应一个 GitHub child issue、one focused PR、一次独立审计和可回滚交付。
- 每个实现者先重新读取 docs/dev-rules/dsh-harness.md，并在开始改动前读取本阶段列出的专项规则；
  本计划列的是最低集，不替代命中路径的嵌套 AGENTS.md。
- F0 是硬门。F0 未通过或证据失效时，F1–F11 不得把 dsh 注册为可用，不得以 mock、私有文件、
  Web UI 或不受控 ACP client 绕过。上游缺少另一套 Host API 不是 F0 失败条件。
- 对未知 agent、能力、API 版本、event、scope、session、action 或 permission 关联，一律
  fail closed；不得以默认 provider、重试副作用 prompt 或推测状态“修复”不确定性。
- 每个 PR 都先在干净、隔离的工作目录中核对 current branch、worktree 和用户改动；不修改服务端
  仓，不把密钥或 runtime 制品提交进 Git。
- 所有代码 PR 的最低门禁为 pnpm test:unit:related、每个受影响 package 的 if-present typecheck、
  pnpm check:dco、git diff --check。文档-only PR 至少跑 pnpm check:dev-docs 与 git diff --check。
  追加测试以各阶段为准。

## Dependency Graph

    F0 Cindy Bridge Gate
       |
      F1 Identity closure
       |
      F2 Runtime and host supervisor
       |
      F3 Cindy bridge and binding
       |
      F4 Event and interaction contract
       |
      F5 Desktop core experience
      /  \
    F6    F7 Native extensions
    activity   |
      |       |
      +---+---+
          |
       F8 SSH remote (deferred)
          |
       F9 device-link and Mobile (deferred)
          |
       F10 Orca boundary (deferred)
          |
       F11 release governance (deferred)

F6 与 F7 可在 F5 后并行，但共用的 contract 只允许 F4/F5 已发布的稳定版本。F8 开始前必须拿到
F6 的 session/activity ownership 规则；F9 不得在 F8 之前假定远端控制语义；F10 只消费稳定的
`cindy-dsh` provenance。F11 要等 F0–F10 的目标能力均有可复现证据。

## Phase 0: Cindy Bridge Gate

Goal: 用真实、受管的同一 DSH release 判定 Cindy-owned control plane 是否可进入产品代码。

Scope:
- 建立 release evidence packet schema、redacted fixtures、verification runner 和审阅清单。
- 在本机干净 checkout 复核 source tag→commit→tree、上游 lockfile/Cindy pnpm/package-toolchain
  lock/integrity/build-script digest；若上游 parser 阻止 release definition 的精确 Node target，只能在
  输入验证后应用 patch SHA-256 与逐文件 preimage/postimage 固定的最小 Cindy adaptation，并在 install 后、
  build 前复验；Node 自带 npm 仅以 `--ignore-scripts` 获取并验证 SRI 固定的 pnpm tarball，禁止
  Corepack/runner-global pnpm 回退；以该 pnpm 的 frozen install 仅构建 `darwin-arm64` archive，并记录本地
  hash、size、license/notices、可执行及 sidecar/tree manifest。上游 wheel 仅作对照，不是 production input，
  且本地记录不是 provenance 或发行声明。
- 以空 cindy-managed DSH_HOME 与非项目 launcher cwd 启动实际可执行文件；POSIX 在专用 process group
  中验证 version、
  ACP protocol/capabilities、create/close/list/reconcile/resume（若 advertise）、prompt/follow/
  cancel、EOF/SIGTERM 与异常退出。active session 不得被错误地当成 list 缺失或可 resume；close
  后才可通过 list/reconcile 发现并恢复 binding。
- 实现并验证 Cindy `DshBridgePort` 的 session owner、command receipt、sequence、EOF/exit、
  operation timeout 与 `needs-reconcile` contract：所有可能已到达 runtime 的超时均关闭 carrier、
  保留既有 binding 并禁止重发；真实 transport 只由该 port 使用。
- 把 child 回收当作整棵运行时树而非 direct child：F0 的本机 macOS POSIX launch 创建独立进程组且
  TERM/KILL 作用于整组，并覆盖 root 先退出的同组后代；这不能阻止 `setsid` / double-fork，也不构成
  产品 containment 或其它 OS 证据。F2 的任何产品 launch/supervisor 设计均 deferred，未经新授权不得
  以 process-group best-effort 宣称完成。
- 保存正例和负例：错误 hash、缺 sidecar、未知 API version、无 controller、无认证、stdout
  杂讯、乱序/重复 event、cancel/reconnect。

Changes:
- 增加仅包含脱敏元数据的证据目录和确定性验证脚本；不得提交 runtime、token、profile、用户
  session 数据、完整诊断或密钥。
- 明确定义 PASS、FAIL、INCOMPLETE。PASS 需要受管 Cindy source-built runtime 上公开、版本化 ACP 组合 Cindy
  bridge 覆盖全部核心操作；FAIL/INCOMPLETE 产生不可用诊断而非产品注册。
- 把 F0 证据 review 作为 F1 的 required input；版本升级重新运行，旧 packet 不能自动继承。

Required rules:
- dsh-harness.md、environment-setup.md、desktop-development.md、credentials-and-local-storage.md、
  media-storage-and-protocols.md（如 fixture 含附件）、engineering-conventions.md。

Tests:
- fixture schema parser、hash/tree-manifest validator、redaction scan。
- 真实 binary integration，不用 in-memory mock 替代。
- 本机 `darwin-arm64` 的 version/handshake/close smoke 和 Desktop Main real-binary E2E；不得产出、
  代跑或暗示 Linux/Windows/Intel macOS 结果。

Acceptance:
- 一份可重跑、可审计、无 secret 的 local packet 把 source objects、本地 archive、binary、ACP capability
  与 Cindy bridge operations 绑定为同一 `darwin-arm64` 开发输入；它不是 attestation 或 release。
- Cindy Bridge Gate 的 PASS/FAIL 由维护者基于 packet 记录；没有 PASS 不创建任何可用 DSH runtime。

Rollback:
- 删除临时 staging 与测试 Home；保留无 secret 的证据记录和失败原因。没有生产状态需要迁移。

## Phase 1: Agent Identity Closure

Status: **completed for the active local Desktop boundary**. Evidence: [`dsh-f1-local-identity-closure-report.md`](../../dsh-release-evidence/dsh-f1-local-identity-closure-report.md).

Goal: 把 dsh 作为第四个 AgentKind 建成全仓封闭、可审计的身份，而不启用 runtime 或 UI 能力。

Scope:
- 从 maker-core 的 AgentKind 开始，列出所有 agent-kind union、enum、schema、serializer、
  database decoder、IPC/preload method、renderer selector、model catalog、scheduler/search、
  process monitor、remote SSH、device-link、Mobile reducer 与测试 fixture。
- 为每一项选择显式 dsh 分支、display mapping、not-implemented state 或 fail-closed decoder；
  禁止 default/else 落入 claude-code、codex 或 pi。
- 建立机器可检查 inventory（路径、owner、行为、测试），使后续新增闭合点会失败而非漏改。
- 只注册 identity；listAvailableAgents 仍必须由 F2 handshake 控制，不能因类型存在而可创建。

Changes:
- 更新 maker-core/shared identity 类型与 Desktop Main、preload、renderer 的有界联合、显示与存量 decoder。
- 为 session reference、历史、搜索、scheduler、remote route、agent switch 与 provider lookup
  写出 dsh 的显式行为；无对应产品合同的入口返回 not-implemented。

Required rules:
- dsh-harness.md、maker-core-and-agent-behavior.md、architecture-invariants.md、
  protocol-compatibility.md、remote-and-mobile-adaptation.md、engineering-conventions.md、
  task-and-conversation-naming.md；涉及文案时还要 DESIGN.md 与 i18n/GLOSSARY.md。

Tests:
- AgentKind conversion/unknown rejection、Maker unregistered failure、DB decoder、session creation/Orca
  worker rejection、catalog route rejection和 renderer roster/glyph/state regression 已在本机通过。
- 未修改 Mobile、SSH 或 device-link protocol，故不把它们列为 F1 验收；这些仍是后续明确授权的
  设计项。
- source scan 只作辅助，真正断言以 typed exhaustive fixtures 和 runtime validators 为准。

Acceptance:
- 已触及的本机 Desktop DB/IPC/renderer 路径保留 dsh 身份；不支持位置返回原因或不形成 route。
- 任意 unknown agent kind、旧 payload 或错误映射均被拒绝或标为 compatibility state，不变成 cc。

Rollback:
- 此阶段只增加类型/保护分支且 dsh 不可用；回滚不影响既有三种 kind 的已存数据。

## Phase 2: Managed Runtime and Host Supervisor

Status: **in progress — local admission and Main-only scope foundation delivered; no product registration.**

Goal: 在 Desktop Main 建立可验证、可隔离、失败不影响其他 Agent 的 DSH runtime 与 Host scope。

Scope:
- 新增 `tools/dsh/latest.json`、offline-only `update.mjs` 和 testable extraction validator。当前只接受
  已通过 F0 bundle verifier 的调用方显式本地 archive；不做 CDN schema、下载、发布或其它平台输入。
- 在 containment-proven launcher 可用前，不接入现有 CDN `agent-binaries`；未来 optional dsh directory
  asset 只能指向该 local pin，未发布平台永不注册。
- 新增 Main dsh-host boundary：scope key、Home resolver、launcher cwd、credential env builder、
  child process supervisor、health probe、bounded stderr、quit/account-switch teardown 和 process monitor。
- 实现 cindy-managed Home；existing-dsh-home 的显式选择只保存 non-secret override，暂不开放
  F7 的 extensions UI。
- host 启动只完成 handshake/capability snapshot；失败结果经 capabilities/status 暴露，不阻塞 app。

Delivered local foundation:

- `dsh-host/local-runtime.ts` fixes the sole local archive, rejects symlink/special/traversal/unexpected entries,
  verifies hash/tree before extraction and after same-volume promotion, and rechecks the actual executable/sidecars
  by realpath/mode/digest before a future spawn.
- `dsh-host/scope.ts` and `host-manager.ts` own hashed account/release/home-mode scope identity, managed Home,
  isolated launcher cwd, allowlisted memory-only secret injection, single-flight handshake and bounded cleanup
  ownership. `DshHostManager` has no default child launcher: an unproven process group cannot satisfy containment.
- The opt-in real-binary integration test installs the fresh F0 archive and runs Desktop Main ACP
  initialize/create/close from that installed path. It remains a local evidence test, not product registration.

Remaining F2 exit blockers:

- Implement and run an identity-bound macOS native containment launcher against the installed DSH runtime. The
  no-network Seatbelt experiment is a negative result, not a fallback: shell → `sandbox-exec` → DSH `--version`
  succeeded, but the same installed runtime launched through Node/Desktop Main `spawn()` exited `SIGABRT` before
  ACP initialize, with both detached and attached variants. The experiment was removed; no Seatbelt adapter ships.
  A future launcher must prove ACP initialize/create/close and real process-tree teardown from the Desktop process.
- Wire an optional local asset/status into Desktop bootstrap only after that containment evidence exists. Do not
  add a remote distribution path as a substitute.

Changes:
- 对 archive 与解包做双重 hash + tree manifest 验证，并拒绝 traversal、symlink、special file、
  unexpected entry、缺 main executable/sidecar 和 mutable-source fallback。
- 环境以 allowlist 构建；credential store 注入短期变量名和值，禁止 process.env 扩散、argv、
  disk/profile/DB/log 记录。
- 实现 lazy start、scope registry、stale endpoint 清理、quiesce/flush/close/TERM/KILL 时序及
  orphan detection。

Required rules:
- dsh-harness.md、electron-security-and-process-boundaries.md、
  credentials-and-local-storage.md、media-storage-and-protocols.md、
  configuration-and-overrides.md、log-upload-and-redaction.md、
  architecture-invariants.md、desktop-development.md、engineering-conventions.md。

Tests:
- pin/url/hash/size/tree/sidecar、unsupported platform、corrupt archive、optional asset failure。
- child env allowlist、secret redaction、non-project cwd、Home isolation、account switch、crash/stale
  endpoint/quit cleanup、no PATH/npm/pip/node fallback。
- real-binary version/handshake/close integration using F0 fixture release.

Acceptance:
- renderer has no process/binary/Home/secret capability; one bad dsh scope cannot affect Cindy startup or other
  Agent sessions.
- every supported platform follows an actual F0-backed manifest; missing asset is a safe unavailable state.

Rollback:
- disable dsh optional asset/registration and terminate only DSH child scopes; do not alter user existing home
  or existing Agent runtime assets.

## Phase 3: Cindy Bridge and Durable Binding

Goal: 创建和恢复 ACP DSH session，同时建立可靠的 DSH-to-Cindy identity 与 projection cursor。

Scope:
- 在 maker-core 新增 DshAgent、DshBridgePort、typed command/receipt/envelope contracts；Desktop Main
  实现 owned stdio/SSH-forward bridge client。
- 新增 append-only dsh_session_bindings schema、migration、mapper/repository 和 projection service。
- 实现 create/resume/follow/history/close；每个 request 有 Cindy request id、scope、ACP capability
  fingerprint 与 opaque runtime session id。
- 只在 bridge create receipt 成功后写 binding；会话不因 renderer/mobile disconnect 被删除。

Changes:
- binding 列及 indexes 遵循 technical spec；runtime id、token、endpoint/profile/raw log 的存储
  均不允许。
- projection 顺序为 follow then paged history then dedupe by sequence；gap/unknown receipt 进入
  needs-reconcile，禁止 blind retry。
- delete/fork/resume 行为仅当 F0 ACP/Cindy bridge capability 已证实；未证实即明确拒绝。

Required rules:
- dsh-harness.md、maker-core-and-agent-behavior.md、database-and-migrations.md、
  electron-security-and-process-boundaries.md、credentials-and-local-storage.md、
  protocol-compatibility.md、remote-and-mobile-adaptation.md、architecture-invariants.md、
  development-workflow.md。

Tests:
- migration replay、old cc/codex/pi rows、new dsh binding uniqueness、corrupt binding、upgrade/rollback。
- multi-account/multi-scope/multi-session isolation、same session double controller rejection。
- crash/reconnect/history gap/receipt ambiguity/no duplicate prompt integration cases.

Acceptance:
- process restart can resume only when all runtime/cursor evidence agrees; uncertainty is visible and non-mutating.
- no raw-log scraping and no fallback to another Agent.

Rollback:
- new migration remains compatible; unregister DshAgent and preserve binding rows for future reconcile rather
  than rewriting legacy data.

## Phase 4: Event and Interaction Contract

Goal: 将真实 ACP event 与一次性 interaction 无损映射为安全、有限的 Cindy contracts。

Scope:
- 定义 schema-versioned DshBridgeEnvelope、capability snapshot、`cindy-dsh` activity reference/snapshot、
  allowed action and reducer transitions。
- 映射精确等价的 text/thought/tool/usage/status/error/done；将 Cindy-owned plan/job/terminal/
  extension state 限制在 `cindy-dsh` activity contract。
- 实现 toolCallId interaction correlation、allow-once/reject-once/timeout/connection-loss handling、
  sequence ordering、dedupe、bounded backpressure 和 error surfaces。
- 在本阶段不开放高级 UI；只交付 core events、safe interaction resolver 与 feature flags/capability
  states。

Changes:
- 对 unknown event, enum, required field, stale sequence, duplicated terminal, cross-session toolCallId
  和 API mismatch 写明确处理：记录 bounded diagnostic、停用动作、状态进入 unsupported/reconcile；
  不生成 done/text/tool_result。
- usage/accounting 只从 ACP/Cindy bridge 的 verified fields 落入既有数据模型；缺字段不得猜测成本。
- 不改 Cindy system prompt 或以 prompt 修补 runtime event 的结构。

Required rules:
- dsh-harness.md、maker-core-and-agent-behavior.md、electron-security-and-process-boundaries.md、
  credentials-and-local-storage.md、log-upload-and-redaction.md、protocol-compatibility.md、
  engineering-conventions.md。

Tests:
- F0 real event fixtures plus malformed/missing/unknown/ordered/out-of-order/duplicate/EOF/child-exit cases。
- permission association complete/missing/stale/foreign/timeout/deny; confirm kind-independent handling.
- event performance/bounds and no-secret/no-raw-payload renderer/device-link tests.

Acceptance:
- a real DSH turn reaches committed Cindy state correctly; unsafe ambiguity cannot approve a tool or finish a turn.
- all enabled capabilities have an evidence-backed status; not-implemented is visible to consumers.

Rollback:
- capability-gate all dsh actions unavailable while preserving sequence/binding data; do not coerce buffered
  events into legacy provider formats.

## Phase 5: Desktop Core Experience

Goal: Desktop 用户可创建、继续、理解并安全控制基础 DSH 任务。

Scope:
- 接入 availability/agent selector、create/resume, model/effort capability display、attachment gate、
  history, text/thought/tool/usage timeline, approval card, cancel, unavailable/disconnect/reconcile UI。
- 增加最小、named IPC/preload methods and validators; Main repeats sender/session/scope/capability checks.
- 实现五 locale、Light/Dark semantic token style、accessibility/loading/error states and neutral branding
  until verified DeepSeek asset permission exists.

Changes:
- UI only receives display-safe capability/activity/interaction data and opaque ids. It never receives DSH_HOME,
  controller URL/token, profile path, arbitrary command or raw event.
- Model/provider change only exposes F0/F4-verifiable options and records the next-turn effect boundary.
- attachments enter only through existing approved Cindy input/grant pipeline; unsupported MIME/size/remote file
  renders a reason and does not synthesize a native reference.

Required rules:
- dsh-harness.md、DESIGN.md、design-governance.md、i18n/GLOSSARY.md、
  core-product-principles.md、task-and-conversation-naming.md、
  electron-security-and-process-boundaries.md、engineering-conventions.md、
  media-storage-and-protocols.md、remote-and-mobile-adaptation.md。

Tests:
- renderer/store/preload IPC validation, capability-gated buttons, denied action, stale session, reconnect,
  unsupported platform and attachment failure.
- real local DSH create -> prompt -> approval -> cancel/recover -> resume smoke.
- Light/Dark visual inspection when environment allows; otherwise explicitly record the unverified mode.

Acceptance:
- a user can distinguish DSH availability, execution location, capability limitation and recovery action without
  seeing a false “complete DSH” claim.
- all Desktop core data flows remain DSH-specific and recover safely across renderer reload.

Rollback:
- hide dsh entry via capability/registration; existing non-DSH UI and sessions retain behavior.

## Phase 6: Cindy DSH Activity Control Plane

Goal: 提供 Cindy-owned DSH plan/todo、commands/elicitation、terminal、tasks/jobs/workflows/schedules 的结构化控制面。

Scope:
- Define one versioned activity object family and reducer with stable `cindy-dsh` origin, parent/child identity,
  status, allowed actions and reconnect semantics.
- Add activity panels and named IPC actions for observe/approve/reject/cancel/attach/input/signal/close where
  the Cindy contract exposes a tested action. Unsupported object/action has a reason, not a fake button.
- Terminal ownership is scope/session/object-bound; input/signal validates owner and foreground/background
  lifecycle. Native job/task cancellation is not mapped to Orca.

Required rules:
- dsh-harness.md、DESIGN.md、design-governance.md、i18n/GLOSSARY.md、
  maker-core-and-agent-behavior.md、electron-security-and-process-boundaries.md、
  credentials-and-local-storage.md、configuration-and-overrides.md、engineering-conventions.md。

Tests:
- each object type: create/update/complete/fail/cancel/disconnect/reconnect/unknown schema.
- terminal owner mismatch, stale object, signal/input close race and host restart limitation.
- no activity payload is persisted as unconstrained raw JSON or rendered as model-generated markdown.

Acceptance:
- every shipped Cindy-owned object has identity, observation, allowed control actions, cancel outcome and
  disconnect behavior; activity tree never appears in Orca tables or Worker UI or claims native provenance.
- unsupported APIs remain discoverably unavailable instead of silently dropped.

Rollback:
- keep DSH core chat usable and capability-gate advanced panels/actions; no destructive native action occurs on
  panel teardown.

## Phase 7: MCP, Skills, Profiles and Extensions

Goal: 保留显式 DSH 原生扩展能力，同时安全分离 Cindy internal MCP。

Scope:
- Add Home-mode setting/projection, user-visible origin/source state and recoverable mode switching.
- Build Main-only internal MCP factory with URL/transport allowlist, loopback exception rules, per-session token,
  lease, generation, account cleanup and remote forwarding policy.
- Surface profile/skill/plugin/extension discovery and explicit install/update/enable/disable/self-repair only
  through a tested runtime or Cindy-owned operation; no silent permanent disable and no fabricated native API.
- Document state preservation and failed-operation rollback for managed and existing homes.

Required rules:
- dsh-harness.md、plugin-security-and-authoring.md、plugin-library-storage.md when persistent Library is
  touched, credentials-and-local-storage.md、configuration-and-overrides.md、
  electron-security-and-process-boundaries.md、protocol-compatibility.md、
  remote-and-mobile-adaptation.md、DESIGN.md、i18n/GLOSSARY.md。

Tests:
- cindy-managed/existing-dsh-home isolation and override reset; no credential copying.
- internal versus native MCP source separation, allowlist/lease/token/account-switch cleanup, remote boundary.
- native operation explicit confirmation, interrupted update, rollback/recovery, no secret/header/command leak.

Acceptance:
- users can recover explicit DSH profile/plugin state without reinstall/re-auth/data loss; Cindy internal MCP never gains runtime
  configuration privileges.
- plugin/profile changes preserve compatibility and do not create a new unapproved Cindy plugin-base contract.

Rollback:
- remove Cindy projections/leases only; preserve native Home/profile/plugin state and tell the user how to
  re-enable/recover.

## Phase 8: SSH Remote DSH

Goal: 在远端主机运行完整 Cindy DSH scope，并保持本地与远端资源、凭证和恢复边界清晰。

Scope:
- Add remote DSH runtime installer/probe/hash-manifest verification, remote Home creation, Cindy bridge launch,
  loopback forward authentication/health/teardown, and remote diagnostics.
- Make workdir, file/attachment, terminal, MCP, sandbox and profile semantics remote-owned.
- Define carrier reconnect for one remote scope, reconcile behavior and explicit local/remote availability states.

Required rules:
- dsh-harness.md、remote-and-mobile-adaptation.md、protocol-compatibility.md、
  credentials-and-local-storage.md、media-storage-and-protocols.md、
  electron-security-and-process-boundaries.md、configuration-and-overrides.md、
  architecture-invariants.md、engineering-conventions.md.

Tests:
- remote install/version/manifest/ACP handshake; local-to-remote path and secret non-leak checks.
- remote create/resume/prompt/approval/terminal/MCP and forward drop/reconnect with two scopes.
- failure-radius scenarios: remote DSH crash, SSH carrier loss and one session corruption must not affect local
  DSH, another remote host or Mobile peer.

Acceptance:
- all remote DSH execution and durable state are remote; a failed remote install is scoped unavailable rather
  than a local fallback.
- reconnect never replays uncertain prompts or silently creates a replacement native session.

Rollback:
- close only remote DSH scopes/forwards and retain remote state; never delete a user-selected remote Home.

## Phase 9: device-link and Mobile

Goal: 让 Mobile 通过受控 Desktop 连续地查看和控制同一个 DSH task，并在版本差异下安全降级。

Scope:
- Add append-only shared/device-link payloads for dsh identity, capability snapshot, activity projection,
  approval/cancel/queue controls and compatibility state.
- Add Desktop validators/allowlist and Mobile reducers/UI for view/continue, input/attachment condition,
  approval/stop/queue and read-only terminal/task state.
- Define old Desktop × old/new Mobile compatibility, two concurrent control peers and “continue on desktop”
  actions for operations that lack safe mobile UX.

Required rules:
- dsh-harness.md、mobile-development.md、remote-and-mobile-adaptation.md、
  protocol-compatibility.md、DESIGN.md、design-governance.md、i18n/GLOSSARY.md、
  media-storage-and-protocols.md、engineering-conventions.md.

Tests:
- payload schema/version, sender/session/owner validation, old/new cross matrix, two peers and one disconnect.
- Mobile cannot obtain endpoint/token/profile/secret; unsupported actions remain explicit.
- if any app.json, native dependency, config plugin or native module is touched, obtain the mandatory cold-update
  approval before merge; avoid such changes in this phase unless necessary.

Acceptance:
- Mobile sees dsh rather than an unknown or substituted Agent; actions execute only at the controlled Desktop.
- a peer or network failure has the defined, isolated radius and does not create/restart another DSH session.

Rollback:
- disable new DSH Mobile controls by negotiated capability while preserving older device-link behavior and Desktop
  DSH sessions.

## Phase 10: Orca and DSH Collaboration Boundary

Goal: 仅在明确、可证明的契约下让 DSH session 参与 Orca，而不混同 DSH native team 与 Orca Worker。

Scope:
- Decide and implement explicit DSH-as-Orca Lead/Worker policy only for capabilities proven by F0–F9.
- Add origin/provenance, permission, budget, concurrency, result handoff, cancellation, audit and recovery
  semantics at all stores and UI projections.
- Keep Cindy-owned subagent/team/job/workflow objects `cindy-dsh` and outside orca_teams/orca_workers. If a requested
  nesting lacks a safe contract, reject with a visible reason.

Required rules:
- dsh-harness.md、orca-team-architecture.md、maker-core-and-agent-behavior.md、
  protocol-compatibility.md、remote-and-mobile-adaptation.md、
  credentials-and-local-storage.md、DESIGN.md、i18n/GLOSSARY.md、engineering-conventions.md.

Tests:
- DSH native child versus Orca worker create/stop/fail/recover/audit and DB/UI identity separation.
- permission/budget propagation, nested and unsupported combination rejection, remote/mobile projection.
- regression for existing Orca, Claude, Codex and Pi collaboration flows.

Acceptance:
- users can identify origin and authority at every layer; no `cindy-dsh` record is treated as an Orca worker.
- unimplemented nesting cannot be reached through a default/fallback route.

Rollback:
- remove only explicit interop registration/policy; keep DSH native sessions and Orca historical data distinct.

## Phase 11: Release, Upgrade and Regression Governance (Deferred)

Goal: 将设计正本转为有持续证据的发布与升级制度，确保“完整 DSH”只在条件满足时出现。当前不执行；
仅在用户重新授权发布、远端或非 macOS 工作后才恢复本阶段。

Scope:
- Add platform runners, F0 packet refresh workflow, ACP/Cindy bridge capability diff check, release fixture suite,
  upgrade/rollback compatibility ledger, bounded diagnostics and support runbook.
- Test supported local Desktop platforms, remote SSH, device-link/Mobile and existing Agent regressions; document
  which layer is not verified rather than extrapolating.
- Replace the “unadmitted” label in dsh-harness.md only after release evidence, independent adversarial review
  and maintainer approval all pass.

Required rules:
- dsh-harness.md、development-workflow.md、desktop-development.md、mobile-development.md、
  cindy-updater.md if updater chain changes, log-upload-and-redaction.md,
  credentials-and-local-storage.md、protocol-compatibility.md、engineering-conventions.md.

Tests:
- release packet rebuild and negative integrity cases; ACP/Cindy bridge compatibility diff requires explicit adapter/UI
  decision for every deleted/renamed/semantic-changed field.
- Windows/Linux/macOS supported runner smoke, local/remote/Mobile targeted integration and upgrade from prior
  DSH binding/Home/profile/plugin state.
- independent final security/compatibility review for P0/P1: cross-session mix-up, secret leak, lost native
  state, unknown-agent fallback, remote-to-local execution and native extension regression.

Acceptance:
- the release matrix in dsh-harness.md section 12 is satisfied with actual evidence and known gaps.
- complete DSH claim is permitted only after maintenance owner approval; otherwise releases expose the truthful
  staged capability label.

Rollback:
- stop DSH registration for the offending release, retain reversible evidence/bindings, and guide users to the
  prior supported runtime without deleting home, extensions or task history.
