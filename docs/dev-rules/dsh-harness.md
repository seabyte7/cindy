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

以下四项是原方案的阻断缺口，已经改正为实施前门禁：

| 级别 | 原方案的问题 | 审计结论 / 处理 |
|---|---|---|
| P0 | 将 ACP 的 MCP、图片、流式 thought/tool/usage、会话恢复、模型/effort 热切换写成既定能力 | DeepSeek 当前公开的 ACP automation contract 明确采用很小的协议面：新建文本会话、已提交文本、cancel、一次性 permission 与 connection-owned teardown；其中还明确列出拒绝 MCP、图片、额外目录、配置选择器及 load/list/resume。具体 alpha 可能变化，但必须以随包二进制实测推翻这一保守基线，不能靠计划推断。 |
| P0 | 以 npm alpha 和 PyPI wheel 混合描述一个“官方运行时” | Cindy 只能分发经审阅、pin、完整性校验的 PyPI wheel payload；npm 包、源码 checkout、系统 Node 和用户全局 `dsh` 都不在生产启动链中。二者版本对应关系必须有上游制品证据。 |
| P0 | 在 profile patch 中追加 Cindy persona / harness 身份 | 这会进入模型 system prompt，命中 [`maker-core-and-agent-behavior.md`](maker-core-and-agent-behavior.md) §4。MVP 禁止新增该文本；若以后确有必要，必须先取得维护者对文本、行为影响和缓存影响的明确确认，并单独 PR。 |
| P1 | 直接复用 Pi 的三档权限、MCP bridge、远程与 mobile 路径 | ACP 的一次性“扩大 sandbox”请求不等于 Cindy 的逐工具权限审批。未验证前只可提供受限的本机 MVP，不能借 Pi 的能力名称宣称等价。 |

**已定裁决**：协议优先 ACP；运行时优先官方自包含可执行；DB 新值为 `'dsh'`；类型
收敛单独 PR；首版 per-session 一个 dsh 进程。上述裁决不表示 ACP 扩展能力已获准。

### 1.2 MVP 的明确范围

- 仅本机 Desktop。SSH remote、在远程工作目录执行、远程 runtime 分发、远程凭证落盘、
  mobile 专属入口与 device-link 新 wire 均不属于 MVP。
- 仅由 Cindy 启动、Cindy 管理的 dsh；不读取、合并、迁移或修改 `~/.dsh`，也不调用用户
  PATH 中的 `dsh`。
- 仅文字对话、一个 in-flight prompt、已确认的最终文本、cancel 和经验证的一次性 sandbox
  升级请求。任何未验证能力都必须在 `Capabilities` 中返回不可用，UI 不得露出入口。
- Cindy DB 仍是产品消息与会话列表的真相源。除非恢复门禁通过，dsh 原生 session id 只作
  运行期诊断，不可作为重启后的恢复承诺。

### 1.3 ACP 选择与保守基线

dsh 的 SDK JSON-RPC 缺少 Cindy 所需的 cancel / permission 交互面，所以候选协议是 ACP。
但 ACP 是自动化传输，不是 Cindy UI 的完整事件协议。公开的
[ACP automation design record](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md)
以及 ACP app README 只能作为**风险下界**，不能替代对 pin 制品的验收。

| 能力 | 准入前状态 | 开放条件 |
|---|---|---|
| `initialize`、`session/new`、文本 `session/prompt`、`session/cancel` | 候选 | 真 wheel 的无 key subprocess 测试覆盖完整握手、绝对 `cwd`、终止和 EOF / SIGTERM 回收。 |
| `session/request_permission` | 候选，且只按 sandbox 升级理解 | 记录真实 request / response schema；拒绝、超时、断线与未知请求均 fail closed。 |
| MCP、image/file、tool/thought/usage delta | 禁用 | 真 wheel 的协议 fixture + 集成测试证明该版本明确支持，并有 Cindy 对应的安全、事件和 UI 合同。 |
| list/load/resume、model/effort option、mode、commands | 禁用 | 跨进程恢复 / option 改写的真二进制测试通过，且没有共享 profile 竞态。 |

不依赖“dsh 自身也依赖某版 `@agentclientprotocol/sdk`”。Cindy 客户端的 ACP SDK 必须在
`packages/maker-core/package.json` 显式精确 pin、进入 lockfile 和第三方声明；选择的版本
以已验收 wheel 的 ACP v1 wire compatibility 为准，不以未验证的 `1.4.0` 假设为准。

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

- `session/request_permission` 先按“一次 sandbox 升级”处理，不得谎称是工具级审批。没有真
  实 tool name / arguments / effect，`auto-review` 无从安全分类；因此 MVP 不得广告
  `auto` 或 `bypassPermissions`，scheduler 也不得以 dsh 无人值守运行。
- 若框架要求 permission mode，MVP 只暴露最严的 `ask`，并在 UI 说明其仅适用于上游发出的
  sandbox 升级请求；若不能准确说明则不暴露 selector。`[ask, auto, bypassPermissions]` 的
  顺序不变量只在三者**已被逐项验证且语义等价**后才能采用，绝不能因为 Pi 有此顺序而复制。
- MVP 不传 `mcpServers`。在 pin 制品明确接受 session-scoped stdio / HTTP MCP 前，
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
清单。未列为 enabled 的能力一律是 `sdk-missing` / `runtime-unverified`，不进入 UI / scheduler。

| 能力 | MVP 状态 | 说明 |
|---|---|---|
| text prompt / committed final text | 候选 enabled | 仅真 wheel 证明的 baseline；不把最终文本伪装成 token delta。 |
| abort | 候选 enabled | 仅 `session/cancel` 确认成功且 terminal 收口可测后开放。 |
| 一次 sandbox 升级 request | 候选 enabled | ask-only、一次性、拒绝 / 超时 / 断线 fail closed；不是 per-tool approval。 |
| model / effort 切换 | disabled | 未验证的 `session/set_config_option` 不得调用；切换前模型需另开会话并有 route 证据。 |
| image / file / resource link | disabled | 只有相应 content block 完整往返、大小限制、MIME 校验和无泄露测试通过才打开。 |
| MCP（stdio / HTTP） | disabled | 默认不传 `mcpServers`；见 §3.4 的独立安全 gate。 |
| tool、thinking、usage / context | disabled | 不从 durable log、stderr 或猜测字段补造 UI 事件。 |
| resume / list / load / fork / rewind / session tree | disabled | 需跨进程、并发与损坏恢复实测；Cindy DB 历史不等于 dsh 原生恢复。 |
| same-turn steer、plan、commands、compact、export | disabled | ACP contract 未被证实前不暴露。 |
| `auto` / `bypassPermissions`、scheduler | disabled | 与 DSH 的 sandbox permission 语义尚不等价。 |

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
| 约 70–78 MB 的 runtime payload + per-session 进程 | 前者是单份受管下载 / 磁盘体积，不得误报成每会话重复下载；后者的实际内存和启动成本必须在 process monitor、资源上限、终止确认和启动 / 退出压测中测量。“单连接多 session”是独立生命周期设计，不是优化补丁。 |
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
4. **安全与生命周期**：profile snapshot 并发隔离、无用户 profile / `.env` 读取、env 白名单、
   API key 不落盘 / argv / log、启动失败、abort、account switch、quit 后无孤儿进程或 bridge lease。
5. **身份与跨端**：`dsh` 的 DB 转换、历史 `cc` 兼容、所有可达 display 映射与二元 fallback
   回归；若开放 mobile / device-link，再做新旧端兼容和 allowlist / server evidence。

最终实机验收必须分层报告：静态 / unit、真实 dsh binary、Desktop 实机（Light 与 Dark 若
涉及 UI）、Windows / Linux 发布 runner、remote / mobile（MVP 应报告“不支持且已拒绝”）。
任何未测层都要明确写未验证，不能由 source、typecheck 或单机 macOS 代替。
