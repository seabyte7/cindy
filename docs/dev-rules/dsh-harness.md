# DSH harness 接入方案（DeepSeek Harness）

> **状态：已审计、未准入、代码尚未实施。** 本文是把
> [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
> 接成 Cindy 第四个 Agent harness 的施工正本。它不是“方案已定稿”：在下列准入
> 证据齐备并由维护者确认前，不得把 DSH 注册为可用 Agent，也不得把本文列出的后续能力
> 当成已支持。
>
> 本次审计：2026-09-02。原调查同时写了 npm `0.1.2-alpha.4` 和 PyPI runtime wheel
> `0.1.2a3`，但两者不是可互换的版本标识；每次实施必须重新以**实际下载的 wheel、其
> SHA-256、可执行文件 `--version` 和 ACP 握手**建立同一份 release evidence packet。
> 不能以 `master` 文档、npm 标签或“同名 alpha”推定随包运行时的能力。
>
> 未准入 ≠ 上游不支持。[§1.4](#14-源码取证pin-tag-上的真实协议面) 是按 tag
> `dsh-v0.1.2-alpha.4` **读源码**得到的真实协议面，用于区分「Cindy 还没验收」与
> 「上游确实没有」；把前者写成后者会永久搁置实际可用的能力，见 [§5](#5-mvp-能力合同)
> 的三状态定义。

## 目录

- [1. 审计结论与已定边界](#1-审计结论与已定边界)
- [2. 准入证据包](#2-准入证据包)
- [3. 受控运行时与安全边界](#3-受控运行时与安全边界)
- [4. 施工阶段](#4-施工阶段)
- [5. MVP 能力合同](#5-mvp-能力合同)
- [6. 风险、跨端与发布](#6-风险跨端与发布)
- [7. 验证与合入门禁](#7-验证与合入门禁)

-----

## 1. 审计结论与已定边界

### 1.1 结论

以下四项是原方案的缺陷，已改正为实施前门禁。**注意 P0-1 的改法**：缺陷是「未验收就写成
既定」，不是「上游不支持」；把两者混为一谈会造出反向错误，见 §1.4。

| 级别 | 原方案的问题 | 审计结论 / 处理 |
|---|---|---|
| P0 | 将 ACP 的 MCP、图片、流式 thought/tool/usage、会话恢复、模型/effort 热切换写成**既定**能力 | 源码取证（§1.4）显示这些能力在 pin tag 上**确实存在**，所以问题不是「上游不支持」，而是「未经本仓验收就写成既定」。处理：状态一律为**候选**，由 Gate A 的真二进制实测逐项转正；实测不通过就收缩。不得反过来把未验证写成上游拒绝。 |
| P0 | 以 npm alpha 和 PyPI wheel 混合描述一个“官方运行时” | Cindy 只能分发经审阅、pin、完整性校验的 PyPI wheel payload；npm 包、源码 checkout、系统 Node 和用户全局 `dsh` 都不在生产启动链中。二者版本对应关系必须有上游制品证据。 |
| P0 | 在 profile patch 中追加 Cindy persona / harness 身份 | 这会进入模型 system prompt，命中 [`maker-core-and-agent-behavior.md`](maker-core-and-agent-behavior.md) §4。MVP 禁止新增该文本；若以后确有必要，必须先取得维护者对文本、行为影响和缓存影响的明确确认，并单独 PR。 |
| P1 | 直接复用 Pi 的三档权限、MCP bridge、远程与 mobile 路径 | 真正的差异不在「是否逐工具」（dsh 是逐工具，见 §1.4-3），而在**档位不可会话内热切**（§3.4）与远程 / mobile 路径完全未设计。未验证前只提供受限的本机 MVP，不借 Pi 的能力名称宣称等价。 |

**已定裁决**：协议优先 ACP；运行时优先官方自包含可执行；DB 新值为 `'dsh'`；类型
收敛单独 PR；首版 per-session 一个 dsh 进程。上述裁决不表示 ACP 扩展能力已获准。

### 1.2 MVP 的明确范围

- 仅本机 Desktop。SSH remote、在远程工作目录执行、远程 runtime 分发、远程凭证落盘、
  mobile 专属入口与 device-link 新 wire 均不属于 MVP。
- 仅由 Cindy 启动、Cindy 管理的 dsh；不读取、合并、迁移或修改 `~/.dsh`，也不调用用户
  PATH 中的 `dsh`。
- 仅文字对话、一个 in-flight prompt、已确认的最终文本、cancel，以及经验证的**逐工具调用
  一次性审批**（allow-once / reject-once，见 §3.4）。任何未经 Gate A 转正的能力都必须在
  `Capabilities` 中返回不可用，UI 不得露出入口。
- Cindy DB 仍是产品消息与会话列表的真相源。除非恢复门禁通过，dsh 原生 session id 只作
  运行期诊断，不可作为重启后的恢复承诺。

### 1.3 ACP 选择

dsh 的 SDK JSON-RPC 缺少 Cindy 所需的 cancel / permission 交互面，所以协议只能是 ACP。
ACP 是自动化传输，不是为 Cindy UI 设计的完整事件协议 —— 但这不等于它的协议面很小，
实际面见 §1.4。

不依赖“dsh 自身也依赖某版 `@agentclientprotocol/sdk`”。Cindy 客户端的 ACP SDK 必须在
`packages/maker-core/package.json` 显式精确 pin、进入 lockfile 和第三方声明；选择的版本
以已验收 wheel 的 ACP v1 wire compatibility 为准。（参考：pin tag 的
`packages/acp/acp/package.json` 用 `@agentclientprotocol/sdk` `1.4.0`，服务端用什么版本
不构成客户端 pin 的理由，只是兼容性起点。）

### 1.4 源码取证：pin tag 上的真实协议面

> 取证对象：上游 tag `dsh-v0.1.2-alpha.4`（即拟 pin 的 alpha 线），读的是源码不是
> `master` 文档。**下列结论只对该 tag 成立**，升级 pin 必须按 §2 重新取证。

**1. `initialize` 实际 advertise 的 capability**（`packages/acp/acp/src/index.ts`）：

```ts
agentCapabilities: {
  mcpCapabilities: { http: true },
  promptCapabilities: { image: imagePromptEnabled, audio: false, embeddedContext: false },
  sessionCapabilities: { close: {}, list: {}, resume: {} },
}
```

**2. 实际发出的 `session/update` 类型**（`packages/acp/acp/src/updates.ts`）：
`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`usage_update`。
其中 `tool_call` 携带 `toolCallId`、`title`（= 工具名）、`kind: 'other'`（恒定）、
`status: 'in_progress'`、`rawInput`（= 解析后的工具参数）。

**3. permission 是逐工具调用审批，不是「一次性 sandbox 升级」**（同 `index.ts`）：
服务端在 `approval/request` 上挂钩，`toolCall: { toolCallId: callId }`，
`options` 只有 `allow-once` / `reject-once`（**没有 `allow_always`**）。请求前显式
`await record.drainUpdates()` —— 这是**排序保证**：带工具名与参数的 `tool_call` update
必定先于 permission request 送达，client 按 `toolCallId` 关联即可拿到完整上下文。

**4. 真正不支持的清单**（ACP README 原文）：`session/load`、deletion、fork、
additional directories、**SSE 或 ACP-transport** 形态的 MCP、modes、commands、plans、
terminals、client filesystem operations、elicitation。

> ⚠️ 三个高频误读，写进本节以免再犯：
> **`session/load` ≠ `session/list` / `session/resume`** —— 前者不支持，后两者由
> `sessionCapabilities` 明确支持；
> **「SSE / ACP-transport MCP 不支持」≠「MCP 不支持」** —— stdio 与 Streamable HTTP 都支持；
> **`session/set_config_option` 存在** —— 可改 `model` 与 `reasoning_effort`。

**结论**：ACP 面覆盖 Cindy 的核心需求。所有相关能力的准入前状态是**候选**（未验收），
不是**禁用**（上游不支持）。两者的区别是：候选由 Gate A 实测转正，禁用需要推翻上游契约。

-----

## 2. 准入证据包

每次升级或首次接入都必须把下列内容作为可 review 的 release evidence packet。任一项缺失：
`optionalAsset` 路径保持不可用；不得静默退回其他 dsh 来源。

1. **版本对应**：写出 PyPI PEP 440 wheel 版本、文件名、URL、大小、SHA-256、目标平台和
   `dsh --version` 输出；如果还引用 npm / Git tag，必须有上游发布元数据证明它与该 wheel
   是同一源码/功能线。禁止由相似的 alpha 名称推定。
2. **完整制品**：在干净临时目录下载 wheel，先用 review 已 pin 的 SHA-256 校验，再解包并
   核验主可执行、`-rg` 与 macOS `-spawn-helper`（如适用）及完整目录 manifest。拒绝 zip
   路径穿越、symlink、特殊文件、缺旁车、额外顶层运行时或不可执行主文件。
3. **实际协议探针**：用该主可执行、空的 Cindy 管理 `DSH_HOME`、非项目 launcher `cwd`
   启动 ACP；保存已脱敏的 initialize response、支持的 capability / config option、一次
   `session/new`、文字 prompt、cancel、permission request 和关闭过程。不能只测
   `--help` 或只测 initialize。
4. **能力 fixture**：对准备打开的每个能力，保存最小的 request / response / update fixture
   与预期失败 fixture。未知 enum、缺字段、乱序 update、重复 done、stdout 杂讯与进程异常
   必须由 adapter 拒绝或确定性收口，不能猜测成功。
5. **供应链与平台**：支持矩阵是 `linux-x64`、`linux-arm64`、`darwin-arm64`、`win32-x64`；
   `darwin-x64`、`win32-arm64` 与任何未发布的 libc 变体均为不支持并静默不注册。每个支持
   发布 runner 至少跑 `--version`、ACP handshake 和关闭 smoke；不能以本机 macOS 成功替代
   Windows / Linux 证据。

[官方 PyPI runtime 说明](https://pypi.org/project/deepseek-harness-runtime-bin/)
表明 wheel 自带可执行和 sidecar、要求非空 `DSH_HOME`，且不发布 Intel macOS / Windows ARM64。
它也说明 wheel 仅是分发形式；这不自动证明任何 ACP 扩展能力。

-----

## 3. 受控运行时与安全边界

### 3.1 运行时分发

- 新增 `tools/dsh/latest.json` 与 `tools/dsh/update.mjs`，形态参照 `tools/pi/`，但输入是
  **已审阅 wheel pin**，不是运行时查询到什么就接受什么。`latest.json` 至少保存每平台
  wheel filename、URL、SHA-256、size、wheel version、可执行相对路径、sidecar 清单和
  完整目录 manifest hash。
- `update.mjs` 在 staging 解 wheel、复核上述清单后才生成 Cindy CDN 的 `tar.gz`。CDN 下载
  时先校验 tar.gz SHA-256，再校验解压后的完整目录 manifest；只校验主可执行不够。正式
  安装包不内置 dsh。
- `VendorKey` / `AgentBinaryKind` 增 `'dsh'`，配置使用 `tar-gz-dir`、`installSubdir: 'dsh'`
  和 `optionalAsset: true`。manifest 缺资产、完整性失败、版本探针失败或准备超时都只使 dsh
  本次不可用，不得阻塞 Cindy 启动，也不得执行系统下载器、npm、pnpm、pip 或 curl 兜底。
- 自包含可执行是生产唯一启动形态。Cindy 正式包 `RunAsNode=false`，禁止以
  `ELECTRON_RUN_AS_NODE=1`、`process.execPath`、npm `bin.js` 或用户 Node 运行 dsh。

### 3.2 `DSH_HOME`、profile 与环境

DSH profile 和 patch 是可执行配置：上游可从 home / invocation directory 读取环境层，patch
还可能包含 `!!js`。因此它们不是普通“用户偏好文件”。

- 仅 Main 在显式初始化后创建目录。持久 root 位于
  `app.getPath('userData')/dsh-agent-home`；临时 run / staging 位于任务专属 temp 目录。
  共享 package 只接收 host 注入的路径。不得用 `process.cwd()`、仓库、`~/.dsh` 或 Renderer
  传入路径作为回退，测试只能用 `mkdtemp` 的假 home。
- `DSH_HOME` 必须显式指向 Cindy 管理 root；child process 的**启动 cwd** 必须是 Cindy 管理的
  空 runtime 目录，不能是用户项目，从而避免 launcher 扫入项目 `.env`。ACP `session/new.cwd`
  才是经验证、绝对化后的工作目录。实现前须以随包版本验证没有第二条 workspace `.env` /
  profile 发现路径；验证不了就不启动。
- MVP profile 是应用拥有的最小、版本化组合。不得读取、合并或运行用户 profile / plugin，
  不允许 `dsh plugin`、自动安装、外部 bundle、profile live reload 或用户可写的 module
  resolution。每次启动使用不可变的配置快照；不得在并发 session 间改写共享
  `profiles/cindy-acp/cordis.patch.yml`。
- 运行时生成物必须原子写入、最小权限，失败 / cancel / close 回收临时配置。若原生会话持久化
  要跨重启保留，需另列数据格式、锁、损坏恢复、并发同 session 和清理生命周期；在恢复 gate
  通过前，禁止宣称 `session/resume`。
- MVP 不追加 Cindy system prompt / persona，也不通过 prompt 修补界面身份。Cindy 自己的
  vendor 标签和 Agent 名称由类型映射确定；任何进入模型 system 段的内容遵守
  [`maker-core-and-agent-behavior.md`](maker-core-and-agent-behavior.md) §4 的先确认门禁。

### 3.3 凭证、模型和日志

- API key / bearer header 只由 Main 从既有安全 credential store 取出，短时进入 child env。
  profile 仅可保存 env **变量名**（例如 `CINDY_DSH_API_KEY`），不得保存值、完整鉴权 header、
  URL query 凭证或可复用 token。不得传入 Renderer、argv、DB、profile、fixture、stderr、
  telemetry 或 debug log。
- 子进程 env 必须白名单继承：必需的平台运行变量 + Cindy 精确注入的 proxy / 模型凭证。
  不得把 `process.env` 原样扩散给 agent / shell；尤其不得让 DSH 通过项目 `.env` 获得 Cindy
  之外的秘密。账户切换、启动失败、close、quit 都必须清理 env-file / 临时材料并确认进程退出。
- 模型路由可复用 `catalog-to-descriptors.ts` 的**派生原则**，不能直接假定 Pi
  `models.json` 与 dsh Cordis patch 同构。每个 route 的 protocol、base URL、model id、reasoning
  映射和 auth 注入都需由真实 dsh 轮次验证；明确 BYOM 解析失败时 fail closed，绝不换到 Cindy
  gateway。禁止双重协议转码。
- ACP stdout 只能出现 NDJSON JSON-RPC。所有诊断进现有 logger / stderr，并经过脱敏；adapter
  只保留有界、脱敏 stderr 尾巴。profile assembly、环境与错误路径都要测试“无 secret、无 stdout
  杂讯”。

### 3.4 权限、MCP 与生命周期

**权限模型（依据 §1.4-3 的源码取证）**

- `session/request_permission` 是**逐工具调用**的一次性审批，不是 sandbox 范围升级。
  request 本身只带 `toolCallId`，工具名与参数在此前的 `tool_call` update 里；服务端在发
  request 前 `await drainUpdates()`，保证该 update 已送达。
- **不变量（关联失败即 fail closed）**：adapter 必须维护 `toolCallId → { title, rawInput }`
  的会话内映射。收到 permission request 时**关联不到**对应 `tool_call`（乱序、丢失、
  id 未知、映射已被清理）一律按拒绝处理，不得以「没有上下文」为由放行，也不得凭空构造
  一个工具名交给 `auto-review`。该分支必须有专门测试。
- **`tool_call.kind` 恒为 `'other'`**，dsh 不提供语义分类。`auto-review` 只能自己从
  `title` + `rawInput` 分类（与 Pi 同路径，复用 `agents/shared/auto-review.ts`）。
  **禁止读 `kind` 做分流** —— 它永远返回 `other`，任何基于它的分支都是死代码或误判。
- **只有 `allow-once` / `reject-once`，没有 `allow_always`**。因此 Cindy 的
  `bypassPermissions` 只能实现成「每次自动回 allow-once」，不能声称拿到了持久授权；
  上游随时可能对同一工具再次询问，UI 与日志不得表现为「已永久放行」。
- **档位不可会话内热切（真实限制，与 Pi 不同）**：dsh 的权限档来自 base bundle 的
  `dsh-permission-presets`（三档：`read-only`+`ask` / `workspace-write`+`ask` /
  `danger-full-access`+`never`），而 `session/set_config_option` 只 advertise `model` 与
  `reasoning_effort` —— **preset 不是 config option**。所以档位只能在建会话时由 profile
  变体固定：`capabilities.setPermissionModeMidSession` 必须声明为**不支持**，UI 的
  会话内权限档切换入口对 dsh 隐藏。
- `[ask, auto, bypassPermissions]` 的顺序不变量在三档逐项验证通过后才能采用；未验证前
  只暴露最严的 `ask`，且 scheduler 不得以 dsh 无人值守运行。绝不因为 Pi 有此顺序而复制。
- **加分项，但别当成已交付**：dsh base bundle 自带 OS 级 sandbox
  （`dsh-sandbox-local` / `bash-sandbox` / `pwsh-sandbox`），这是 Pi 至今没有的真实隔离
  （见 [`pi-harness.md`](pi-harness.md) 关于「真正的强隔离需要 OS 级手段，本阶段未接入」
  的说明）。但 Cindy 尚未验证其在受管 profile 下的实际生效范围，**不得对用户宣称 dsh
  会话已被 OS 沙箱保护**，直到有实测证据。

**MCP 与生命周期**

- MVP 不传 `mcpServers`。§1.4-1 显示 pin tag 的 `initialize` advertise
  `mcpCapabilities: { http: true }`（stdio 为 ACP 基线形态，SSE / ACP-transport 不支持），
  即协议侧具备条件；不开放的原因是 **Cindy 侧的安全合同未就绪**，不是上游不支持。在
  Cindy 侧安全 gate 通过前，`dshEnvironment.ts` 与 `codexHttpBridge` 均不创建。
- **上游不替 Cindy 把 transport 安全关**：`packages/acp/acp/src/mcp.ts` 只接受 `stdio`
  与 `http`（streamable-http）、拒绝其余 transport，但 `assertHttpUrl` **同时放行
  `http:` 与 `https:`**，没有 loopback 例外规则。因此「外部 MCP 必须 HTTPS、只有明确
  loopback 才可用 HTTP」这条约束（Pi 侧已有，见 [`pi-harness.md`](pi-harness.md)）
  必须由 Cindy 在传入 `mcpServers` 前自己执行，不能指望 dsh 拦。将来开放时，server 只能来自 Main 的
  `dshEnvironment.ts` 与 `codexHttpBridge` 均不创建。将来开放时，server 只能来自 Main 的
  allowlisted factory；不得接受 Renderer 的 command、args、headers 或 URL；必须有 loopback
  绑定、per-session token、session-instance 路由、register-before-spawn、代次安全的
  unregister、关闭 lease 和账号边界 teardown。外部 HTTP MCP 还须遵守其既有凭证与 URL
  allowlist，不得因 DSH 绕过。
- per-session 进程的 close / abort / account sweep 必须幂等且有界：先停止 prompt，再关 ACP，
  再 TERM / 有界 KILL，并只在确认退出后清理材料。启动半途失败也必须纳入同一收口；不能因
  进程已不可观察就把会话写成可恢复或已安全退出。

-----

## 4. 施工阶段

### Gate A：先建立证据，不写产品路径

完成第 2 节 release evidence packet、无 key real-loader subprocess 测试和本节的 profile /
环境安全测试。若实际 ACP 能力比保守基线更少，MVP 继续收缩；若更多，也必须按第 5 节逐项
开放，不能在一个 PR 顺手打开。

### 阶段 0：类型收敛（独立 PR，零行为变更）

把 inline union 收敛到 `packages/maker-core/src/types/common.ts` 的 `AgentKind` 及
`apps/desktop/src/shared/agentKindConversion.ts` 的 `MakerAgentKindWire` / `DbAgentKind`。
`dsh` 在两侧同名，不引入缩写映射。

- 先产出全仓 inventory：联合类型、二元 ternary、switch default、数据库 JSON decoder、
  scheduler、Orca、search、renderer state、mobile projection、IPC / device-link payload。
  不以“含 pi 的文件数”代替实际调用点清单。
- conversion module 是唯一双向映射。历史的 `null` / `cc` 兼容可保留；新的 dsh 输入、未知
  值与二元 fallback 必须逐一审计，不能把 dsh 或非法值默默归为 Claude Code。
- 该 PR 不新增二进制、UI 选项、DB 值或运行时注册；用 exhaustive compile-time test 和现有
  行为 fixture 证明“零行为变更”。

### 阶段 1：AgentKind、DB 与受管二进制

- `AgentKind`、model-provider、scheduler、MCP / remote 相关声明按 inventory 增 `'dsh'`。
  `sessions.agent_kind` 等无 SQLite CHECK 的字段、以及 schema 中 four 处类型 enum 都逐项核对。
  Drizzle SQLite enum 是类型提示而非 DDL 约束，因此“无需 migration”只能在确认没有数据迁移、
  CHECK、companion、历史 parser 或跨端 validator 后成立；结论须运行
  `db:validate` 和 `test:migration-replay` 证明，不能修改历史 migration。
- 实现第 3.1 节受管二进制链、可选启动准备与 platform downgrade。`getReadyBinaryPath('dsh')`
  只能返回本次 prepare 成功验证的路径；不回落用户安装、旧缓存或未经本轮验收的目录。
- 新增 binary distribution、wheel extraction / manifest、unsupported platform、CDN failure
  和 sidecar 缺失测试；同步 lockfile、第三方 notices 与依赖方向检查。

### 阶段 2：最小 `DshAgent`（`packages/maker-core/src/agents/dsh/`）

| 文件 | MVP 职责 |
|---|---|
| `acp-client.ts` | 受控 stdio transport、结构校验、连接 / request timeout、脱敏且有界的 stderr、EOF / exit 收口；stdout 非协议内容立即失败。 |
| `translator.ts` | 仅把已验收的 committed text、permission request、cancel / terminal status 映射为已有 `AgentEvent`；未知 update 不伪造 tool / thinking / usage。 |
| `profile-assembly.ts` | 从随包、版本化模板物化不可变 Cindy-owned profile snapshot；无 user profile、无 live reload、无 system prompt 追加。 |
| `index.ts` | `DshAgent extends BaseAgent`：spawn → initialize → new text session → prompt / cancel / close；不实现 resume、setModel、setEffort、MCP 或 multimodal，直到对应 gate 通过。 |

每个 `session/new.cwd` 必须为绝对路径、经现有工作目录授权路径验证。dsh 的 launcher cwd 与
session cwd 分离，前者永远不是用户项目。启动返回的原生 session id 要长度 / 控制字符校验，
但在恢复证据通过前不得写入 Cindy 的 resume identity。

### 阶段 3：Desktop host（本机实验入口）

- 新增 `dsh-host.ts` 与 `buildDshAgentForDesktop()`；只有已受管准备成功、release evidence
  与 minimal profile 初始化都成功时才注册 `makerAgents.dsh`。失败只记录脱敏诊断并不注册。
- 解析 DSH home、credential / proxy、model route、process registry 和账号 / quit teardown 全部
  留在 Main；`maker-core` 通过依赖注入接收能力，不能反向 import Desktop。
- DSH 会话在 SSH remote workdir 上必须拒绝而非落到本机执行。将来支持 remote 必须独立设计
  runtime 安装、持久 home、远程安全凭证、MCP tunnel、断链 attach 和 recovery；遵守
  [`remote-and-mobile-adaptation.md`](remote-and-mobile-adaptation.md) 的三种形态检查。

### 阶段 4：身份与界面（单独 PR）

完成类型 inventory 后才逐项接入 Desktop 与 mobile projection。任何
`x === 'codex' ? 'codex' : 'claude-code'` 或默认 Claude 的二元判断都必须变为显式、
穷尽的映射，并以测试覆盖 dsh。

- 覆盖 session / draft / model selector / favorites / search / schedule / issue metadata / process
  monitor / agent switch 与 mobile 的既有会话投影；不支持的能力不展示成可点选项。
- 文案使用五种 locale：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`。先查询
  [`i18n/GLOSSARY.md`](../../i18n/GLOSSARY.md)；“Harness” 已有术语规则，缺少的公开名称先以
  `status: "proposed"` 加入 `i18n/glossary.json` 再讨论。
- 图标名称、素材许可和使用范围必须有 DeepSeek 的可复核授权；未获得时用 Cindy 的中性
  harness 标识，不得擅用上游品牌。所有 UI 同时实现 Light / Dark，颜色只走语义 token，
  并遵守 [`../design-rules/DESIGN.md`](../design-rules/DESIGN.md)。
- mobile 是否可看、可切换或需隐藏由 device-link / mobile 实际契约决定。新增 agent kind
  进入共享 wire、allowlist 或服务端校验时，先按
  [`protocol-compatibility.md`](protocol-compatibility.md) 与服务端仓协调；旧端的降级或隐藏
  路径必须明确，不可只靠 TypeScript 编译通过。

-----

## 5. MVP 能力合同

`CapabilityStatus` 必须来自本次 release evidence packet 与 runtime handshake；它不是产品愿望
清单。未转正的能力不进入 UI / scheduler。

**三种状态必须区分，不能混用**：

- **候选**：§1.4 已在 pin tag 源码中证实协议支持，等 Gate A 实测 + Cindy 侧合同转正。
  未转正期间 `CapabilityStatus` 用 `{ supported: false, reason: 'not-implemented' }`。
- **上游不支持**：§1.4-4 的清单，用 `{ supported: false, reason: 'sdk-missing' }`。
- **Cindy 侧未就绪**：协议支持但 Cindy 的安全 / 事件 / UI 合同没写完（如 MCP），
  用 `not-implemented`，并在本表注明阻塞项。

把「候选」或「Cindy 侧未就绪」标成 `sdk-missing` 是**错误声明** —— 它会让后续维护者
以为需要推翻上游契约才能开启，从而永久搁置一个实际可用的能力。

| 能力 | MVP 状态 | 说明 |
|---|---|---|
| text prompt / committed final text | 候选 enabled | 不把最终文本伪装成 token delta。 |
| abort | 候选 enabled | `session/cancel` 确认成功且 terminal 收口可测后开放。 |
| 逐工具一次性审批（`ask`） | 候选 enabled | `toolCallId` 关联失败即拒绝；拒绝 / 超时 / 断线 fail closed。见 §3.4 |
| tool 生命周期、thinking、usage | **候选**（协议已证实，§1.4-2） | `tool_call` / `tool_call_update` / `agent_thought_chunk` / `usage_update` 真实存在。转正条件：fixture 覆盖乱序、重复 terminal、未知字段。**不得**从 durable log / stderr 补造事件 |
| model / effort 切换 | **候选**（协议已证实，§1.4-1） | `session/set_config_option` 存在。转正条件：真轮次证明 route 生效 + BYOM 解析失败 fail closed |
| image | **候选**（条件性，§1.4-1） | `promptCapabilities.image` 由服务端按 provider/model 动态决定，**必须现读握手结果**，不得静态假定。file / resource link 另算 |
| list / resume / close | **候选**（协议已证实，§1.4-1） | `sessionCapabilities` 声明支持。开放仍须过 §5 的恢复 gate |
| MCP（stdio / Streamable HTTP） | Cindy 侧未就绪 | 协议支持（`mcpCapabilities.http`）；阻塞项是 Cindy 的 bridge 安全合同，见 §3.4 |
| `session/load`、fork、additional directories、SSE / ACP-transport MCP、modes、commands、plans、terminals、elicitation | **上游不支持**（`sdk-missing`，§1.4-4） | 需推翻上游契约才可能改变 |
| rewind / session tree / compact / export HTML | 上游不支持 | 无对应 ACP 面 |
| same-turn steer | 上游不支持 | 每 session 只允许一个 in-flight prompt |
| `setPermissionModeMidSession` | **上游不支持** | preset 不是 config option，档位只能建会话时固定，见 §3.4 |
| `auto` / `bypassPermissions`、scheduler 无人值守 | 候选，未验证前禁用 | `bypassPermissions` 只能是「每次自动 allow-once」，不是持久授权 |
| OS 级 sandbox 保护 | 候选，**不得对用户宣称** | dsh 自带 sandbox 插件，受管 profile 下的实际生效范围未验证 |

**恢复 gate**：只有在进程 A 创建会话并成功完成一轮、关闭 / 异常退出、进程 B 用同一受控
home 恢复、再完成一轮且历史、权限、模型、并发独占、损坏日志和 cleanup 都符合预期后，才可
持久化 dsh resume identity。失败、缺文件或不确定时新建 Cindy 会话 / 明示不可恢复，绝不把
旧 session id 指向新鲜原生会话。

-----

## 6. 风险、跨端与发布

| 风险 | 处置 |
|---|---|
| alpha / ACP 破坏性变更 | 每次 pin 升级重跑第 2 节 evidence packet 与完整 real-binary integration；握手不兼容即本次不注册。 |
| 运行时供应链 / sidecar 丢失 | wheel pin + archive hash + extracted-tree manifest 三层验证；绝不使用系统 / 用户 runtime fallback。 |
| profile 是可执行配置 | Cindy-owned、不可变、无用户 plugin / patch / live reload；profile / launcher cwd 与工作目录隔离。 |
| 凭证或工作区 `.env` 泄露 | Main 安全 store + 最小 env 白名单 + 非项目 launcher cwd；无 argv / file / log secret；账户边界清理。 |
| 约 70–78 MB 的 runtime payload + per-session 进程 | 前者是单份受管下载 / 磁盘体积，不得误报成每会话重复下载；后者的实际内存和启动成本必须在 process monitor、资源上限、终止确认和启动 / 退出压测中测量。**per-session 是 Cindy 的产品选择，不是协议限制** —— ACP 单连接本就支持多 session 并发（§1.4），选 per-session 是为了对齐 CC / Codex / Pi 的 teardown 与账号边界语义。“单连接多 session”将来是独立生命周期设计，不是优化补丁。 |
| MCP 或权限扩权 | 默认关闭；需要单独 threat review，不能因为上游后来接受字段就自动开放。 |
| 远程 / mobile 不一致 | MVP 明确拒绝 SSH remote；device-link / mobile 走已验证的兼容投影，否则隐藏。任何 wire 改动需要服务端协同。 |
| 区域和端点 | 若 dsh runtime、CDN manifest、provider 默认或 UI 出现 `cn` / `global` 分支，先遵守 [`../product-rules/region-and-editions.md`](../product-rules/region-and-editions.md)：无明确区域的默认是 global，且不能让用户在应用中选择发行版本。 |

-----

## 7. 验证与合入门禁

除根 `AGENTS.md` 的提交门禁外，DSH PR 必须按触及范围阅读并满足
`maker-core-and-agent-behavior.md`、`credentials-and-local-storage.md`、
`electron-security-and-process-boundaries.md`、`database-and-migrations.md`、
`configuration-and-overrides.md`、`remote-and-mobile-adaptation.md`、
`protocol-compatibility.md`、设计和 i18n 规则。触及 system prompt 必须先获维护者确认。

每个提交前至少运行：

- `pnpm test:unit:related`
- 每个受影响 package 的 `pnpm --filter <name> run --if-present typecheck`
- 二进制 / Main / DB 改动对应的定向 Vitest；schema 变动另跑
  `pnpm --filter desktop db:validate` 与 `pnpm --filter desktop test:migration-replay`
- 文案改动另跑 `pnpm check:i18n` 与 `pnpm check:i18n-glossary`；提交前 `pnpm check:dco`

必须新增或更新的测试：

1. **运行时供应链**：wheel pin、解包防御、sidecar / tree manifest、CDN hash、unsupported
   platform、optional asset 失败、绝不 fallback 到 PATH / npm / user dsh。
2. **真实 ACP subprocess**：无 key 的真实 loader 路径覆盖 initialize、new、text prompt、
   cancel、permission、EOF / SIGTERM、stdout purity、异常退出与 bounded stderr；不允许仅用
   in-memory SDK mock。
3. **adapter contract**：未知 / 乱序消息、重复 terminal、并发 prompt、非法 cwd、协议 timeout、
   child exit、secret redaction 和能力降级。只有 evidence 明确支持的 update 才可翻译。
4. **permission 关联**（§3.4 不变量）：`toolCallId` 能关联到 `tool_call` 时按真实工具名 +
   `rawInput` 走审批；关联不到（乱序、丢失、未知 id、映射已清理）必须拒绝。另需一条测试
   钉死「`kind` 恒为 `other`」，防止后续基于 `kind` 写出永不命中的分流。
5. **安全与生命周期**：profile snapshot 并发隔离、无用户 profile / `.env` 读取、env 白名单、
   API key 不落盘 / argv / log、启动失败、abort、account switch、quit 后无孤儿进程或 bridge lease。
6. **身份与跨端**：`dsh` 的 DB 转换、历史 `cc` 兼容、所有可达 display 映射与二元 fallback
   回归；若开放 mobile / device-link，再做新旧端兼容和 allowlist / server evidence。

最终实机验收必须分层报告：静态 / unit、真实 dsh binary、Desktop 实机（Light 与 Dark 若
涉及 UI）、Windows / Linux 发布 runner、remote / mobile（MVP 应报告“不支持且已拒绝”）。
任何未测层都要明确写未验证，不能由 source、typecheck 或单机 macOS 代替。
