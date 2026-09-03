# DSH Cindy 控制面接入 Requirements

Status: confirmed
Work type: feature
Artifact: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
Source of truth: docs/dev-rules/dsh-harness.md
User confirmation: 2026-09-02（要求将该方案拆为可执行的分阶段计划，并创建 GitHub issue；随后明确
“不依赖上游、我们自己开发”）；2026-09-03（当前仅本机 `darwin-arm64` 开发、构建与验证；仅推送用户
fork，不做远端构建或 upstream 写操作）

## Scope Adjustment — Local Fork-Only Development (2026-09-03)

The user supersedes every contrary CI, remote-publication and multi-platform assumption for active delivery:

- Active scope is local macOS arm64 Desktop development: pinned-source verification, local source build/archive
  integrity, public ACP probe and Desktop Main real-binary E2E.
- Do not build Linux, Windows or another macOS architecture; do not run GitHub Actions, upload artifacts, issue an
  attestation, distribute a runtime, or make a release claim.
- Do not push, open a PR, create or update an issue in `upstream`. Code may be pushed only to the user's `origin`
  fork. The previously published `makecindy/cindy` issues are historical planning references and must not change.
- F8–F11 and any Mobile/SSH/release implementation remain deferred design, not current acceptance. A later user
  authorization is required before they become executable work.

## Goal

将 DeepSeek Harness（DSH）作为 Cindy 的第四个 Agent harness 接入。完成态不是“能发送一条
prompt”，而是在一个经准入、固定版本的 DSH release 上，让 Cindy 自己拥有 task 的会话、
生命周期、权限、事件、恢复和跨端控制面；Cindy source-built runtime 只是受控引擎，且不让现有 Claude Code、
Codex、Pi 的行为退化。

## Current State

- 设计正本是 docs/dev-rules/dsh-harness.md；Cindy 自主控制面已裁决，alpha.3 基础制品已取证，
  F0 已有未注册的 ACP client、Desktop Main stdio transport 和 DshControlPlane 核心生命周期；
  F1 已在本机 Desktop 完成 dsh 身份闭合（严格 DB/IPC/renderer 保留与未知值拒绝）；受管分发、
  持久 binding、事件、可执行 UI 与跨端能力尚未实施。
- maker-core 的 AgentKind 现在包含 claude-code、codex、pi、dsh，但 DSH adapter 故意不注册；
  DSH creation、模型路由、scheduler、MCP worker、Orca worker 和通用 bootstrap 都显式不可用，
  不能因类型存在而执行或回退到其它 Agent。Mobile 新建任务与 device-link 契约未改动，仍属 F9。
- 运行时分发目前已有 tools/pi 的整目录、hash 与 manifest 参考实现；仓库尚无 tools/dsh、
  DSH managed runtime、Host supervisor、DSH agent、session binding 或 DSH 专用 UI。
- GitHub 于 2026-09-02 查询不存在标题或正文含 DSH 的现有 issue。

## Expected Outcome

交付顺序必须从 **Cindy Bridge Gate** 开始：同一 release evidence packet 必须证明 Cindy source-built runtime
的公开 ACP v1 面，以及 Cindy 自己实现的 `DshBridgePort` 能在受控 scope 内完成可关联、可收口的
create/close/list/reconcile/resume（若 advertise）/prompt/cancel/close 生命周期。active session
不能被 list/resume，close 后必须保留 binding 才能恢复。没有另一个上游 Host API 不会
阻塞开发；私有 state scraping、Web UI 驱动和不透明 profile patch 仍不得作为替代。

完成完整路线后，在已支持平台和已准入 profile 内：

1. DSH 作为 dsh 身份贯穿数据库、IPC、Desktop、device-link、Mobile、远程 SSH 与诊断；
   任意未知值 fail closed，绝不静默回退为 cc、codex 或 pi。
2. Cindy `DshControlPlane` 是产品 task、binding、命令 receipt、权限与跨端投影的唯一控制面；
   只有它可使用 runtime ACP。上游未公开的 UI object 不伪称 native，Cindy 需要的同类能力使用
   明确的 `cindy-dsh` provenance 实现。
3. Main / Cindy DSH scope 才能持有 runtime、DSH_HOME、凭证、bridge correlation state 和 remote tunnel；
   Renderer、Mobile、插件均只消费经校验、最小化的投影。
4. DSH runtime event 与 Cindy-own activity 都使用有版本且有限的契约，不伪装为普通 text 或 tool_result。
5. 支持范围、能力、限制、断线和恢复状态均来自 runtime capability discovery 与验证事实；
   不能用其它 Agent 的默认能力或 UI 掩盖尚未支持的 DSH 能力。

## User Scenarios

1. Desktop 用户在支持的平台看到 DSH 可用性、版本、执行位置和 capability；创建和继续的是同一
   DSH native session，而非 Cindy 伪造的文本会话。
2. 用户对真实 DSH tool approval 做一次性允许或拒绝；无关联、超时、断线或未知 toolCallId
   均被拒绝，不会升级为持久权限。
3. 用户在 Desktop 观察并控制 Cindy DSH 的计划、terminal、task/job、workflow、skill 与
   extension；它们保留 `cindy-dsh` identity，不混入 Orca worker。
4. 用户选择本地或 SSH remote DSH 时，runtime、DSH_HOME、路径、附件、terminal 和凭证都在
   对应执行位置；远端失败不会影响本机或其他 scope。
5. 用户从 Mobile 回到被控 Desktop 时仍进入同一 DSH 任务，并得到明确的可操作、只读或“请在
   桌面继续”结果，而不是未知 Agent 或新会话。
6. 用户显式选择既有 DSH Home、profile、skill 或 plugin 时，Cindy 提供可恢复的原生路径，
   不以 Cindy 的安全层为由做不可逆禁用。

## Business Rules

- Cindy Bridge Gate 是完整路线的硬前置条件；不得通过解析私有 JSONL、私有数据库或私有协议
  绕过公开 ACP 和 Cindy bridge contract。
- 当前本机 runtime 只允许由经审阅固定 source release 构建并以 archive hash、解包目录 manifest、sidecar、
  平台、版本和真实 handshake 验证的 `darwin-arm64` 自包含制品；tag→commit→tree、上游 lockfile/
  Cindy pkg-toolchain/build-script digest 必须一致。上游 lightweight tag 或未签名 commit 不得伪称签名
  已验；本地 object IDs 只证明构建输入，不能冒充 Cindy provenance。禁止 PATH、npm、pip、curl、
  系统 Node、上游 wheel 或源码 checkout fallback。
- 默认 Home mode 为 cindy-managed；existing-dsh-home 仅在用户显式选择时启用。切换不得复制、
  删除或迁移对方凭证。
- 所有 native event 都先经版本化 schema、顺序与归属校验，再投影到 Cindy；未知事件可被安全
  保留为未呈现状态，但绝不可伪造完成、重试带副作用的 prompt 或降级为另一个 Agent。
- 新增或修改 system prompt 不在此项目授权范围内；任何后续需求必须单独获得维护者确认。
- UI 必须同时实现 Light / Dark 和 en、zh-CN、zh-TW、ja、ko；在未实机目检时明确报告缺口。
- device-link / Mobile 协议变更必须 append-only、旧端可解释降级，且与服务端协议仓同步；
  Desktop Renderer 或 Mobile 不能直连 ACP transport / Cindy bridge。

## In Scope

- 当前可执行路线是 F0–F7 的本机 Desktop 前置与产品阶段；F8–F11（SSH、Mobile、Orca 互操作和
  发布治理）仅保留为已审计的 deferred design，未获新授权不得实施或构建。
- 每阶段的目标文件/模块、接口、数据、测试、审计、依赖、回滚和完成判据。
- GitHub parent issue 与按一个 focused PR 边界拆分的子 issue。

## Out of Scope

- 在 F0 未通过时用私有日志抓取、Web UI 嵌入或 prompt 包装冒充受控 Cindy bridge。
- DSH 服务端、DeepSeek 上游 runtime 或非本仓服务端仓的未经协调修改。
- 增加 Cindy system prompt、persona 或 DSH 模型路由的隐式改写。
- 将 DSH native team/subagent 映射成 Orca Worker，或反向伪装。
- 未经另行证据与审批，对未发布平台、OS sandbox、MCP 自动授权或 background schedule 作可用承诺。

## Impacted Surfaces

- packages/maker-core：AgentKind、BaseAgent adapter、event/interaction/capability contracts。
- apps/desktop main：agent-binaries、DSH Host、credential injection、process lifecycle、IPC、
  local database、migration 与 projection。
- apps/desktop preload / renderer：受限桥、session selector、activity panels、i18n、themed UI。
- packages/maker-shared、packages/device-link、apps/mobile：版本化 dsh identity、投影和控制动作。
- packages/maker-remote-ssh：remote install、Host、forward、文件/附件/terminal 的位置语义。
- packages/orca-workflow：仅在显式互操作阶段定义 `cindy-dsh` provenance。
- tools/dsh、发布 runners、CI fixtures、support/runbook 与开发规则。

## Acceptance Criteria

1. 本目录包含以本 requirements 为准的 technical spec、development plan、validation plan 与
   issue map；全部列明状态、范围、依赖、证据、验收与停止条件。
2. 计划明确 F0–F11 的独立 PR 边界；每个阶段可独立审阅、验证、回滚，并写明其阻塞关系。
3. 所有代码阶段都明确要读的仓库专项规则，尤其是 DSH、maker-core、Electron security、
   credentials/storage、database/migrations、configuration、remote/mobile、protocol、
   plugins、Orca、design、i18n 与 release 规则。
4. 对每个高风险结论都有可执行测试或明确的“尚未证明”状态；不把静态检查、mock 或本机
   macOS 结果写成完整 bridge、跨平台、远程或 Mobile 成功。
5. 本地 issue map 保留一个 parent 与 12 个阶段 issue 的历史编号、依赖关系、测试和授权边界；它
   是本地执行卡的索引，不触发或要求更新任何远端 issue。
6. 所有文档经过独立范围/一致性审计；P0/P1 文档缺陷在发布 issue 前修复。

## Open Questions

无阻止计划发布的产品选择。F0 的事实性结果是后续完整路径唯一的决策门：

- 通过：按 F1–F7 的本机 Desktop 范围推进；每项 runtime capability 仍按 capability status 逐项开放。
- 不通过：修复 Cindy bridge/runtime compatibility；不能把未验证能力注册为可用。不得把
  “未发现另一套上游 Host API”误报为 F0 失败。

## Confirmation Gate

本 requirements 已由用户在 2026-09-02 的“整理分阶段可执行方案并构建 GitHub issue”请求确认。
后续若改变完整接入定义、Cindy Bridge Gate、非退化承诺、跨端范围或安全边界，必须回到本
requirements 并获得新的明确确认。
