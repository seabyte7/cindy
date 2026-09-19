# Cindy 多 Agent Harness 技术方案与接入指南

> 阅读顺序：[原理](multi-agent-harness-principles.md) → [架构全貌](architecture.md) → **本篇：实现与扩展**。
> 核对日期：2026-09-16；HEAD：`773672742c48f8195c21acba16efb8ae52879c49`；分支：`codex/dsh-runtime-main-20260915`。
> 事实基线包含该工作树已有的 DSH 未提交修改。本文是源码技术说明；没有启动 App、连接真实模型、执行 SSH 或移动端验收。

## 目录

- [1. 阅读约定与证据基线](#i1)
- [2. 公共接口、装配和数据流](#i2)
- [3. Claude Code 接入](#i3)
- [4. Codex 接入](#i4)
- [5. Pi 接入](#i5)
- [6. DSH 接入](#i6)
- [7. 四种 harness 能力与入口矩阵](#i7)
- [8. 跨引擎、协作、远程与自动化](#i8)
- [9. 接入一个新 harness 的完整步骤](#i9)
- [10. 最小适配器、事件和权限示例](#i10)
- [11. 测试、验收和交付](#i11)
- [12. 故障排查与源码导航](#i12)

<a id="i1"></a>
## 1. 阅读约定与证据基线

### 1.1 术语与状态

“任务”是 Cindy 业务 Session；原生 session/thread 是执行引擎的历史和句柄；Turn 是一轮输入及其运行。
provider 指模型连接，不等同于 harness。Orca Worker、Bot 身份和原生子 Agent 使用不同的生命周期。

本文将事实分为四类：

| 标记／措辞 | 含义 |
|---|---|
| 当前实现／已接入 | 在本次工作树的实际调用链、接口和 handler 中存在；不等于运行验收通过 |
| 设计目标／待接入 | 专题方案或原生协议有能力，但 Cindy 路径尚未完整开放 |
| 历史证据 | 仓库手册或证据文件记录的测试，带原来的平台、版本和 fixture 限制；本次未重跑 |
| 本次验证 | 三篇文档、源码引用、章节覆盖和文档契约检查；不包括真实 Agent 执行 |

未提交修改涉及 `providerHandlers.ts`、`register.ts`、provider 配置对话框、DSH 任务控件、对应测试和 i18n。
下文有关保存后注册对账、任务控件按需展开的描述适用于工作树，不宣称已合并或已发布。读者核对另一个分支时应重查。

### 1.2 运行时版本与分发来源

| Harness | 本次源码 pin | 实际采用的装配入口 | 注意事项 |
|---|---|---|---|
| Claude Code | CLI `2.1.259`；`@anthropic-ai/claude-agent-sdk` `0.2.112` | [CLI pin](../tools/claude/latest.json)、[core package](../packages/maker-core/package.json) | SDK npm 版本与 CLI 版本是两个兼容维度 |
| Codex | 目录包 `0.153.4` | [目录包 pin](../tools/codex-package/latest.json)、[binary manager](../apps/desktop/src/main/agent-binaries/index.ts) | 生产入口为完整目录；旧 [单 binary pin](../tools/codex/latest.json) `0.145.0` 不能替代当前目录包 |
| Pi | `0.85.1` | [Pi pin](../tools/pi/latest.json)、[Pi Host](../apps/desktop/src/main/maker-host/pi-host.ts) | runtime、扩展与 RPC 能力要匹配，启动后目录不必等于静态配置 |
| DSH | source tag `dsh-v0.1.2-alpha.3`，受监督 build.11 | [受监督 source release](../tools/dsh/macos-supervised-source-release.json) | 当前为 `darwin-arm64` 本地开发范围；[旧 latest](../tools/dsh/latest.json) build.1 是另一份历史制品记录 |

DSH source commit 为 `dd6322d604e00eec1ba5e0c8541159906a21094a`，完整 release ID 为
`cindy-dsh-0.1.2-alpha.3-build.11-macos-supervised`。清单同时绑定源码、lockfile、适配补丁、工具链和制品摘要。
实际部署的版本需沿 prepare/cache/CDN manifest 或 Helper descriptor 核对，再查询该进程版本；不能仅凭此表认定已安装 App 的版本。

### 1.3 规则与旧文档冲突如何处理

新增实现前按变更范围读取 [Maker Core](dev-rules/maker-core-and-agent-behavior.md)、[Electron 边界](dev-rules/electron-security-and-process-boundaries.md)、
[配置](dev-rules/configuration-and-overrides.md)、[存储](dev-rules/credentials-and-local-storage.md)、[数据库](dev-rules/database-and-migrations.md)、
[模型目录](dev-rules/model-catalog-maintenance.md)、[远程](dev-rules/remote-and-mobile-adaptation.md)、[协议](dev-rules/protocol-compatibility.md)及专项 harness 规则。
本文解释现状，不另立一套权限或产品合同。

已核实的文档滞后包括：原架构总图未列 DSH；部分接口注释仍称 SSH 仅 Codex 支持；DSH 长文仍含被开头裁决覆盖的 Native Host Gate。
应依实际 transport 和当前裁决判断，不能只复制注释。当前 DSH 控制面由 Cindy Main 实现，不等待上游 Native Host API。

<a id="i2"></a>
## 2. 公共接口、装配和数据流

### 2.1 公共接口及调用者

| 接口／类型 | 必选或核心内容 | 主要调用者与限制 |
|---|---|---|
| `AgentKind` | `'claude-code' \| 'codex' \| 'pi' \| 'dsh'` | Maker/IPC 的身份；“认识身份”不等于“已注册” |
| `BaseAgent` | `kind`、`capabilities`、`startSession(opts)` | Host 构造，Maker 调用；`forkSdkSession` 等有默认不支持实现，`dispose` 为资源回收入口 |
| `AgentDeps` | 必选 `auth`、`runtimeConfig`、非空 `binaryPath`、`logger` | Host 注入；MCP、目录、远端 transport、模型/权限 hook 等为可选且有厂商专属项 |
| `StartSessionOptions` | 必选 `workingDir`、`model`；可选业务 ID、instance、provider、resume 等 | Maker 传递，真实 instance 由 Maker 铸造；resume 经本方法选项表达，没有统一 `BaseAgent.resumeSession()` |
| `AgentSessionHandle` | 必选 `id`、`agentKind`、`model`、`send`、`steer`、`abort`、`close`、`events`、`getUsageSnapshot`、`setInteractionResolver` | Session 包装；不支持的必选动作需明确拒绝，不能假成功 |
| Handle 可选能力 | `setModel`、effort/权限/Plan 调整、graceful stop、后台单元控制、树导航、HTML 导出、compact、detach 等 | Session/Host 按 capability 和当前状态调用，不能因字段可选就静默弱化权限 |
| `UserMessage` | `{ type: 'user', content: string \| UserContentBlock[] }` | 文本、图片、文件、mention；路径有效性和授权不由静态类型保证 |
| `AgentEvent` | `type: AgentEventType`、`data: unknown`、可选 source/轮次归属 | adapter → Session → Main 管线 → UI；payload 需运行期收窄，不是自动安全的完整判别联合 |
| `Capabilities` | 必选核心能力状态、模型/effort/权限列表；可选高级能力 | Maker/UI/Host 决定可用操作；还需叠加路由、平台和运行状态 |
| `InteractionResolver` | `InteractionRequest → Promise<InteractionDecision>` | `permission`、`ask_user_question`、`plan_review` 共用交互通道，实际协议映射各家负责 |
| `SessionStorage` | create/get/list/update/delete、原子 `compareAndClearSdkSessionId` | Host DB adapter；只承接任务元数据，不承接全部消息内容 |
| `AuthAdapter`／`Logger` | 原生认证适配与结构化日志 | 平台细节留在 Host；DSH 不通过通用 auth 传递实际 key |
| `McpProvider` | `name`；可选 enabled 判断、Claude SDK/Codex HTTP 配置转换和额外 env | 按任务身份装配；并没有一个已通吃四家的 `toUniversalMcpConfig` |
| `AgentRuntimeConfig` | endpoint、行为参数、prompt、memory 等可选运行配置 | 来自 Host，不等于可直接接收 Renderer 的任意配置对象 |

正本：[base-agent](../packages/maker-core/src/agents/base-agent.ts)、[common](../packages/maker-core/src/types/common.ts)、
[events](../packages/maker-core/src/types/events.ts)、[capabilities](../packages/maker-core/src/types/capabilities.ts)、
[interfaces](../packages/maker-core/src/interfaces/index.ts)。整个 TypeScript 表面仍会演进；本表列行为分组，不替代源码的完整字段列表。

`AgentSessionHandle.id` 的普通注释称 SDK ID，但 DSH 是刻意例外：返回 Cindy 可保存的不透明句柄，native session ID 留在 Main。
DB/UI 与 Maker 身份转换使用 [agentKindConversion](../apps/desktop/src/shared/agentKindConversion.ts)，仅 `cc ↔ claude-code` 改名。
显式未知值抛 `UNKNOWN_AGENT_KIND`；历史 null/undefined 的缺省兼容不能用于清洗任意未知引擎。

### 2.2 装配、创建与输入事务

```text
Desktop bootstrap / binary ready / owner DB ready
  → maker-host：storage、auth、route、MCP、runtime、lifecycle hooks
  → 创建 Claude/Codex adapter，按可用性创建/注册 Pi；DSH 另行异步准入
  → new Maker({ agents, storage, ... })
  → maker-ipc 注册固定 handler，preload 暴露命名 API
  → 创建或首次发送：bootstrapSession → Maker.createSession → adapter.startSession
  → Session 包装 handle、安装 resolver、消费 events
```

具体创建入口是 [sessionCreateHandler](../apps/desktop/src/main/maker-ipc/sessionCreateHandler.ts)，事务由
[register.ts](../apps/desktop/src/main/maker-ipc/register.ts) 注入；发送入口是
[sessionSendHandler](../apps/desktop/src/main/maker-ipc/sessionSendHandler.ts)，委托
[makerSendTransaction](../apps/desktop/src/main/maker-ipc/makerSendTransaction.ts)。显式 create 和首次 send 的 lazy-create 都应汇入现有链路。

`Maker.createSession` 对业务 ID 的 live 对象与 in-flight 创建去重；相同 cwd 下可以有多个独立任务。
启动失败要清理 handle，清理失败保留占位，避免同 ID 同时出现两份原生执行。应用 shutdown 后拒绝新建。
Host 的发送锁还覆盖选模意图、恢复、目录授权、输入准备与真正分发前的代次复验。

输入生命周期至少分为：**进入队列 → 准备 → 预留 turn → provider 分发/接受 → 事件产生 → 终态结算**。
`send()` 返回的回执不是模型完成结果；异步引用解析完成时，也要确认该输入仍为当前有效项。
晚到事件必须保留原轮次/后台归属，不能结束下一轮或复活已清空的消息。

### 2.3 事件、状态与持久化

```text
vendor notification / SDK event
  → translator + async queue
  → Session：轮次、来源、交互等待、watchdog、continuation
  → sessionEventPipeline
      prepare → stream persistence → delivery → terminal settlement → snapshots / usage
  → maker:event / 其它 push
  → preload → makerChatStore 或 device-link → Mobile store
```

DSH raw update 到上述队列前，还有 Main 的 durable journal 与有限投影层。其它引擎也不是将任意 raw event 原样转发。
`AgentEvent` 包含正文/思考、工具开始/结果/完整结果、子 Agent 状态、图片、差异、交互、usage/status、压缩边界、身份和终态。
Codex 显式订阅需要的 notifications；未知诊断事件可能只进日志。不能承诺每个 vendor 扩展字段都已进入 UI。

`SessionStatus = active | aborting | closed | error` 表示句柄生命周期；`running/waiting/idle` 是另一层执行快照，
DB 的 active/archived/deleted 又是产品状态。`error.isTerminal=false` 表示还可能重试，不能释放本轮；
`done` 携带或关联 continuation 时也不能把后台工作错误计入下一轮。只含心跳或空白的事件不是实质进展。

持久化事实源：[SessionStorage](../packages/maker-core/src/interfaces/session-storage.ts)、
[sessionEventPipeline](../apps/desktop/src/main/maker-ipc/sessionEventPipeline.ts)、
[makerChatStore](../apps/desktop/src/renderer/lib/makerChatStore.ts)。DB 时间线、原生历史、模型上下文、长期记忆和 UI 缓存分别管理。

### 2.4 权限往返与能力路由

原生审批请求 → adapter 对应 `InteractionRequest` → Session 安装的 resolver → Main 自动审阅或用户交互 →
校验任务、请求和 instance → 原生决定。权限不是向模型发一句“请不要修改文件”。

当前 `turnPermissionPolicy` 是 Main 构造的每轮策略，不能从 Renderer wire 自报获得。
Claude 的 `acceptEdits/bypassPermissions`、Codex/Pi 的 `bypassPermissions` 与某些强制逐次确认组合不兼容，
能力声明列为不支持并在启动/发送前拒绝，避免 native 不回调时仍对用户承诺强制确认。
DSH 只提供当前请求的 `allow-once/reject-once`；没有通用权限档或永久批准。

工具配置、可见性、授权范围和实际 handler 准入是四件事。MCP context 中的业务 ID、instance 和调用者层级由 Host 产生，
不能接受模型自报的 Lead/sessionId 越权。权限、prompt 或工具暴露变更需按专项规则评估行为与缓存影响。

<a id="i3"></a>
## 3. Claude Code 接入

### 3.1 启动、进程与协议

Main 的 [maker-host](../apps/desktop/src/main/maker-host/index.ts) 创建 `ClaudeCodeAgent`，注入 ready binary、
AuthAdapter、runtimeConfig、MCP、模型与远程 hook。核心使用 `@anthropic-ai/claude-agent-sdk` 的 query 接口驱动 CLI，
输入通过异步流送入，SDK 消息经 [translator](../packages/maker-core/src/agents/claude-code/translator.ts) 归一。

本地 Query 持有原生执行与上下文；远端由 [maker-cc-manager](../packages/maker-cc-manager/) 的 daemon 包装 SDK，
经 SSH/NDJSON 控制。不能由个别旧字段注释推断 Claude 不支持 remoteHostId。
本地平台支持由 binary manifest 与安装结果决定，远端还需 daemon、认证和网络路径就绪。

### 3.2 配置、prompt、模型与工具

认证由 Host 选择当前来源，SDK 所需 env 与 proxy endpoint 在启动时组装。兼容代理与模型协议桥归 Host，
CLI/SDK 仍是 Claude harness。model 使用显式版本/目录路由，不通过裸别名猜版本。

稳定 prompt 按 SDK preset、Cindy 追加段、记忆/通讯录与 Host 配置、工作目录快照及输入层组织；准确顺序以
[adapter 的 buildQuery](../packages/maker-core/src/agents/claude-code/index.ts)和[Maker 行为规则](dev-rules/maker-core-and-agent-behavior.md)为准。
每轮可变内容不应混入稳定前缀；本文不修改任何实际提示词。

MCP provider 经 `toClaudeSdkConfig` 装配；原生 commands/skills/agents 的发现与管理采用各自目录与 scope。
`canUseTool` 关联统一权限、提问与 Plan 审阅。Cindy 还对原生子 Agent 模型路由、后台执行和权限进行专属适配，
不会把全部原生调用改造成独立 Maker Session。

### 3.3 操作与生命周期

| 操作 | 当前机制 | 关键限制 |
|---|---|---|
| 创建／恢复 | `startSession` 构造 Query，使用保存的原生恢复选项 | 业务 ID 与 SDK ID 不同；原生历史缺失不能用 UI 历史假装恢复 |
| send／steer | 输入队列与原生流式输入；新轮次和在途追加分别处理 | steer 不重置本轮计费、watchdog 和状态 |
| 权限／Plan | `canUseTool`、SDK permission mode、ExitPlanMode 映射 `plan_review` | 授权仅适用于已实现的原生回调范围；等待用户不是网络卡死 |
| 文本／工具／usage | SDK 消息 → translator → AgentEvent | 工具开始与结果需关联同 ID；静默桥接轮不能冒充用户轮 |
| abort／软停止 | adapter 的中断与可用的原生停止机制 | 轮次 Stop、指定后台执行单元停止和 close 不同 |
| fork | `forkSdkSession` 配合 SDK session、消息 UUID 与恢复选项 | fork 来源需真实原生锚点；不等于复制 DB 行 |
| rewind | SDK checkpoint/file rewind 与 resumeSessionAt/fork 重建 | 老任务可能缺 checkpoint；产品 DB 消息裁剪由 Host 承担，文件恢复结果需单独判断 |
| close／dispose | 关闭 Query、解除事件和桥接资源；应用退出收敛 | 失败 cleanup 不能当作已退出；SSH detach 与终止分开 |

### 3.4 压缩、记忆与故障处理

SDK 原生压缩保持启用；Host 的自动 compact controller 与桥接 compact 遵守统一失败分类。
确定性 compact 失败锁存 rollover，普通超时或用户停止不自动视为换窗授权。普通 idle 超时和输入前的准备轮超时
必须分开，否则会把尚未真正执行的输入当成已接受轮次发送 CONTINUE。

原生 Auto Memory 已声明支持，默认开启；开关改变影响下次构建，能力明确不承诺当前 live Query 中途更新。
目录授权发生变化时也可能在下一次发送走 resume/fork 重建，并非所有 SDK 设置都可热改。

测试入口：[Claude tests](../packages/maker-core/src/agents/claude-code/__tests__/)，重点看 translator、rewind-runtime-settings、
bot-own-skills-mount、one-shot-guard，以及共享 Session/Maker 的取消、续接与清理测试。Orca、Bot、Scheduler、SSH 和 device-link
复用公共链路，但仍需各自入口的权限和路由验收。

<a id="i4"></a>
## 4. Codex 接入

### 4.1 启动、进程与协议

[CodexAgent](../packages/maker-core/src/agents/codex/index.ts) 通过
[AppServerHost](../packages/maker-core/src/agents/codex/app-server/host.ts)、client、transport 和 protocol 驱动 `codex app-server`。
host 首次使用时懒启动并 initialize；通知按 threadId 分发，请求按 RPC ID 关联。注册回调早于握手，避免启动通知先于响应而丢失。

共享 host 能承载多个 thread，但当前实现也有凭证、历史根、独立路由及控制面用途的隔离 host。
因此不能照旧注释概括成“整个 CodexAgent 永远只有一个进程”。SSH 通过 Host 注入远端 transport，模型网络的
Responses WebSocket/HTTP 又是另一条链，不要与 app-server 本地 JSON-RPC 混为一谈。

当前使用完整 Codex 目录包而非复制单一可执行文件；code-mode host、resources、rg 等都属于运行布局合同。
参见 [binary manager](../apps/desktop/src/main/agent-binaries/index.ts) 与 [目录包更新脚本](../tools/codex-package/update.mjs)。

### 4.2 配置、认证、模型与 MCP

Host 决定当前连接、凭证形态、模型目录、原生 provider 配置与 loopback proxy。启动配置、thread 级冻结身份和 per-turn
model/effort 参数不能混用。MCP 通过 HTTP bridge 注册，调用时恢复可信 thread/session context；transport session ID 不是 Maker ID。

原生历史根 `CODEX_HOME` 与 `sqlite_home` 必须能共同解析分页祖先、归档与 fork；切换账号不等于改写历史归属。
跨历史根认证采用明确的临时凭证配置与 external-auth adapter，并在重连、刷新时复验 owner/host 代次和账号。
管理员原生策略可能影响生效配置，启动后的检查不能证明初始化阶段从未读过历史根认证。
源码见 [external-auth](../packages/maker-core/src/agents/codex/app-server/external-auth.ts) 及其 native 契约测试。

产品 prompt 通过原生指令与 Host 装配路径进入 thread；需确认是否已写入原生历史，不能从全局代理开关猜测。
工具 schema、MCP context、原生动态工具与原生子 Agent 路由均有专属生命周期，不能仅为换账号更换 thread 或改写旧历史。

### 4.3 操作与生命周期

| 操作 | 原生协议／适配 | 关键限制 |
|---|---|---|
| 创建／恢复 | `thread/start`／`thread/resume` | 冻结对应 host 路由与恢复根，thread claim 防重复持有 |
| send | `turn/start`，映射 UserInput、model、effort、权限等 | accepted 与 turn completed 分开 |
| steer／abort | `turn/steer`／`turn/interrupt` | 需匹配当前 thread/turn，不能把旧轮次通知归给新轮次 |
| 事件 | thread/turn/item 通知与 delta → translator | usage、account rate limit 与内容不同；未订阅事件不构成通用能力 |
| 权限／提问 | server requests → InteractionResolver → RPC response | 命令、文件、MCP elicitation 等保持请求关联与作用域 |
| Plan | 原生 collaborationMode plan、plan item 与 `plan_review` | 不等于 Orca team；计划批准和执行轮次需保持原生语义 |
| fork | `thread/fork`，新版按 `lastTurnId` 定位 | 分页历史优先用原生 turn 锚点，不能按可见用户消息数猜分叉位置 |
| rewind | `thread/rollback` 的对话裁剪路径 | 不回滚文件；产品代码回退需 Git；分页线程限制另按目标 binary 的实现分支处理 |
| close | 解除路由、取消/退订本 thread 的 live runtime | unsubscribe 不保证进程即时卸载；共享 host 仍服务其他任务 |
| dispose | 关闭对应共享与隔离 hosts | 不能只关默认 host 而遗留实际执行连接；Windows 需显式收敛进程 |

### 4.4 压缩、恢复与验证重点

Codex 没有与 Claude 相同的 Host 自动 `/compact` 注入实现。远端压缩、原生摘要压缩、明确密文 compact 失败换窗、
大图片历史整理和 interrupted-turn 续跑各有分类；普通生成 502 或 stderr 关键字不能触发压缩接替。
已有工具输出时自动重放原请求存在副作用重复风险；恢复需按同一输入的 accepted/产出/continuation 证据决定动作。

原生记忆当前为实验性，默认关闭，启用变更有进程级语义；不能从通用 `memory` 字段推断与 Claude/Pi 相同。
主验证入口：[adapter tests](../packages/maker-core/src/agents/codex/index.test.ts)、
[translator tests](../packages/maker-core/src/agents/codex/translator.test.ts)、
[app-server](../packages/maker-core/src/agents/codex/app-server/)。版本升级还需使用目标 binary 运行 external-auth native 测试，
覆盖分页祖先、归档、分叉、重连、请求身份和 401 刷新；这属于未来 runtime 改动的验证，本次文档整理未执行。

<a id="i5"></a>
## 5. Pi 接入

### 5.1 启动、进程与协议

[Pi Host](../apps/desktop/src/main/maker-host/pi-host.ts) 创建可用的 `PiAgent`，提供 binary、agent home、模型资料、MCP 和远端 transport。
本地启动 `pi --mode rpc`；[RPC client](../packages/maker-core/src/agents/pi/rpc-client.ts) 在 transport 上处理严格 JSONL、请求 ID、响应和事件。
只按 LF 分帧，不能使用会把 JSON 字符串中的 U+2028/U+2029 误作分隔的读取方式。

远端通过 [maker-pi-manager](../packages/maker-pi-manager/) daemon 维护持久任务、attach/detach、重启条件与空闲回收。
RPC client 不需要知道字节流来自本地 stdio 还是 SSH；但 runtime 配置、凭证、文件和包操作必须使用执行机器的语义。

### 5.2 模型、prompt、资源和 MCP

Host 提供 agent home，adapter 写原生 `models.json`、`settings.json` 和运行时文件。Cindy 模型配置可挂在自建 provider `cindy` 下，
密钥通过 env 引用；运行中还需按最终 route 刷新和查询原生状态，不能把这一配置初态当成全部有效模型。
用户原生全局约定与 Cindy runtime home 分开，Bot 等身份也有自己的资源 scope。

使用 `--append-system-prompt` 保留 Pi 原生 system prompt。原生 packages、extensions、Skill 加载是正式能力；
管理页扫描和兼容提示是投影，不能成为新的加载白名单。显式安装/更新命令按既有产品规则执行，Cindy 分析失败不能使原生能力退化。

MCP 由 [piEnvironment](../apps/desktop/src/main/mcp-integrations/piEnvironment.ts) 暴露本机 HTTP bridge，并接入配置允许的外部
HTTP/Streamable HTTP server。认证值使用专用 env，描述符只保存引用；外部旧 SSE transport 与 Streamable HTTP 的 SSE 响应帧不是一回事。
模型侧仅注册 `cindy_mcp_list_tools` 与 `cindy_mcp_call_tool` 两个稳定工具；完整目录/schema 在 bridge 内，需先查询具体工具 schema 再调用。
权限、策略和变更捕获仍按真实 `mcp__server__tool` 处理，不对外层网关笼统授权。

### 5.3 权限与原生扩展

Pi 原生不提供 Cindy 需要的逐工具审批和 OS 沙箱。Cindy 注入 `cindy-bridge` extension，在 `tool_call` 拦截，
经 `extension_ui_request` 到 adapter `handleExtensionUiRequest`，再进入统一 InteractionResolver。
权限文件按 task/session 热读，`setPermissionMode` 可更新后续调用；Auto 档由 Host 统一审阅。

Full Access 遵循原生能力，不能靠路径/命令正则声称隔离了整个进程环境和 bash。当前不是 OS 级文件/网络沙箱。
原生包管理、扩展 UI、Plan、运行命令发现各有适配；不能因为 TUI 诊断无法覆盖一种扩展便禁用其原生加载。
完整维护合同见 [Pi harness 规则](dev-rules/pi-harness.md)。

### 5.4 操作与生命周期

| 操作 | 当前机制 | 关键限制 |
|---|---|---|
| 创建／恢复 | `startSession` 准备 home/config，通过原生启动与 session 加载路径接续 | 同时校验模型与目录；不能从本机路径读取远端历史 |
| send／steer／abort | 原生 prompt/steer/abort RPC 及响应事件 | 请求超时与原生 turn 终态不同，不能重置一轮中已有 usage |
| 权限／Plan | bridge 扩展拦截；原生 plan-mode 扩展命令与 UI 适配 | 模式变更与工具授权按实际执行点生效 |
| 事件 | message/tool/compaction/extension 事件 → translator | 扩展命令目录是每个 live session 的运行时快照 |
| fork／rewind | 原生 clone/fork(entryId) 与 session tree | 对话分支与 Git 文件恢复分别实现；原生 tree 不等于 Cindy 任务列表 |
| 树导航／HTML／手动压缩 | 对应 handle 可选方法及原生 RPC/bridge | 只有能力支持且 live 数据就绪才可操作 |
| close／detach | 本地收敛 transport；远端按 daemon 合同 detach 或 close | 导航离开不能误杀需要保留的远端任务 |

原生 threshold/overflow compaction 负责日常压缩；Cindy 设置 reserveTokens 并消费压缩边界，不再另注入一套自动 compact RPC。
导航原生树后需要复验 provider/model/contextWindow，避免原生 runtime 从初始参数重建而回到旧 route。
Pi Auto Memory 将压缩内容接入 Cindy 记忆，开关对新任务生效；不与原生 JSONL 历史等同。

测试入口：[Pi tests](../packages/maker-core/src/agents/pi/__tests__/)、[Pi Host](../apps/desktop/src/main/maker-host/pi-host.ts)、
[远端 manager](../packages/maker-pi-manager/)。需覆盖 JSONL 分帧、权限热切换、真实 MCP schema/调用、原生扩展、资源发现、
树导航后的路由复验、auto compaction、远端脱离/重连。静态测试与原生 Pi 功能不退化的实际验收分别记录。

<a id="i6"></a>
## 6. DSH 接入

### 6.1 控制面、进程与协议

DSH 采用明确的两层适配：`DshAgent` 满足 Maker 合同，Main 的 `DshControlPlane` 管理受监督原生运行时。
当前本机产品路径使用固定 Helper/Supervisor 与自包含 DSH runtime，transport 为 ACP v1/stdio；
不是任意 PATH CLI，也不通过读取私有历史文件或嵌入原生 Web UI 建立控制。

```text
Main maker-host registrar
  ├─ provider / key / current owner / fixed Helper admission
  └─ task bridge router（注册任务工厂）
       └─ 每个 Cindy task 的受监督 bridge
            ├─ DshControlPlane：scope、关联、权限、命令和恢复
            ├─ DB：binding / receipt / projection / activity
            └─ Supervisor → DSH runtime → ACP

Maker → DshAgent → 注入的 DshBridgePort → 上述 Main 控制面
```

源码：[DshAgent](../packages/maker-core/src/agents/dsh/index.ts)、[bridge-port](../packages/maker-core/src/agents/dsh/bridge-port.ts)、
[control plane](../apps/desktop/src/main/maker-host/dsh-control-plane.ts)、[task router](../apps/desktop/src/main/dsh-host/task-bridge-router.ts)、
[supervised runtime](../apps/desktop/src/main/dsh-host/macos-supervised-runtime.ts)。

### 6.2 注册、配置与授权目录

1. custom-provider 中恰好一个合法 DSH runtime：`runtimes.dsh = { baseUrl: HTTPS_URL, models: [] }`；使用独立的 DSH key。
2. Main 复验当前 owner、配置 shape、route 和 key，并解析固定打包 Helper。零个/多个配置、缺 key 或非法 route 均不可用。
3. `registerDshAgentIfAvailable` 协调 in-flight 注册与替换。任务工厂注册成功不等于已发起模型请求，更不等于真实工具可用。
4. 创建具体任务时，Main 授权 cwd 与 Home/workspace bookmark，注入该任务的 DB store，启动受监督 bridge。
5. 原生 create/prompt 前复验配置与 owner；快照过期时拒绝新操作，旧 child 只允许完成必要关闭。

DSH 不是普通模型 provider：不导入三引擎 model list、价格、发现或通用 provider test。`cindy-dsh-managed` 是 runtime 占位标识。
实际 endpoint/key 只由 Main 持有并按受控环境传递；保存配置不自动赋予任意网络探测权限。

本工作树 provider CRUD 在同一配置 mutation gate 内保存并等待 Main 对账；失败不回滚已持久化配置，而是刷新安全状态并报告注册问题。
有活动任务时更换 runtime 需按既有关闭与替换协议收敛，不能注销旧对象后立刻并行启动第二套。
依据：[providerHandlers](../apps/desktop/src/main/maker-ipc/providerHandlers.ts)、
[provider-config](../apps/desktop/src/main/dsh-host/provider-config.ts)、[registrar](../apps/desktop/src/main/dsh-host/agent-registration.ts)。

### 6.3 Bridge 合同与数据所有权

| 接口或记录 | 作用 | 边界 |
|---|---|---|
| `create`／`resumeForAdapter` | 返回当前业务任务的安全回执 | adapter 不传 native session ID；Main 从 owner-scoped binding 解析 |
| `DshBridgeAgentSessionRef` | `cindySessionId`、`scopeId`、`bridgeSessionKey` | key 为 Main 生成的临时能力引用，不是 runtime ID 或模型凭证 |
| `followCommitted` | 消费按 sequence 标识的已提交 AgentEvent 数组 | 原始 ACP 与 native ID 不跨入 Maker adapter |
| `bindPermissionResolver` | 将 resolver 绑定到本次 bridge session 引用 | disposer 只撤销本次绑定；缺 resolver 必须取消/拒绝原生请求 |
| `prompt` | 发送已授权内容，返回关联 receipt 和白名单 stop reason | Main 负责 staging、协议序列化和防重放证据 |
| `cancel`／`close` | 受控取消与关闭回执 | cancel 发出不等于已收到原生终态；不明状态需 reconcile |
| binding | Cindy task 与 native identity 的持久关联 | owner、release、Home 等恢复上下文不能任意更换 |
| prompt receipt ledger | 输入分发与结果的关联和恢复依据 | 不确定已执行时不能重发 prompt |
| projection journal | 主机已接受的安全事件及提交序列 | 确保先提交再对外投影，并处理重复、过期和恢复边界 |
| activity snapshot | DSH 产品活动状态 | 标注 `cindy-dsh`，不是原生 UI 对象或 Orca record |

存储入口：[binding](../apps/desktop/src/main/localDb/dshSessionBindings.ts)、
[receipts](../apps/desktop/src/main/localDb/dshPromptReceipts.ts)、[journal](../apps/desktop/src/main/localDb/dshProjectionJournal.ts)、
[activity](../apps/desktop/src/main/localDb/dshActivitySnapshots.ts)。`DshAgent` 构造还要求明确的
`committedFollowProjection: true` 与 `promptReceiptLedger: true` admission，不能只构造一个假的 bridge 对象就开放产品入口。

### 6.4 原生操作、事件与权限

| 操作 | 当前 ACP/适配路径 | 关键限制 |
|---|---|---|
| 握手 | `initialize` | 按实际 advertised capability 判断，不从旧手册猜测 |
| 创建 | `session/new` | Main 绑定任务与授权目录，提交安全 receipt |
| 查询／恢复 | `session/list`、`session/resume` | **不是 `session/load`**；同任务、Home、binding 与 receipt 状态需满足恢复合同 |
| 发送 | `session/prompt` | stop reason 当前仅接受 `end_turn` / `cancelled` |
| 取消 | `session/cancel` notification | 需要结合实际 prompt 终态与 receipt，不把通知发送当取消已确认 |
| 关闭 | `session/close` | EOF/exit 与明确关闭结果分开，未知状态不得伪造成功 |
| 事件 | `session/update`：message/thought chunk、tool_call/update、usage_update | Main 有限翻译、关联、脱敏、journal 提交，再给 Maker |
| 权限 | `session/request_permission` | 用先到的 tool_call 关联真实名称和输入，只返回 allow-once/reject-once |
| 模型／effort | ACP client 已有 `session/set_config_option` | 存在协议能力不代表公共 `DshAgent` 选模/effort 已开放；当前 capabilities 为 not-implemented |
| fork／rewind／steer | 公共产品能力未开放 | 不使用通用 DB 复制或其他 harness 的历史恢复冒充 |

[ACP client](../packages/maker-core/src/agents/dsh/acp-client.ts) 定义实际协议；
[DSH 专题 §1.4](dev-rules/dsh-harness.md) 记录 pin tag 的能力审计。该 tag 的 image 受配置/握手控制，audio 与 embedded context 未 advertise；
session/load、fork、额外目录和若干 UI 控制并非该 ACP 面支持。MCP 的 stdio/Streamable HTTP 与旧 SSE/ACP transport 需分别判断。

当前 `DshAgent` 声明文本、图像、文件与 abort；图像/文件先由 Main staging，是否内联图像取决于握手和模型能力。
不能据此宣称真实视觉请求已验收。权限缺关联、任务已关闭或快照已过期时必须拒绝，不能将一次性准许保存成永久 grant。

### 6.5 产品入口、恢复与证据边界

本地任务可以经通用创建/发送链进入已注册 DSH。当前工作树 `DshTaskControlsPopover` 按需展示本机 runtime/activity 控件，
远程任务不显示该本机控制入口；设置保存后从 Main 刷新注册状态，不由 Renderer 决定 registry。

已实现本机同 Cindy task 的受限跨进程恢复，但不承诺完整原生历史 replay、跨设备 claim、SSH 或任意 Home 切换。
DSH activity、配置管理和 Home 访问有独立准入；不能因为基础身份能在共享 schema 中表示，就向所有远端 channel 放行。

已有 signed-Helper fixture 记录涵盖部分 lifecycle、prompt、permission、cancel、SQLite receipt/journal 和内部 MCP；
它们的版本、loopback fake provider、临时 workspace 等条件必须随结论保留。本次没有重跑这些测试。
当前 [runtime status](../apps/desktop/src/main/dsh-host/runtime-status.ts) 的运行证据仍明确为 `not-verified-in-this-app`。

测试入口：[DSH adapter tests](../packages/maker-core/src/agents/dsh/index.test.ts)、
[Main control-plane tests](../apps/desktop/src/main/maker-host/__tests__/dshControlPlane.test.ts)、
[DSH Host tests](../apps/desktop/src/main/dsh-host/__tests__/)、[本机验收手册](dev-rules/dsh-local-macos-test-manual.md)。
其余平台与真实 provider/项目、Existing Home 手工验收、完整跨端体验仍需独立证据。

<a id="i7"></a>
## 7. 四种 harness 能力与入口矩阵

### 7.1 原生机制与 Cindy 接入层

这里的“原生”只指本仓 adapter 所使用的版本/协议面，不是厂商所有产品的能力总表；上游未重新联网审计。

| 维度 | Claude Code | Codex | Pi | DSH pin ACP 面 |
|---|---|---|---|---|
| 执行控制 | SDK Query 与 CLI | app-server thread/turn | JSONL RPC | ACP new/resume/prompt/cancel/close |
| 流式事件 | SDK 消息，Cindy translator | 原生通知/delta，Cindy 显式订阅与翻译 | message/tool/extension 事件，Cindy translator | 原生 updates，Main journal 后投影 |
| 工具权限 | SDK callback + 原生权限模式 | 原生 approval requests/权限配置 | Cindy extension 增加交互检查；非原生 OS sandbox | 原生 request_permission，一次性选择 |
| 原生恢复 | SDK session/UUID | thread/history root | session JSONL/entry tree | list/resume 有；load 无 |
| 原生 fork/树 | SDK fork/消息锚点 | thread/fork；新版分页锚点 | clone/fork/entry tree | 当前 pin ACP 无 fork；不伪造 |
| 模型与 effort | SDK/运行配置适配 | thread/turn 参数与路由 | 原生 set_model/运行配置 | set_config_option 已有；公共 DshAgent 尚未开放 |
| MCP | SDK 支持，Cindy provider 直接装配 | 原生 MCP 配置，Cindy HTTP/context bridge | Cindy extension + 两个发现/调用网关 | pin 有 stdio/Streamable HTTP；Cindy 内部 lease 路径仍有限 |
| 子 Agent | 原生任务事件的适配 | 原生 collab/child thread 适配 | 原生资源/扩展与 Cindy 子 Agent 桥 | 与 Cindy activity 分开，未接 Orca Worker |

对应证据为第 3–6 节源码与 DSH pin 审计。某厂商 SDK 中不存在一项功能，与 Cindy 尚未编写对应 UI 的结论不能互换。

### 7.2 当前 adapter 声明

“接”表示源码声明支持；“未接”表示明确 not-implemented 或未暴露该可选表面；“条件”必须阅读解释。
此表是静态合同，不是通过率；**本次四家真实运行验证均未执行**。

| 能力 | Claude Code | Codex | Pi | DSH |
|---|---|---|---|---|
| 文本／图像／文件输入 | 接；看模型与路径 | 接；看模型与路径 | 接；看模型与路径 | 接；Main staging，inline image 看握手 |
| model／effort | 接 | 接 | 接 | 未接，availableModels/effortLevels 为空 |
| Fast | 接；连接/模型二次门控 | 接；连接/模型二次门控 | 接；连接/模型二次门控 | 不声明支持 |
| reasoning 展示 | off/summarized/full | off/summarized | off/full | 无通用选择列表，不等于没有 thought 事件 |
| 权限档与中途更新 | 接 | 接 | 接 | 无档位；逐请求 Main 权限 |
| 每轮强制工具策略 | 接，排除 acceptEdits/Full Access | 接，排除 Full Access | 接，排除 Full Access | 未开放通用策略合同 |
| Plan 模式 | 接 | 接 | 接 | 未开放通用 Plan 控制 |
| abort | 接 | 接 | 接 | 接；等待终态/对账 |
| same-turn steer | 接 | 接 | 接 | 未接 |
| fork／rewind | 接，原生锚点/checkpoint | 接，对话与文件分开 | 接，entry 与 Git 分开 | 未接 |
| 原生 session tree | 未暴露公共树接口 | 未暴露公共树接口 | 接 | 未暴露 |
| extraDirs／writableDirs | 接；变更可触发重建 | 接；原生权限/profile | 接；不宣称 OS 隔离 | 未接 |
| 记忆开关 | 原生 Auto Memory，默认开 | 实验性 memory，默认关 | Pi Auto Memory，默认开 | 未接 |
| 记忆中途启停 | 未接，后续启动生效 | 接，有进程级影响 | 未接，后续启动生效 | 未接 |
| 公共手动 compact 方法 | 未声明该可选能力；另有原生/自动路径 | 未声明该可选能力；另有原生压缩路径 | 接 | 未接 |
| 原生 HTML 导出 | 未声明该可选能力 | 未声明该可选能力 | 接 | 未接 |
| runtime command manifest | 非 Pi 专属表面 | 非 Pi 专属表面 | 接，live manifest 可暂未就绪 | 未开放同一表面 |

声明源码：[Claude CAPABILITIES](../packages/maker-core/src/agents/claude-code/index.ts)、
[Codex CAPABILITIES](../packages/maker-core/src/agents/codex/index.ts)、[Pi baseCapabilities](../packages/maker-core/src/agents/pi/index.ts)、
[DSH CAPABILITIES](../packages/maker-core/src/agents/dsh/index.ts)。模型目录、平台注册状态、任务来源和当前实例决定最终可操作范围。
能力表不把源码中的 `not-implemented` 擅自改成 `sdk-missing`，即使原生 pin 的另一份审计另有缺失记录。

### 7.3 产品入口与平台边界

| 入口 | Claude Code／Codex／Pi | DSH |
|---|---|---|
| 本机创建、发送、事件 UI | 接通；runtime/账号/模型需就绪 | 注册后接通；当前受监督 macOS ARM64 路径 |
| 本地任务中切换 harness | 三引擎普通任务支持发送时应用 | 排除，不可当三引擎模型路线 |
| Orca Lead/Worker | 接通，受协作策略、角色和桥接准入 | Worker 显式拒绝；activity 是独立路径 |
| 原生子 Agent 展示 | 三家已有专属事件/共享投影 | 不纳入三引擎 `AgentTaskUpdateEventData.provider` |
| Bot 模型候选链 | 三引擎配置与运行装配 | 不进入普通 Bot model chain |
| Scheduler Agent runner | 三引擎配置与执行 | 不在项目自动化引擎集合中 |
| IM 入口 | 复用任务/Bot/自动化；按渠道有附加策略和差异 | 未声明同等端到端能力，不从共享 Session 推断 |
| SSH | 三家均有实现，daemon/transport/认证不同 | 当前无等价产品链路 |
| device-link／Mobile | 统一远控与共享投影；逐 channel/能力检查 | 基础身份兼容不等于完整 UI/控制接入；不宣称完整跨端可用 |
| 本机 Home/runtime 管理 | 各家原生与 Cindy 设置合同 | Main 专用入口；本机 popover 在远程任务中隐藏 |
| 平台 | 由各自发行资产、宿主与远端条件决定 | 当前开发/证据范围 darwin-arm64，未承诺 Windows/Linux |

入口证据：[Orca Worker 类型及拒绝分支](../apps/desktop/src/main/maker-ipc/orcaWorkerCreationService.ts)、
[Bot 配置](../apps/desktop/src/shared/botCreation.ts)、[项目自动化 parser](../apps/desktop/src/main/scheduler-host/project-automation-loader.ts)、
[共享子 Agent 类型](../packages/maker-shared/src/agentTask.ts)、[device-link allowlist](../packages/device-link/src/allowlist.ts)、
[DSH 任务视图](../apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx)。

<a id="i8"></a>
## 8. 跨引擎、协作、远程与自动化

### 8.1 运行选择与任务连续性

普通本地任务的选择器先登记意图，发送事务在下一条真实输入前消费最终选择；不是每次点击就重建。
[sessionAgentSwitchHandler](../apps/desktop/src/main/maker-ipc/sessionAgentSwitchHandler.ts) 负责三引擎间选择，
[sessionRuntimeHarnessSelection](../apps/desktop/src/main/maker-ipc/sessionRuntimeHarnessSelection.ts) 还校验 generation、owner 和 pending revision。

切换顺序为：校验目标 → 查停泊引用 → 构造交接 → 关闭旧 live handle → 提交 DB 运行选择 → 记录 agent_switch 边界 →
注入 handoff → resume 或新建目标原生上下文。DB 提交之后原生启动失败应报告引擎未就绪，不能谎称整个选择事务从未发生。
切回原生停泊身份用增量交接，首次进入用全量有界交接；停泊恢复失败按既有明确分类回退，不能无限循环。

[agentHandoff](../apps/desktop/src/main/maker-ipc/agentHandoff.ts) 用代码确定性生成近期内容、早期提要和工作状态，
不为交接额外调用模型。展示正文和 wire 前缀分开；交接在 accepted 边界消费，重启恢复从持久边界重建。
上下文换窗、删消息重建与跨引擎切换复用相关原语，但触发条件和原生身份操作不能混为一套无条件重试。

### 8.2 Orca 与原生子 Agent

Orca 的 Main 侧按职责拆为 lifecycle、Worker creation、team、队列和 inter-agent dispatch。Lead 通过 `cindy_orca` MCP 或 UI 调用同一服务，
Main 校验当前 Lead/owner/team；Worker 是独立 Session，模型和权限使用 Worker 创建偏好，有独立事件与历史。
终态由 observer/auto-bridge 回传，必要时 Worker 手动调用 bridge；结果沿 Lead 既有输入协调器进入，不另造一个模型循环。

```text
Lead Session → MCP/UI → Orca service → Worker Session → worker harness
      ↑                         ↓                  ↓
  Lead 输入协调器 ← auto-bridge / 回传 ← 队列与终态观察
```

原生子 Agent 是 harness 自身创建的后台对象，经专属 adapter 观察；不一定对应 Cindy sessions 表的新行。
DSH activity 用独立快照与 provenance，也不满足 Orca Worker 的身份合同。
独立 Session 不保证文件隔离，worktree、远端 cwd 与共享目录策略要按创建代码解释。
事实源：[Orca 规则](dev-rules/orca-team-architecture.md)、[lifecycle](../apps/desktop/src/main/maker-ipc/orcaLifecycleService.ts)、
[Worker creation](../apps/desktop/src/main/maker-ipc/orcaWorkerCreationService.ts)、[team](../apps/desktop/src/main/maker-ipc/orcaTeamService.ts)。

### 8.3 SSH 和 device-link 是两套拓扑

SSH：本地 Host → 连接池/forward → 远端 transport 或 daemon → 远端 harness/文件。Claude 用 cc-manager，Pi 用 pi-manager，
Codex 用 app-server transport；MCP 可通过 remote-forward 回到本地 Host。认证、loopback 地址和文件路径必须按执行机器解释。
关闭连接、detach 任务、终止原生进程和回收 daemon 是不同动作，不能统一用 SSH 断线处理。

device-link：控制端 UI → makerTransport/mobileMakerTransport → allowlist/envelope/relay → 目标 Desktop Main → 同一本地任务链 →
result/push → 控制端投影。控制端不因连接成功获得任意 IPC，新增 channel 还需 invoke/push/topic、运行期 validator 和旧端降级。

一个 peer 不响应只恢复该 link；relay 断线才恢复整条连接。鉴权失败、业务 RPC 超时、事件订阅失效与原生进程死掉分层处理。
多 peer 验证要证明恢复一个控制端不会打断另一个控制端的任务。
源码导航：[remote-ssh](../apps/desktop/src/main/remote-ssh/)、[device-link](../packages/device-link/)、
[Desktop transport](../apps/desktop/src/renderer/lib/makerTransport.ts)、[Mobile transport](../apps/mobile/src/device-link/mobileMakerTransport.ts)。

### 8.4 Bot、Scheduler、IM、Review 和插件入口

Bot Profile、canonical Session、harness 上下文分层：更换模型/压缩不应换掉用户主时间线。
Scheduler/IM 是输入与派活来源，仍需经过来源标记、持久队列、权限和发送事务，不能直接构造一个不受管的 raw handle。
自动化脚本 runner 又是另一种执行方式，不属于新增 AgentKind。

Review 使用指定任务目的、快照和只读边界；插件工具使用 Host slot 与实际插件身份/授权。公共 adapter 可发送文字，不等于已经适配这些入口。
新增 harness 时按每个入口明确“接通”“拒绝并解释”“待实现”，不能简单扩大全仓三引擎 union。
规则入口：[Bot](product-rules/cindy-bots-runtime.md)、[Review](product-rules/review-product-direction.md)、
[插件](dev-rules/plugin-security-and-authoring.md)、[Telegram 两套 bot 差异](product-rules/telegram-bot-parity.md)。

<a id="i9"></a>
## 9. 接入一个新 harness 的完整步骤

以下是未来扩展的操作指南，**本次未新增第五种 harness 或修改任何接口**。设计应复用当前链路，不照搬某家所有专属字段。

### 9.1 阶段与完成条件

| 步骤 | 要做的具体工作 | 完成条件 |
|---|---|---|
| 1. 固定原生协议和版本 | 记录 source/artifact、启动命令、通信方式、身份、事件、权限、恢复、子 Agent 与工具能力 | 用固定版本证明每项支持/缺失；不以官网宣传代替协议证据 |
| 2. 选择控制拓扑 | SDK 或 RPC 放核心 adapter；平台进程/凭证/DB 留 Host；如需特殊控制面，注入窄接口 | 画出进程、所有权、信任和 teardown；不存在 package 反向 import Main |
| 3. 准备 runtime | 扩展受管 binary 目录/manifest/校验或复用必要的特殊 supervisor；保留 sidecar/resources | 原生 handshake 可用，离线/损坏/版本不匹配明确失败；不悄悄 fallback 别家引擎 |
| 4. 定义身份与准入 | 扩展真正需要的 AgentKind、转换/validator、registry/export；注册需等依赖就绪 | 未注册时无法创建，未知显式身份不回落为 cc，owner 变化撤销旧准入 |
| 5. 编写 adapter | 实现 startSession、完整必选 handle、vendor transport/client、translator 和 Capabilities | 能创建、发送、接收文本/工具/终态、取消、关闭；未支持动作明确报错 |
| 6. 注入模型和认证 | 选定 auth/route 策略，接入 provider 或专用 runtime 配置，校验生效账号和 endpoint | 目录显示与可执行能力一致，凭证不经不可信 wire 传递；不假设一定需要通用模型列表 |
| 7. 接工具、权限和资源 | 原生工具审批、MCP context、Skill/扩展、Plan/提问、输入附件和 prompt 追加 | 请求/决定关联正确；权限档真实可执行；工具/schema、原生加载和缓存语义保留 |
| 8. 接持久化和恢复 | 明确 business/native ID；用现有 storage 和消息管线，必要时追加 migration/binding/receipt | 重启后恢复同任务；未知已执行输入不重放；旧版本数据可升级 |
| 9. 接 IPC 与 UI | 复用 create/send/control/events；补 capabilities、选择器、状态、错误与交互呈现 | 前后端都挡不支持操作；Light/Dark 语义 token 和 i18n 按既有规则实现 |
| 10. 接横向入口 | 逐项检查模型切换、Orca、Bot、Scheduler、IM、Review、插件、SSH、Mobile | 每项有实际闭环或明确降级；不因三引擎集合报类型错就全量放行 |
| 11. 验证与发布 | 单元/协议/持久化/平台/真实 provider/多端分层验证；完善文档和版本证据 | 所声明能力有对应证据，旧能力未退化，失败可恢复，交付边界明确 |

### 9.2 必须覆盖的契约修改面

| 修改面 | 核对对象 | 避免的具体错误 |
|---|---|---|
| 公共身份 | core kind、DB/UI 映射、shared parser、IPC 枚举 | 新身份在某层变成旧默认引擎 |
| Adapter 合同 | handle 必选方法、Capabilities、事件 payload、resolver | UI 有按钮但没有执行实现；事件数据未经收窄 |
| 注册与环境 | maker-host、binary ready、owner lifecycle、remote host | runtime 缺失仍注册，或账号切换后复用旧凭证进程 |
| 模型资料 | catalog parser、运行 route、默认模型、pricing、provider UI | 只有目录记录却无协议；把 DSH 式 runtime 强行塞入模型列表 |
| 数据与恢复 | schema、增量 migration、session storage、消息/原生历史绑定、搜索/导入导出 | 改历史 migration、丢原生身份或只迁移 sessions 漏掉其他 projection |
| UI 和 IPC | create/send/控制、任务列表、消息类型、能力查询、错误码、preload | 仅前端禁用；后台入口仍能调用不支持的方法 |
| 协作与长期任务 | Orca role/Worker、native child、Bot、Scheduler、IM、Review | 混用 fork parent、Orca role 和原生 task ID |
| 跨端 | SSH daemon/transport、device-link allowlist/topics、Mobile parser/UI | 本地路径发到远端、未知 kind 错回落、旧端无可读降级 |
| 运行时升级 | manifest/sidecar/signature、原生协议/历史兼容、退出清理 | 只升级 binary 不测 parser/原生历史和后台进程 |

DB 改动追加迁移并验证旧数据，不顺手修写历史 migration。wire 变更遵守兼容合同；协议服务端是独立仓，只有授权范围内才协调修改。
新增 IPC 不能只改 TypeScript：同时核对实际 handler、preload、allowlist、push topic 和旧端行为。

### 9.3 设计时必须回答的故障问题

- 进程握手未完成、启动超时、部分初始化失败时，谁负责清理？清理未确认如何阻止重复创建？
- 用户输入是否已被原生接受？网络断开后怎样知道可重发、只能继续、还是必须显示未知？
- 用户取消、切账号、关闭任务与异步凭证读取/附件准备/权限回应同时发生时，在哪个代次边界拒绝晚到操作？
- 事件重复、乱序、后台任务跨轮次、最后 usage 晚到时，怎样避免串消息、重复计费和错误收口？
- 单任务、单 host、单远端 peer 与全应用故障分别如何恢复？有没有影响无关任务？
- 原生不支持一项功能时，能否明确表达缺失，而非模拟成功或新增一个破坏原生能力的流程？

这些答案应写入目标 harness 的维护规则和测试，不能只写进 prompt。真正的 OS 限制、回调审批与 UI 提示分别标注，禁止夸大隔离能力。

<a id="i10"></a>
## 10. 最小适配器、事件和权限示例

### 10.1 适配器结构

下面是**教学骨架**，用于展示当前真实接口的组合方式，不是可直接注册的新 harness。`NativePort`、`NativeSession` 是本节假设的协议层接口；
它们的鉴权、spawn、队列、握手、超时、状态机和清理仍需实现。`kind` 必须来自已经扩展并完成准入的 AgentKind；示例不占用现有引擎身份冒充新引擎。

```ts
import {
  BaseAgent,
  type AgentDeps,
  type AgentKind,
  type AgentSessionHandle,
  type AgentSessionTeardownOptions,
  type StartSessionOptions,
  type SendOptions,
  type UserMessage,
  type AgentEvent,
  type UsageSnapshot,
  type Capabilities,
  type InteractionResolver,
} from '@cindy/maker-core';

interface NativeSession {
  id: string; // 普通路径的原生 ID；特殊受控路径可为 Host 不透明引用
  model: string;
  send(message: UserMessage, options?: SendOptions): Promise<void>;
  steer(message: UserMessage, options?: SendOptions): Promise<void>;
  abort(): Promise<void>;
  close(options?: AgentSessionTeardownOptions): Promise<void>;
  events(): AsyncIterable<AgentEvent>; // 本例假定下面已完成协议翻译
  usage(): UsageSnapshot;
  setInteractionResolver(resolver: InteractionResolver): void;
}

interface NativePort {
  open(options: StartSessionOptions): Promise<NativeSession>;
  dispose(): Promise<void>;
}

class ExampleAgent extends BaseAgent {
  constructor(
    readonly kind: AgentKind,
    readonly capabilities: Capabilities,
    deps: AgentDeps,
    private readonly port: NativePort,
  ) {
    super(deps); // 真实 BaseAgent 会验证 binaryPath
  }

  async startSession(options: StartSessionOptions): Promise<AgentSessionHandle> {
    const native = await this.port.open(options);
    return {
      id: native.id,
      agentKind: this.kind,
      model: native.model,
      send: (message, opts) => native.send(message, opts),
      steer: (message, opts) => native.steer(message, opts),
      abort: () => native.abort(),
      close: (opts) => native.close(opts),
      events: () => native.events(),
      getUsageSnapshot: () => native.usage(),
      setInteractionResolver: (resolver) => native.setInteractionResolver(resolver),
    };
  }

  async dispose(): Promise<void> {
    await this.port.dispose();
  }
}
```

刻意没有 `setModel`、fork 或 tree 的空实现。只有 native 层实现、能力声明及调用前验证全部完成后才开放。
即使 `steer` 是 handle 必选方法，不支持时也必须抛明确错误；能力表同时标为不支持。`open` 在失败时需自行清理未发布资源，
`close` 需确认清理并让事件消费者结束；上面的转发代码不能替代这些实现。

### 10.2 有限事件翻译

本例用假设的原生事件形状演示真实 `AgentEvent` 外形，不能把 `NativeEvent` 当成任何一家现成协议。
生产实现需按目标 protocol 解析 `unknown`，保留工具 ID、增量/全文和后台归属，并接入 usage 与 terminal 去重。

```ts
type NativeEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'turn_finished'; reason: string }
  | { kind: 'failure'; message: string; terminal: boolean };

function translateExample(event: NativeEvent, source: AgentKind): AgentEvent {
  switch (event.kind) {
    case 'text_delta':
      return { type: 'text', source, data: { text: event.text, isFinal: false } };
    case 'turn_finished':
      return { type: 'done', source, data: { reason: event.reason } };
    case 'failure':
      return {
        type: 'error', source,
        data: { message: event.message, isTerminal: event.terminal },
      };
  }
}
```

`failure.terminal=false` 不能附赠 `done`；transport EOF 也不能一律转成成功完成。
原生请求响应和模型最终结果可能走不同通道，只能按对应协议选定权威终态。

### 10.3 权限请求与返回

```ts
async function decideOnce(
  resolver: InteractionResolver | undefined,
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<'allow-once' | 'reject-once'> {
  if (!resolver) return 'reject-once';
  const decision = await resolver({ kind: 'permission', requestId, toolName, input });
  if (decision.kind !== 'permission' || decision.behavior !== 'allow') return 'reject-once';
  // 本例只允许精确原请求的一次授权，不支持改参数或扩大范围。
  if (decision.updatedInput || decision.permissionUpdates?.length) return 'reject-once';
  return 'allow-once';
}
```

这是一次性权限教学示例，不是完整 DSH handler；生产环境还需 request/tool ID 映射、owner/instance 检查、
超时取消、终态后拒绝迟到决定、有效工具信息及脱敏。不得因为 resolver 返回了一个 Promise，就假定所有授权与生命周期问题已解决。

<a id="i11"></a>
## 11. 测试、验收和交付

### 11.1 必须覆盖的场景

| 层级 | 场景 | 验收依据 |
|---|---|---|
| 身份与准入 | unknown kind、未注册、缺 runtime、多个配置、owner 切换 | 明确失败；不 fallback 其他引擎，不产生半就绪业务对象 |
| Transport／协议 | 分片、连续帧、Unicode、未知消息、坏 JSON、请求关联、启动通知竞态、EOF/exit | 不丢合法内容，不错配响应，未知控制状态不假成功 |
| 输入事务 | 首次发送、冷恢复、并发同 ID、选模后发送、准备过程中取消/清空/换账号 | 只有当前有效输入执行一次；旧准备结果不修改替代输入 |
| 事件投影 | 文本增量/全文、thinking、工具配对、usage、后台事件、终态后晚到包 | 消息无重复，轮次归属正确，非终态 error 不收口 |
| 权限 | allow/deny、missing resolver、超时、重复回答、取消后回应、模式与策略冲突 | 权限落到执行点；不从前端传入 Main-only 授权 |
| 恢复与历史 | 正常 resume、原生历史缺失、fork 锚点、压缩失败、已有副作用后断线 | 无隐式重放、无错误历史截断，产品任务与原生身份保持正确关联 |
| 关闭 | turn abort、graceful stop、close、detach、startup cleanup 失败、app quit | 清理结果有证据；不杀无关任务，不遗留重复执行器 |
| 模型与认证 | 多来源同模型、临时认证、token 刷新、模型窗口变化 | 生效连接与选定来源一致；历史根不被当认证来源 |
| 工具与资源 | MCP schema/调用/身份、Skill 启停、原生扩展、图片/文件、远端路径 | 保留原生能力，真实工具身份校验，路径属于执行设备 |
| 数据与升级 | 旧 schema、旧 kind/缺字段、重启恢复、失败迁移、引用保留 | 增量兼容、不丢用户数据；特殊 runtime binding 完整 |
| 多入口 | 普通任务、Bot、Scheduler、IM、Review、Orca | 入口不越过原有权限/来源/队列合同；不支持项有明确拒绝 |
| 多端 | 本地、SSH、Desktop-to-Desktop、Mobile、多 peer、旧端 | 目标与来源正确，故障范围不扩大，未知能力安全降级 |
| 打包与实机 | binary/sidecar/resources、签名、真实 provider、真实目录、退出进程 | 安装产物上的有界交互成功；源码测试不替代本层 |

不要为追求表格全部打勾伪造外部模型行为。fixture 仅证明受测协议和主机逻辑；真实供应商、OS 权限、跨端和已安装包要分别给证据。

### 11.2 检查命令与运行范围

本次只改文档，执行：

```sh
pnpm check:dev-docs
git diff --check -- docs/architecture.md docs/multi-agent-harness-principles.md docs/multi-agent-harness-integration.md
```

另检查三份文档的本地链接、章节锚点、代码围栏、原文主题覆盖和教学代码类型结构。
`check:dev-docs` 的现有脚本主要检查已列入的工程/贡献文档与相关合同，**不会自动全面验证这三篇内容**；
因此上述独立检查不可省略。新增未跟踪文件还需直接检查文本，不能只依赖 `git diff`。

未来真正修改 harness，在提交前必须按仓库规则运行根 `pnpm test:unit:related`，并对每个受影响包执行
`pnpm --filter <package-name> run --if-present typecheck`；改到调度/依赖/Vitest/CI 等范围时回退全量门禁。
当前 `@cindy/maker-core` 没有名为 typecheck 的 script，`build` 是 `tsc --noEmit`，可作为核心改动的追加编译检查。
Desktop 启动、远端 bundles、平台与设备运行按[Desktop 开发规则](dev-rules/desktop-development.md)、
[Mobile 规则](dev-rules/mobile-development.md)、[开发工作流](dev-rules/development-workflow.md)执行。

本次没有代码提交、打包、部署或真实 runtime 验收；未执行这些代码与设备测试不应被写成通过。

### 11.3 发布和回退

新 harness 最初可以保持已知但未注册/未准入，只有目标平台和能力满足证据才开放；不是以“先接通文字”宣称完整支持。
升级 pin 时记录协议、历史格式、目录包与工具链兼容，测试既有任务恢复及同机多任务；保留可识别的旧版本和用户数据。
不能通过要求用户重装已批准插件、清空任务历史或修改原生凭证文件掩盖迁移问题。

客户端、服务端协议和 runtime 可有各自发布节奏，但不兼容 wire 变更需协调消费者与旧端降级。
DSH 当前受限本机开发范围不能外推为全平台发行；扩大平台/分发应重新满足其专项合同。

### 11.4 本次文档验证记录（2026-09-16）

| 检查 | 结果与范围 |
|---|---|
| `pnpm check:dev-docs` | 9 项通过；范围为脚本已有的工程文档合同 |
| 三篇本地链接与章节锚点 | 299 处全部可解析；不把远程 URL 可访问性计入此结果 |
| Mermaid | 4 个图均经当前安装的 Mermaid parser 解析通过；未进行图形渲染目检 |
| 教学 TypeScript | 3 段在内存中组成示例，引用当前真实 maker-core 类型；示例语法/语义诊断为 0，不代表整个 package typecheck |
| 原架构覆盖 | 原有 17 个主要主题全部保留，并新增覆盖映射 |
| 文件完整性 | 三篇围栏、行尾空白、末尾换行及限定文档 diff 检查通过；13 个既有修改文件的 SHA-256 与开始时一致 |

未执行真实 harness、provider、打包安装、数据库迁移、SSH 或 Mobile 验收。本次只更新这三份 Markdown，不提交或推送。

<a id="i12"></a>
## 12. 故障排查与源码导航

### 12.1 按现象追踪

| 现象 | 检查顺序 | 不应直接得出的结论 |
|---|---|---|
| 找不到 harness | kind/转换 → binary 或 Helper → owner/provider → registrar → listAvailableAgents → 执行端 UI | “代码被删了”或“只缺一个下拉选项” |
| 配置保存但不能创建 | durable save 与 registration 分开看；DSH 查唯一配置、key、Helper、待替换状态 | 保存成功不等于模型已连通；注册失败也不等于保存回滚 |
| 首次发送无反应 | queue/准备 → send transaction → create singleflight → protocol handshake → accepted/terminal | 只看 IPC 返回或 PID 不能证明执行 |
| 输出不显示／重复 | raw event → translator → Session generation → persistence/delivery → preload/store | 不应先改 UI；也可能是事件未被正确订阅或归属 |
| 权限卡不出现／不执行 | 原生 callback/扩展 → request ID → resolver → Main policy → 原生 response | 工具可见不等于有审批；Full Access 可能不回调 |
| 任务能看历史却不能继续 | DB timeline → native ID/history root → cwd/owner/route → resume | UI 有历史不等于原生历史完整 |
| 改模型后未生效 | pending 意图 → 实际发送 → 目标 route → 原生生效参数/必要重建 | 选择器的乐观显示不是生效证据 |
| 切回 harness 丢上下文 | parked binding → watermark → full/delta handoff → accepted 消费 → native resume | 不能直接复制另一家原始历史文件 |
| 工具或 Skill 缺失 | 原生资源发现 → 启动快照 → enabled/caller context → MCP schema → handler 准入 | 管理页存在不等于已装入当前 live session |
| Orca 无法派活 | Lead/team/协作策略 → Worker 配置 → session create → queue/dispatch → 回传 | 原生子 Agent 不等于 Orca；DSH 不在 Worker 类型内 |
| 手机/SSH 失败 | 区分拓扑 → 执行端版本/目录/认证 → allowlist 或 daemon/forward → 来源路由 | 本机端口通不代表远端目标可用 |
| 关闭后仍运行 | abort/close/detach 区别 → pending creation/cleanup → host/thread → 子进程退出 | 发出 kill/关闭通知不代表退出已确认 |
| DSH 未知执行状态 | prompt receipt → binding/Home → journal sequence → ACP terminal/EOF → reconcile | 不把网络断开当成 prompt 未执行，更不能直接重放 |

### 12.2 源码阅读顺序

| 主题 | 推荐入口与符号 |
|---|---|
| Host 总装配 | [maker-host/index](../apps/desktop/src/main/maker-host/index.ts)：`new Maker`、`registerPiAgentIfAvailable`、`registerDshAgentIfAvailable` |
| 公共身份与能力 | [common](../packages/maker-core/src/types/common.ts)、[capabilities](../packages/maker-core/src/types/capabilities.ts)、[身份映射](../apps/desktop/src/shared/agentKindConversion.ts) |
| 注册与生命周期 | [Maker](../packages/maker-core/src/maker.ts)：`createSession`、`registerAgent`、`unregisterAgent`；[BaseAgent](../packages/maker-core/src/agents/base-agent.ts) |
| 运行与交互 | [Session](../packages/maker-core/src/session.ts)：`send`、`runHostInteraction`、事件消费与 watchdog |
| 创建／发送 | [create handler](../apps/desktop/src/main/maker-ipc/sessionCreateHandler.ts)、[send transaction](../apps/desktop/src/main/maker-ipc/makerSendTransaction.ts)、[register](../apps/desktop/src/main/maker-ipc/register.ts)：`bootstrapSession` / `sendToSessionInternal` |
| 事件与 UI | [event pipeline](../apps/desktop/src/main/maker-ipc/sessionEventPipeline.ts)、[preload](../apps/desktop/src/preload/preload.ts)、[chat store](../apps/desktop/src/renderer/lib/makerChatStore.ts) |
| Claude／Codex／Pi | [Claude](../packages/maker-core/src/agents/claude-code/index.ts)、[Codex](../packages/maker-core/src/agents/codex/index.ts)、[Pi](../packages/maker-core/src/agents/pi/index.ts)；同目录 translator 与 tests |
| DSH | [adapter](../packages/maker-core/src/agents/dsh/index.ts)、[bridge port](../packages/maker-core/src/agents/dsh/bridge-port.ts)、[Main control plane](../apps/desktop/src/main/maker-host/dsh-control-plane.ts)、[Host](../apps/desktop/src/main/dsh-host/) |
| 路由与交接 | [model providers](../packages/model-providers/)、[agent switch](../apps/desktop/src/main/maker-ipc/sessionAgentSwitchHandler.ts)、[handoff](../apps/desktop/src/main/maker-ipc/agentHandoff.ts) |
| 扩展与工具 | [McpProvider](../packages/maker-core/src/interfaces/mcp-provider.ts)、[MCP integrations](../apps/desktop/src/main/mcp-integrations/)、[SkillHub](../apps/desktop/src/main/skillhub/)、[插件发现](ghost-progressive-discovery.md) |
| 远程与协作 | [Orca 规则](dev-rules/orca-team-architecture.md)、[remote SSH](../apps/desktop/src/main/remote-ssh/)、[device-link](../packages/device-link/) |
| 完整模块覆盖 | [架构覆盖映射](architecture.md#architecture-coverage) |

### 12.3 本文的验证边界

本文没有将已知的能力缺口当作功能修复，也没有扩展 DSH、修改原生 prompt 或重新发布 runtime。
仍需真实运行证据的主要部分是：当前安装产物与 pin 一致性、真实 provider 和实际请求身份、用户工作目录权限与工具、
跨进程历史恢复、原生扩展使用、SSH 与多 peer/device-link、Mobile UI，以及 DSH 的完整产品链路。
后续版本变更应按本篇维度更新三份文档和对应能力矩阵，而不是只替换顶层版本号。
