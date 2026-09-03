# DSH Cindy 控制面接入方案（DeepSeek Harness）

> **状态：Cindy 自主控制面已裁决、legacy 对照制品已取证，当前工作树中的 F0 未注册 bridge 核心与真实二进制
> lifecycle / prompt / owned-follow / running-turn cancel（`end_turn` / `cancelled` 终止值白名单）、真实
> `session/request_permission` 回环（F0 一律 `cancelled`，不执行升级工具）以及有界操作 timeout 证据已交付；carrier EOF/exit 仅已证明 fail-closed `needs-reconcile`，尚未有持久恢复；产品身份、受管分发、持久 binding、
> 事件投影、UI 和跨端能力尚未实施。** 本文是把
> [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
> 接成 Cindy 第四个 Agent harness 的施工正本。这里的“完整”不是“能发文字 prompt”，而是
> Cindy 对 DSH task 的会话、生命周期、权限、事件、恢复和跨端投影拥有可测试的控制面，且不
> 无故丢失已被受管 runtime 公开的能力。
>
> **架构裁决（2026-09-02）**：Cindy 不等待、也不依赖上游另行提供所谓 Native Host API。
> Desktop Main 自己实现版本化的 `CindyDshBridge` / `DshControlPlane`，负责 scope、session
> binding、命令关联、事件投影、权限决策和恢复；经 pin source release 由 Cindy 构建的自包含 runtime 只是受控执行
> 引擎。Cindy 与该引擎使用已发布的 ACP v1 自动化协议（create/list/resume/prompt/cancel/close
> 及语义 update），而非读取私有 JSONL/数据库或嵌入 Web UI。ACP 是 runtime transport，
> **不是产品控制权归属**，更不是等待上游 Host 的前置条件。
>
> 为避免历史方案造成歧义：本文随后出现的“Native Host Gate”“ACP Basic 只能止步”等旧表述
> 一律由本段及 §0.2、§11 的 **Cindy Bridge Gate** 替代。DSH 自己没有公开的 UI 专属对象，
> Cindy 可实现同样的产品能力，但必须标为 `cindy-dsh` provenance，不能伪称为 DSH native
> object。
>
> **供应链裁决（2026-09-02，用户选择 A）**：生产 runtime 由 Cindy CI 从固定上游
> `dsh-v0.1.2-alpha.3` → commit `dd6322d604e00eec1ba5e0c8541159906a21094a` → tree
> `86be9091c78528b5ef0866ae6d58b01d4a53582e` 构建、归档并以 Cindy 的 build provenance
> attestation 证明；不再把上游 PyPI wheel 的 wheel-to-source 绑定当作生产前提。该上游 tag 是
> lightweight tag、commit 无 Git 签名，故不得伪称“上游签名 tag 已验证”：每次 CI 必须复核
> tag 指向固定 commit、tree、上游 lockfile、Cindy pnpm/package-toolchain lock 与 build-script digest，并由 Cindy 受信 workflow 对输出
> archive 生成可验证 provenance。官方 wheel 只保留为协议对照和迁移证据，绝不作为生产回退。
> 不能以 `master` 文档、npm 标签或“同名 alpha”推定构建输入或随包运行时的能力。
>
> 未准入 ≠ 上游不支持。[§1.4](#14-源码取证pin-tag-上的真实协议面) 是按 tag
> `dsh-v0.1.2-alpha.3` **读源码**得到的真实协议面，用于区分「Cindy 还没验收」与
> 「上游确实没有」；把前者写成后者会永久搁置实际可用的能力，见 [§5](#5-acp-basic-能力合同)
> 的三状态定义。

## 目录

- [0. 完整接入目标与裁决](#0-完整接入目标与裁决)
- [Part I：ACP Basic 基线](#part-iacp-basic-基线)
- [1. ACP 基线审计结论与边界](#1-acp-基线审计结论与边界)
- [2. 准入证据包](#2-准入证据包)
- [3. 受控运行时与安全边界](#3-受控运行时与安全边界)
- [4. ACP Basic 施工阶段](#4-acp-basic-施工阶段)
- [5. ACP Basic 能力合同](#5-acp-basic-能力合同)
- [6. ACP Basic 风险、跨端与发布](#6-acp-basic-风险跨端与发布)
- [7. ACP Basic 验证与合入门禁](#7-acp-basic-验证与合入门禁)
- [Part II：DSH 原生完整接入](#part-iidsh-原生完整接入)
- [8. 原生完整接入架构](#8-原生完整接入架构)
- [9. 能力合同、真相源与安全边界](#9-能力合同真相源与安全边界)
- [10. Desktop、远程与移动端设计](#10-desktop远程与移动端设计)
- [11. 完整接入执行计划](#11-完整接入执行计划)
- [12. 验收、发布与持续兼容](#12-验收发布与持续兼容)

-----

## 0. 完整接入目标与裁决

### 0.1 “完整”的可验收定义

完整接入是能力和生命周期的承诺，不是把上游 Web UI 嵌进一个窗口。对某个经 pin 的 DSH
release，只要该能力在 Cindy 选择的 native profile、平台和权限下可用，Cindy 必须做到：

1. 用户可在合适的 Cindy 入口发现、启动、观察、停止和恢复它；不要求逐像素复刻上游 UI，
   但不能把 DSH 专属状态悄悄丢成一段普通文本。
2. DSH 原生 session、plan、任务、终端、插件、扩展和权限保持各自的身份与生命周期；Cindy
   只做连接、投影和交互，不重造第二套 Agent loop。
3. Desktop、SSH 远程工作区、device-link 和 Mobile 遵守同一个任务语义。每端可以有不同
   操作深度，但不能把一个可恢复的任务变成另一端的“未知”或“新会话”。
4. 版本、平台、profile 或权限确实不支持时，`Capabilities`、UI 和错误都明确写出原因；绝不
   用 Claude / Codex / Pi 的默认分支假装替代 DSH。

这不改变任何现有 Claude Code、Codex 或 Pi 会话的能力。用户选择 DSH 后获得的是 DSH 自己的
模型路由、运行时、会话和工具生态；Cindy 不得借整合之名静默删除上游可用功能。

### 0.2 最终技术裁决

| 事项 | 最终裁决 |
|---|---|
| 会话控制面 | **Cindy `DshControlPlane`** 是唯一的产品会话控制面。它在 Desktop Main 管理版本化 `DshBridgePort`；底层 runtime 的公开 ACP v1 只由该 port 使用。 |
| ACP | Cindy bridge 使用 ACP 的 initialize/new/list/resume/prompt/cancel/close/update/permission 面；Renderer、Mobile、插件和其他 agent 均不得直连 ACP。一个 DSH session 只允许一个 Cindy bridge record 作为 owner。 |
| 进程模型 | 生产路径按 `账号 × runtime release × 执行位置` 隔离长生命周期 **Cindy DSH scope**。首版可由每 scope 一个 ACP subprocess 承载多个 session；资源/故障证据不足时降级为每 session 一个 scope，不能共享不受控状态。 |
| 状态权威 | runtime 是 ACP session 与其持久历史的权威；Cindy DB 是任务壳、binding、命令 receipt、跨端路由、`cindy-dsh` activity 和可重建投影的权威。两边不得对同一字段各自写入。 |
| 运行时 | 只使用 Cindy CI 从受审阅的固定上游 source release 构建、经 provenance、archive hash、sidecar、tree manifest 和版本验证的自包含 runtime；不得回落用户 PATH、系统 Node、上游 wheel 或未验收源码 checkout。 |
| 原生扩展 | 默认使用 Cindy 管理的 DSH Home；用户显式选择使用既有 DSH Home、profile、skill 或 plugin 时，Cindy 必须提供可恢复的原生路径，而不是永久禁用。 |
| 非公开接口 | 不读取或写入 DSH 私有 JSONL / 数据库来模拟 API，不 patch 私有协议。runtime 未公开的 DSH UI object 不进入 Cindy 的 `dsh-native` 类型；需要的产品工作流由 Cindy 自己的 versioned `cindy-dsh` contract 实现、测试和维护。 |

**Cindy Bridge Gate**：完整实现进入产品代码的条件是同一份 release evidence 证明：(a) 受管
runtime 的 ACP v1 初始化和 capability negotiation；(b) Cindy 能在空 managed Home、非项目
launcher cwd 中通过公开 ACP 完成 create/close/list/reconcile/resume（若 runtime advertises）/
prompt/cancel/close 的真实 lifecycle；(c) `DshBridgePort` 对每个命令的 ownership、receipt、
timeout（关闭 carrier、禁止重试）、EOF/exit 和 reconcile 语义有独立测试。**已验证 alpha.3 的 lifecycle 事实**：active
session 不会出现在 `session/list`，也不能 `resume`；Cindy `close` 必须保留可恢复 binding，之后
才 list/reconcile/resume，不得把 close 误当删除。上游没有另一套 Host API 不是阻塞理由；私有
state scraping、Web UI 驱动和未经验证的 profile patch 仍然禁止。

### 0.3 不变量

- Main / 受控 DSH scope 才能拥有进程、`DSH_HOME`、凭证、bridge correlation state、远程隧道和
  文件授权；Renderer、Mobile 和插件永远不直连 DSH Host。
- 不新增 Cindy system prompt 或 persona 来弥补 DSH 的 UI / 协议缺口；可确定的映射、权限、
  关联、恢复和错误收口必须写成代码。
- 不把 DSH 原生 team/subagent 伪造成 Orca Worker，也不把 Orca Worker 伪造成 DSH 原生任务。
  两者可在后续互操作，但必须保留不同 origin、权限、预算、会话和完成语义。
- 每个 ACP/cindy-dsh event 都经版本化 schema 校验、顺序处理和最小化投影；未知事件安全保留为
  “未呈现的 DSH 状态”，不得猜测其含义或杜撰完成事件。

-----

## Part I：ACP Basic 基线

## 1. ACP 基线审计结论与边界

### 1.1 结论

以下四项是原方案的缺陷，已改正为实施前门禁。**注意 P0-1 的改法**：缺陷是「未验收就写成
既定」，不是「上游不支持」；把两者混为一谈会造出反向错误，见 §1.4。

| 级别 | 原方案的问题 | 审计结论 / 处理 |
|---|---|---|
| P0 | 将 ACP 的 MCP、图片、流式 thought/tool/usage、会话恢复、模型/effort 热切换写成**既定**能力 | 源码取证（§1.4）显示这些能力在 pin tag 上**确实存在**，所以问题不是「上游不支持」，而是「未经本仓验收就写成既定」。处理：状态一律为**候选**，由 Gate A 的真二进制实测逐项转正；实测不通过就收缩。不得反过来把未验证写成上游拒绝。 |
| P0 | 以 npm alpha 和 PyPI wheel 混合描述一个“官方运行时” | Cindy 只分发由固定 source release 的受信 CI 构建、attest 的自包含 payload；上游 wheel 仅作对照证据，npm 包、源码 checkout、系统 Node 和用户全局 `dsh` 都不在生产启动链中。上游轻量 tag 不能当签名，必须复核 tag→commit→tree、lockfile、build-script 和 Cindy provenance。 |
| P0 | 在 profile patch 中追加 Cindy persona / harness 身份 | 这会进入模型 system prompt，命中 [`maker-core-and-agent-behavior.md`](maker-core-and-agent-behavior.md) §4。MVP 禁止新增该文本；若以后确有必要，必须先取得维护者对文本、行为影响和缓存影响的明确确认，并单独 PR。 |
| P1 | 直接复用 Pi 的三档权限、MCP bridge、远程与 mobile 路径 | 真正的差异不在「是否逐工具」（dsh 是逐工具，见 §1.4-3），而在**档位不可会话内热切**（§3.4）与远程 / mobile 路径完全未设计。未验证前只提供受限的本机 MVP，不借 Pi 的能力名称宣称等价。 |

**ACP runtime 裁决**：运行时使用 Cindy source-built 的自包含可执行；DB 新值为 `'dsh'`；类型收敛单独 PR。
ACP 是 Cindy bridge 的受限 runtime transport，不是另一个产品模式。首版为便于隔离和审计可采用
per-session subprocess；一旦 F2 的 scope supervisor 证明多 session scope 的隔离、drain 和恢复，
再升级为同 scope 的 shared ACP subprocess。两种实现都必须只通过 `DshBridgePort` 对上层暴露。

### 1.2 ACP Basic 的明确范围（非最终承诺）

- 仅本机 Desktop。SSH remote、在远程工作目录执行、远程 runtime 分发、远程凭证落盘、
  mobile 专属入口与 device-link 新 wire 均不属于 MVP。
- 仅由 Cindy 启动、Cindy 管理的 dsh；不读取、合并、迁移或修改 `~/.dsh`，也不调用用户
  PATH 中的 `dsh`。
- 仅文字对话、一个 in-flight prompt、已确认的最终文本、cancel，以及经验证的**逐工具调用
  一次性审批**（allow-once / reject-once，见 §3.4）。任何未经 Gate A 转正的能力都必须在
  `Capabilities` 中返回不可用，UI 不得露出入口。
- Cindy DB 仍是产品消息与会话列表的真相源。除非恢复门禁通过，dsh 原生 session id 只作
  运行期诊断，不可作为重启后的恢复承诺。

### 1.3 ACP Basic 协议选择

dsh 的 SDK JSON-RPC 缺少 Cindy 所需的 cancel / permission 交互面，因此 **ACP 是 Cindy
控制面唯一允许直连 runtime 的标准自动化传输**。它不是为 Cindy UI 设计的完整 native 事件协议；
Cindy 需要的 task/activity 产品能力由自己的 versioned contract 负责，而不是等待另一个上游 Host。
但这不等于 ACP 的协议面很小，实际面见 §1.4。

不依赖“dsh 自身也依赖某版 `@agentclientprotocol/sdk`”。Cindy 客户端的 ACP SDK 必须在
`packages/maker-core/package.json` 显式精确 pin、进入 lockfile 和第三方声明；选择的版本
以已验收 Cindy source-built runtime 的 ACP v1 wire compatibility 为准。（参考：pin tag 的
`packages/acp/acp/package.json` 用 `@agentclientprotocol/sdk` `1.4.0`，服务端用什么版本
不构成客户端 pin 的理由，只是兼容性起点。）

### 1.4 源码取证：pin tag 上的真实协议面

> 取证对象：上游 tag `dsh-v0.1.2-alpha.3`（commit
> `dd6322d604e00eec1ba5e0c8541159906a21094a`，即当前 Cindy source release），读的是源码不是
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

1. **受信构建输入**：写出上游 repository、tag、固定 commit 与 tree；CI 在干净 checkout 中
   复核 tag→commit（允许 lightweight tag，但其不可被当作签名）、tree、`pnpm-lock.yaml`、
   `scripts/build-exe-for-python-sdk.ts` 和 package manifest digest。上游脚本调用的
   `@yao-pkg/pkg@6.21.0` 不在上游 lockfile：必须经 Cindy 的 `tools/dsh/pkg-toolchain/` 冻结
   lock + integrity 校验，以窄 wrapper 替换**仅该** `pnpm dlx`，其它上游 pnpm 命令不改写。
   固定 Node 自带的 npm 只能以 `--ignore-scripts` 下载 release definition 中 SRI 固定的 pnpm tarball；
   验证该 tarball 后才可解包并以其中的 pnpm 执行 `pnpm install --frozen-lockfile`。固定的 pnpm 11
   在含不同 `packageManager` 字段的 Cindy workspace 中还必须以 `COREPACK_ROOT` sentinel 加
   `--pm-on-fail=ignore` 禁止其自动下载另一版本；该 sentinel 不调用 Corepack，实际 CLI 仍须是
   已验 SRI 的 tarball。`pkg` closure 唯一允许的 install script 是在其独立 workspace 明示的
   `esbuild: true`；不得继承 Cindy 根配置或使用交互式 approve。禁止 Corepack 或 runner-global pnpm 的可变下载、相似 alpha 名称、可变 tag 或本机
   `node_modules` 推定输入。
   `pkg --sea` 的 `node24` 简写会查询 Node index 并静默升级 base binary。alpha3 的上游 build parser
   原本拒绝精确的 `node24.20.0-*`，所以 Cindy 必须先验证干净上游 source object，再应用 release
   definition 逐文件 preimage/postimage 和 patch SHA-256 均固定的最小 adaptation，使其仅接受完整
   `node<major>.<minor>.<patch>` target。CI 随后只能使用精确的 `node24.20.0-*`，先从
   `nodejs.org/dist/v24.20.0/` 下载每平台 archive、按 release definition 的 SHA-256 校验后才写入
   pkg 的 SEA cache sentinel，并在 build 后再验同一 archive；不得让 pkg 查询 index 或以远端
   `SHASUMS256.txt` 的即时结果决定输入。patch 不得扩展为运行时代码改写、不得触碰超过 release
   declaration 的文件，也不得绕过上游 source 的初始 clean-tree / digest 验证。
   上游 build 所需的 `pnpm dlx @yao-pkg/pkg@6.21.0` 只能由临时 PATH shim 接到 Cindy wrapper；不得
   把 wrapper 注入 `npm_execpath`，否则 pnpm 自己的 dependency-state check 可能递归运行 wrapper 并变成
   未声明的 production install。
2. **Cindy 制品与证明**：每个支持平台的受信 workflow 只用上述输入构建自包含 runtime，保存
   build identity、archive filename/size/SHA-256、主可执行、`-rg` 与 macOS `-spawn-helper`
   （如适用）及完整 tree manifest；对 archive 生成 Cindy build provenance attestation。
   archive 解包必须拒绝路径穿越、symlink、特殊文件、缺旁车、额外文件或不可执行主文件。
3. **实际协议探针**：用该主可执行、空的 Cindy 管理 `DSH_HOME`、非项目 launcher `cwd`
   启动 ACP；保存已脱敏的 initialize response、支持的 capability / config option、一次
   `session/new`、文字 prompt、cancel、permission request 和关闭过程。不能只测
   `--help` 或只测 initialize。
4. **能力 fixture**：对准备打开的每个能力，保存最小的 request / response / update fixture
   与预期失败 fixture。未知 enum、缺字段、乱序 update、重复 done、stdout 杂讯与进程异常
   必须由 adapter 拒绝或确定性收口，不能猜测成功。
5. **供应链与平台**：构建矩阵是 `linux-x64`、`linux-arm64`、`darwin-arm64`、`win32-x64`；
   `darwin-x64`、`win32-arm64` 与任何未发布的 libc 变体均为不支持并静默不注册。F0 的 Linux 和
   macOS runner 至少跑 `--version`、ACP handshake 和关闭 smoke；不能以本机 macOS 成功替代 Linux
   证据。`win32-x64` 在 F2 的 launch-time、identity-bound Job Object（或等价）落地前只能构建、
   归档和 attestation，必须标为 `smoke-withheld` 且保持不可注册——不得为了“平台覆盖”执行未被整树
   containment 约束的 Windows runtime。

上游源码的 `python/sdk-runtime/README.md` 规定自包含可执行、sidecar、非空 `DSH_HOME` 与
`scripts/build-exe-for-python-sdk.ts` 的构建路径；它不替 Cindy 的 release attestation，也不自动
证明任何 ACP 扩展能力。

-----

## 3. 受控运行时与安全边界

### 3.1 运行时分发

- F0 新增 `tools/dsh/source-release.json` 与 source-build workflow；输入是**已审阅的 source
  release pin**，不是运行时查询到什么就接受什么。它至少保存 repository、tag、commit、tree、
  lockfile/Cindy pkg-toolchain/build-script digest、固定 Node/pnpm、每平台 target/sidecar 和 Cindy release identity。
  轻量 tag 没有上游签名时必须明确记录，而非填造已验证签名。workflow 必须在执行生成 runtime
  **前**上传刚验证的 archive；测试只能使用从该 archive 新解出的目录；随后由不执行 runtime 的
  新 runner 再验证同一服务端 artifact 并 attestation，不能让 runtime 在 verify 与 attestation 之间改写 subject。
- source-build workflow 必须在受控 DSH 输入、构建脚本、bridge E2E 或其 workflow 本身变更时，以
  受限 `push` / `pull_request` path filter 自动运行，并保留 `workflow_dispatch` 供重跑。只写
  `workflow_dispatch` 不能验证首个分支版本：GitHub 只允许调度默认分支中已存在的 workflow。
  fork PR 可以运行无 secret 的 build/smoke，但不得请求 identity token 或创建 provenance；只有
  官方 `makecindy/cindy` 的 push 或同仓 PR 可在独立二次验证后 attestation。fork 自己的 CI
  identity 绝不能当作 Cindy release provenance。
- F2 才新增 `tools/dsh/latest.json` 与 `tools/dsh/update.mjs`。它们只接受已经由 Cindy CI
  attested 的 archive pin（archive URL/SHA-256/size、可执行相对路径、sidecar、完整目录
  manifest 与 provenance reference），先校验 archive hash、再校验解压 tree；正式安装包不内置
  dsh，也不能从 source checkout 或上游 wheel 现场构建。
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

**F0 实施状态**：未注册 Main bridge 在 transport 启动前安装 `session/request_permission` handler，
对所有 request 返回 `{ outcome: { outcome: 'cancelled' } }`。同一受管二进制的 loopback-provider
fixture 已证明只读→workspace-write 的 `bash` 升级会经过这条公开 ACP 请求，并在取消后不落盘。它只是
“拒绝且可证明”的安全底线，不是用户可批准的能力；tool-call 关联、interaction resolver、超时/断线
收口与任何 UI 投影仍属于 F4，未完成前不得把 `ask` 标记为产品可用。

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
  allowlisted factory；不得接受 Renderer 的 command、args、headers 或 URL；必须有 loopback
  绑定、per-session token、session-instance 路由、register-before-spawn、代次安全的
  unregister、关闭 lease 和账号边界 teardown。外部 HTTP MCP 还须遵守其既有凭证与 URL
  allowlist，不得因 DSH 绕过。
- per-session 进程的 close / abort / account sweep 必须幂等且有界：先停止 prompt，再关 ACP，
  再 TERM / 有界 KILL，并只在确认退出后清理材料。POSIX 必须让 runtime 自成进程组、向整组
  发信号，不能只杀 direct child 留下继承凭证或文件句柄的孙进程；但进程组**不能**阻止后代
  `setsid` / double-fork 逃逸，不能伪称为 OS 级 containment。F0 只把它作为未注册 bridge 的
  普通后代清理证据；F2 开通任一产品 launch 前，Linux 必须有受监督 launcher / delegated cgroup
  等可证明 containment，macOS 必须有等价的受监督原生方案，Windows 则必须有启动时的
  identity-bound Job Object 或等价机制。不得用可复用裸 PID 的 `taskkill` 把“尽力而为”伪装成
  已确认清理。启动半途失败也必须纳入同一收口；不能因进程已不可观察就把会话写成可恢复或已
  安全退出。

-----

## 4. ACP Basic 施工阶段

### Gate A：先建立 Cindy Bridge 证据，再写产品路径

完成第 2 节 release evidence packet、无 key real-loader subprocess 测试、Cindy bridge 的
create/list/resume（若 advertise）/prompt/cancel/close/EOF/exit lifecycle 和本节的 profile /环境
安全测试。若实际 ACP 能力比保守基线更少，MVP 继续收缩；若更多，也必须按第 5 节逐项开放，
不能在一个 PR 顺手打开。runtime 缺少另一套 Host API 不构成阻塞。

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
- 新增 binary distribution、Cindy source-build provenance / archive extraction / manifest、unsupported platform、CDN failure
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

`DshControlPlane` 构造必须由 Main 注入 `assertAuthorizedCwd`；它先拒绝非绝对路径，再对 create
和 resume 的 `cwd` 调用该策略。不得给 bridge “绝对路径即已授权”的默认实现，也不得由 Renderer、
Mobile 或 runtime 自己决定工作目录授权。

Main 关闭 ACP child 的固定顺序是 stdin EOF → 有界 `SIGTERM` → 有界 `SIGKILL` → **有界失败**；即使
runtime 忽略 TERM 或 KILL 后迟迟没有 exit 确认，关闭 promise 也不得无限悬挂，更不得把未确认的
进程写成已回收。前者用一个明确忽略 TERM 的本地子进程夹具自动验证，后者用不发 close 事件的 fake
child 回归测试验证。F0 的 POSIX transport 已用独立进程组覆盖普通 direct-child 之外的后代，并
额外验证“root 先 exit、同组 descendant 仍活着”时继续 TERM/KILL；它**不**覆盖 `setsid` / double-fork
逃逸，故不是产品 containment 证明。Windows 在具备 launch-time、identity-bound 的整树 containment
之前**拒绝启动**；F2 也不得把当前 POSIX process-group 证据当作 Linux/macOS product launch 放行。
Linux runner 仍须以真实 runtime 得到 close smoke，macOS 证据不能替代它；Windows 则在 F2
identity-bound containment 到位后才可首次执行同一类 smoke，之前的 archive-only 证明不得计作 runtime
准入证据。

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

## 5. ACP Basic 能力合同

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

## 6. ACP Basic 风险、跨端与发布

| 风险 | 处置 |
|---|---|
| alpha / ACP 破坏性变更 | 每次 pin 升级重跑第 2 节 evidence packet 与完整 real-binary integration；握手不兼容即本次不注册。 |
| 运行时供应链 / sidecar 丢失 | source tag→commit→tree/lockfile/build-script + Cindy provenance + archive hash + extracted-tree manifest 四层验证；绝不使用系统 / 用户 runtime fallback。 |
| profile 是可执行配置 | Cindy-owned、不可变、无用户 plugin / patch / live reload；profile / launcher cwd 与工作目录隔离。 |
| 凭证或工作区 `.env` 泄露 | Main 安全 store + 最小 env 白名单 + 非项目 launcher cwd；无 argv / file / log secret；账户边界清理。 |
| 约 70–78 MB 的 runtime payload + per-session 进程 | 前者是单份受管下载 / 磁盘体积，不得误报成每会话重复下载；后者的实际内存和启动成本必须在 process monitor、资源上限、终止确认和启动 / 退出压测中测量。**per-session 是 Cindy 的产品选择，不是协议限制** —— ACP 单连接本就支持多 session 并发（§1.4），选 per-session 是为了对齐 CC / Codex / Pi 的 teardown 与账号边界语义。“单连接多 session”将来是独立生命周期设计，不是优化补丁。 |
| MCP 或权限扩权 | 默认关闭；需要单独 threat review，不能因为上游后来接受字段就自动开放。 |
| 远程 / mobile 不一致 | MVP 明确拒绝 SSH remote；device-link / mobile 走已验证的兼容投影，否则隐藏。任何 wire 改动需要服务端协同。 |
| 区域和端点 | 若 dsh runtime、CDN manifest、provider 默认或 UI 出现 `cn` / `global` 分支，先遵守 [`../product-rules/region-and-editions.md`](../product-rules/region-and-editions.md)：无明确区域的默认是 global，且不能让用户在应用中选择发行版本。 |

-----

## 7. ACP Basic 验证与合入门禁

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

1. **运行时供应链**：source pin/tag→commit/tree/lockfile/build-script 校验、Cindy provenance、解包防御、sidecar / tree manifest、CDN hash、unsupported
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

-----

## Part II：Cindy DSH 完整控制面

本部分是 §0 的最终目标和执行正本。它保留 Part I 的 runtime 供应链、最小环境、凭证、日志
和协议探针要求；Part I 中“仅本机 / 文字 / per-session”的早期限制不能迁移为完整路径的永久
限制。上游未公开的 UI 专属对象由 Cindy 以显式 `cindy-dsh` provenance 实现，绝不伪造其为 native。

### Runtime 与 Cindy 能力基线

完整路径的能力清单以 **同一 pin release 的公开源码、制品和真运行时** 三者交集为准。当前
源码基线显示 DSH 包含 session、attachment、MCP、shell / filesystem、terminal、LSP、skill、
subagent、jobs、workflow、todo、plan、schedule、sandbox、extension、settings、web 与 ACP 等能力族；
是否由本 release/profile 公开给 Cindy 必须由真实 capability discovery 确认。Cindy 的计划、任务、
终端和工作流面是独立的产品能力，不从 source-only Host package 推断。
参考上游 [packages map](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.3/packages)、
[Web guide](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/docs/user/guide/index.md)
与 [ACP package](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.3/packages/acp)。

## 8. 原生完整接入架构

### 8.1 控制面分层

```text
Desktop Renderer / Mobile
          │  Cindy IPC / device-link（受验证的 payload）
          ▼
Desktop Main: DshControlPlane + DSH session projection
          │  managed ACP stdio / SSH-forward，版本化 Cindy bridge
          ▼
受管 Cindy DSH scope（Cindy source-built runtime + DSH_HOME + ACP transport）
          │
          ▼
DSH runtime session、tools；Cindy-owned plan、jobs、terminal、skills、extensions projection
```

- Renderer 只消费投影、请求明确动作和解析过的 capability；它永远不持有 DSH endpoint、host
  token、credential、原始 profile 路径或任意 shell / MCP 配置。
- `DshControlPlane` 位于 Desktop Main，采用顶层静态依赖。它负责 runtime release 选择、scope
  registry、健康探测、账号切换、退出和有界恢复；`maker-core` 只接收由 Main 注入的桥接接口，不能
  反向 import Desktop。
- Cindy bridge 必须是正式的、版本化的接口。它使用受管 ACP stdio 或受认证 SSH forward，且将
  runtime version、ACP capability fingerprint 和 session scope 放入每个请求的确定性校验；不得向
  LAN、Renderer 或 DSH plugin 公开 transport。
- **同一 runtime session 只允许一个 Cindy bridge owner**。完整路径由该 bridge 创建、恢复、
  prompt、cancel 和 close；不得让另一个 ACP client 或私有 controller 接管同一 session。

### 8.2 模块职责与依赖方向

| 层 | 计划模块 | 职责 | 禁止事项 |
|---|---|---|---|
| `packages/maker-core` | `agents/dsh/`、ACP event translator、capability adapter | 实现 `BaseAgent` 契约、session handle、通用事件 / interaction / usage 映射和能力降级 | 不启动进程、不读安全存储、不写 DSH Home、不 import Main / Renderer |
| Desktop Main | `dsh-host/`、runtime provisioner、Cindy bridge、projection store | 进程、home、凭证注入、远程转发、DB 投影、IPC sender / payload 校验 | 不重写 DSH agent loop、不把特权 bridge 交给 Renderer |
| Desktop Renderer | 通用会话面 + Cindy DSH activity panels | 呈现 capability、tool approval、plan、terminal、job、skill / extension 状态 | 不解析原始 runtime event、不保存任务真相、不调用任意 endpoint |
| `packages/maker-remote-ssh` | DSH installer / transport | 远端 runtime、home、loopback forward、远端文件语义与恢复 | 不把本地 path 或 credential 误当远端资源 |
| `packages/device-link` / Mobile | 版本化 DSH projection 与控制路由 | 同一任务的查看、输入、审批、停止、恢复和受限控制 | 不直连 DSH Host、不把新字段发给旧端 |

DSH 专属状态若无法用既有 `AgentEvent` 无损表达，新增一个有版本、有限字段的
`cindy-dsh` activity / snapshot 契约，并由各端 reducer 显式消费；禁止把任意 DSH JSON 透传到
Renderer，或把它塞进 `text` / `tool_result` 伪装成普通消息。

### 8.3 Host scope 与生命周期

完整路径的 Cindy scope 不是“每个 Cindy session 启一个 CLI”。scope key 至少由 `account scope`、受管
runtime release、`local / remote host` 和 DSH Home mode 构成；同 scope 内是否可多 session
复用，必须以 Cindy Bridge Gate 的并发、隔离和 teardown 实测为准。

1. Main 懒启动 scope，完成 version/ACP capability handshake 后才注册 `makerAgents.dsh`。
   启动失败只让 DSH 不可用，不影响其它 Agent 或 Cindy 启动。
2. 每个 runtime session 建立时记录其 DSH id、scope、release/ACP capability fingerprint 和首次
   capability snapshot；关闭聊天视图、手机断线或 Renderer 崩溃都不是删除 session 的理由。
3. 用户显式删除任务才执行 DSH delete（若该 release 支持）及 Cindy 投影回收；只关闭 live
   handle 时保留可恢复 session。账户退出、scope 销毁和应用退出必须有明确的 quiesce → flush →
   close → TERM → 有界 KILL 顺序。
4. scope / carrier 断线先尝试同一 scope 的 bridge reconnect 与 session reconcile。结果不确定
   时不得重发 prompt、重开 tool 或凭空新建 session；标为 `needs-reconcile` 并展示用户可理解
   的恢复动作。
5. 不以“scope 仍活着”证明 background job 已恢复。若 Cindy bridge 无法在 scope restart 后
   重建 job / terminal control state，Cindy 必须显示该限制并要求 reconcile；完整 job 恢复须等
   Cindy contract 和真实测试具备后才可宣称支持。

## 9. 能力合同、真相源与安全边界

### 9.1 完整能力矩阵

| DSH 能力域 | 完整路径的 Cindy 承载 | 完成判据 |
|---|---|---|
| session / history / search / list / resume / close / fork | Cindy bridge 生命周期、历史分页/follow、Cindy 任务索引与 session binding | 跨进程、断线、账户切换、冷会话恢复和 fork provenance 全部不串会话、不重复 prompt |
| 文本、resource、附件和图片 | 由 capability snapshot 决定输入器；附件走 Cindy 已有安全上传 / grant，runtime file reference 保留 identity | MIME、大小、远程文件、重传、历史重开与不支持模型的降级均可测 |
| text / thought / tool / usage / context 事件 | 有序 translator + DSH activity reducer；通用事件进入现有时间线，DSH 专属状态进入 activity panel | 无丢失、无错序、未知事件不伪造成 done，重连可补齐 sequence gap |
| tool approval 与 sandbox | 按 ACP `toolCallId` 关联工具名、参数、结果和一次性决定；批准卡可从手机恢复 | 关联失败、超时、断线一律 fail closed；永不把 allow-once 展示为永久授权 |
| model、provider、reasoning、context / compact | runtime catalog 与设置控制面；Cindy 只展示该 session 真正可用的选项 | 改动对下一 runtime turn 的生效边界可观测，失败不静默换到别的 provider |
| MCP | 用户 DSH MCP 与 Cindy 内部 bridge 分开建模；内部 bridge 仍由 Main allowlisted factory 创建 | stdio / HTTP、凭证、URL、token、租约、账户清理和远端隧道均有独立测试 |
| plan、todo、commands、elicitation | Cindy-owned `cindy-dsh` plan / interaction panel 和明确 command surface | approval、拒绝、恢复、计划完成和 command 错误都保留 Cindy identity 与 runtime correlation |
| terminal | owner-scoped terminal list / attach / input / signal / close 面板 | 不把 terminal 伪装成普通 tool output；重连、owner 校验、Host restart 限制明确 |
| subagent、team、job、workflow、schedule | Cindy-owned `cindy-dsh` activity tree，单独的中断、等待、结果和资源状态 | 不混入 Orca DB；后台任务的生命周期、预算和权限可观察、可停止 |
| skills、profiles、plugins、extensions | DSH 设置的受控发现、安装 / 更新 / 启停和自助修复路径 | 用户显式操作不被 Cindy 静默拦截；失败状态和恢复入口保留 DSH 原生语义 |
| sandbox、workspace、Web / LSP 等 profile 能力 | capability-driven 设置和活动展示，实际执行仍由 DSH | 不宣称未测试的 OS 隔离；本地 / 远程工作区边界正确 |

“完整”不要求在所有 OS 上虚构上游未发布的 runtime 或 profile；它要求在已支持的平台上不
退化，并在不支持的平台把原因、可用替代和数据安全地呈现出来。

### 9.2 会话 binding 与双向投影

新增 DSH 专用的 append-only schema / migration（建议表名 `dsh_session_bindings`），而不是把
DSH id 塞进 Claude、Codex 或 Pi 的旧字段。最小记录包括：Cindy session id（唯一）、opaque
runtime session id、host scope id、runtime / bridge API version、home mode、最后已投影 ACP
sequence、lifecycle 状态和创建 / 更新时刻；不保存 token、credential、完整 endpoint 或 profile
内容。

- runtime durable session log / ACP history 是 runtime session 的权威；Cindy 的 `cindy-dsh`
  activity、sessions / messages 是产品任务壳、列表、跨端路由和已投影聊天的权威；相同状态不允许
  两边独立修改。
- Main 用 `ACP sequence + request correlation` 持久化投影游标。消息提交必须先登记 Cindy
  request id，再由 runtime receipt / 历史回查确认；超时或 carrier 断开后不盲目 retry，以免重复
  执行带副作用的 prompt。
- 重连一律先 follow、再以页式 history 补洞并按 sequence 去重；无法证明连续性时停止 live
  projection，显示“需同步”，不可把 Cindy 缓存当作新的 native truth。
- migration 只追加，绝不修改历史 migration。旧 `cc` / `codex` / `pi` 数据保持原样；`dsh`
  仅在明确创建 native binding 成功后落库。所有 decoder、DB/IPC wire 和 fallback 必须对未知值
  fail closed，不能回落 `cc`。

### 9.3 权限、MCP 与凭证

- DSH runtime approval 的决定由 Cindy interaction resolver 代为展示和送回，但分类、关联和权限
  上限必须依据 ACP 的真实 tool metadata。没有完整关联上下文时拒绝；不靠 prompt 或 UI 隐藏作
  权限边界。
- DSH 自己配置的 MCP、skill 或 plugin 与 Cindy 注入的内部 MCP 是两个来源。后者仅由 Main
  建立，需 URL / transport allowlist、loopback 例外、per-session token、lease、注销代次和
  账号清理；前者按用户选择的 native DSH Home 和 DSH 自己的权限模型运行，但 Cindy 仍不把其
  command、header 或 secret 回传给 Renderer。
- 用户可选两种 Home mode：默认 `cindy-managed`（隔离且由 Cindy 生命周期管理）和显式
  `existing-dsh-home`（只在用户选择后连接既有 Home）。切换 mode 不复制、迁移或删除对方的
  凭证；mode 是非秘密 override，恢复默认仅清 override。任何 secret 继续只在 safeStorage /
  native credential store / child 内存中存在。
- Cindy-managed Home 的默认 profile 可以是安全、可审计的最小组合，但不能永久拿“安全”当
  理由封死用户明确请求的 native plugin、profile、extension 安装、更新或自助修复。Cindy 可以
  提示来源、影响和恢复路径；最终执行遵循 DSH 原生授权模型。安装或更新失败必须保持原状态，
  不能破坏现有 DSH state。

### 9.4 prompt、配置与原生多 Agent 边界

- DSH 的 model route、profile、command 和 extension configuration 属于 runtime；Cindy 的 plan
  与 activity contract 属于 `cindy-dsh`；两者均不向 system 段追加 persona、隐藏指令或每轮易变
  文本。任何未来确需进入
  system 段的变更仍先遵守 `maker-core-and-agent-behavior.md` §4 的维护者确认门禁。
- 计划、terminal、subagent/team、job、workflow、schedule 是 Cindy `cindy-dsh` activity，带
  `origin: 'cindy-dsh'` 的稳定 identity，并保留指向 runtime session 的 correlation。它们不写
  `orca_teams` / `orca_workers`，也不套用
  Orca Lead / Worker auto-bridge、预算或 completion 状态机。
- Cindy Orca 在后续可把已验证的 DSH session 作为 Lead 或 Worker，但这是一层显式 interop：
  必须先定义 DSH native child 与 Orca child 的并发、权限、预算、结果回传和用户可见 provenance。
  未完成前，Orca 入口对 DSH 明确隐藏或显示“暂不支持”，不能半接入。

## 10. Desktop、远程与移动端设计

### 10.1 Desktop 体验

Desktop 先交付完整可操作面，而不是先嵌入上游 Web UI。通用聊天时间线承载消息、thought、
工具和使用量；Cindy `cindy-dsh` activity panel 承载 plan/todo、terminal、tasks/jobs、workflow、
skills/extensions 与 runtime diagnostics。入口由真实 `Capabilities` 控制，所有新 UI 同时实现
Light / Dark、五种 locale 和正确的 loading / disconnect / unsupported 状态。

需要富交互的数据（计划树、terminal、任务树、MCP / plugin 状态）必须采用结构化 IPC payload
与专属 panel，而不是让模型生成 Markdown 充当控制面。若增加独立窗口，复用仓库的辅助窗口
生命周期基线和最小 preload；默认优先主界面 panel，避免另造平行 window 状态机。

### 10.2 SSH 远程工作区

完整远程 DSH 是远端 DSH Host 执行、远端 DSH Home 持久化、Desktop Main 经认证 SSH loopback
forward 连接的形态；绝不把远端 workdir 回落到本机 DSH，也不把本机 `DSH_HOME` 或 user profile
复制到远端。

- `maker-remote-ssh` 增加 DSH runtime 安装、版本 probe、hash / manifest 验证、远端 home 创建、
  Host health、端口转发和 teardown；安装失败让远端 DSH 不可用，不影响本机 DSH。
- 文件、附件、terminal、LSP、MCP 和 sandbox 均在远端语义下实现。Cindy 的远程文件服务只在
  native interface 明确需要时提供受控桥，不能用 Main 的本地 `fs` 假装读取远程 path。
- carrier 断开只重建该 remote Host scope 的 forward / follow；不能因一个远端 session 或一个
  手机 peer 的故障清掉本机或其它 remote session。恢复设计和测试必须回答
  `remote-and-mobile-adaptation.md` 的故障半径三问。

### 10.3 device-link 与 Mobile

Mobile 永远经被控 Desktop Main 调用 DSH；不暴露 Cindy bridge endpoint 或 credential。
device-link 新增 / 扩展的 channel、event 和 capability field 必须 append-only，具备 old-host / old-
mobile 的明确降级，并与服务端仓的本地协议实现同步。

| Mobile 能力 | 完整目标的行为 |
|---|---|
| 查看 / 继续任务 | 显示同一 DSH session、历史、plan、activity、job 与连接状态；断线后以 binding 恢复，不新建会话 |
| 输入 / 附件 | 仅当被控端 capability、文件传输和模型能力同时允许时开放；否则解释限制 |
| 审批 / stop / queue | 可处理 one-shot approval、cancel、queued prompt 和原生 interaction；所有动作仍在被控端验证归属 |
| terminal / tasks | 支持安全的只读观察与明确归属的控制；不能安全承载的交互应标为“请在桌面继续”，而非隐藏其存在 |
| profile / plugin 高风险设置 | 默认在 Desktop 完成；手机可显示状态并跳转 / 提醒，直到有同等的来源、授权和恢复 UX |

Mobile 的“完整”是任务连续性，不是机械复制 Desktop。任何暂不适配的能力必须有产品级限制说明和
跟踪项，不能让设备端把 DSH session 识别为未知 Agent 或 Claude。

## 11. 完整接入执行计划

每阶段独立 PR、独立验收；后续阶段不得用 mock 或静态源码假设跳过前序 gate。除 F0 外，每个
阶段先完成受影响 `AgentKind` inventory，再触及对应路径。所有会进入 system prompt 的内容一律
不在本计划内，除非维护者另行明确批准。

| 阶段 | 目标与主要交付 | 关键实现范围 | 退出门槛 |
|---|---|---|---|
| **F0：Cindy Bridge Gate** | 形成 release evidence packet、ACP compatibility fixture 与 Cindy bridge lifecycle contract | 受管 runtime、ACP v1 capability snapshot、Cindy `DshBridgePort` 命令/receipt/operation-timeout/EOF/exit 行为、许可 / notices、平台矩阵 | 同一制品证明 Cindy 通过公开 ACP 可创建、恢复（若 advertise）、follow/update、prompt、cancel、close；超时/断线均关闭 carrier、标记 reconcile 且绝不重发；不支持项诚实 capability-gate，而不是等待上游 Host |
| **F1：身份闭包** | `dsh` 成为第四个 AgentKind，且无 silent fallback | maker-core / Desktop / Mobile / device-link / model catalog / scheduler / search / DB decoder / remote type 的全量 inventory 和 exhaustive tests | 任意 dsh 输入从 DB、IPC、URL、mobile payload 到 UI 均保持 dsh；未知值显式拒绝，不归为 `cc` |
| **F2：受管 runtime 与 Host supervisor** | DSH binary distribution、Host scope registry、健康和有界清理 | `agent-binaries`、`tools/dsh`、Desktop Main `dsh-host/`、safe storage adapter、process monitor | hash / sidecar / platform / account switch / crash / stale endpoint / quit 通过；Renderer 无新增特权 |
| **F3：Cindy bridge 与 binding** | 可创建 / 恢复 ACP session，建立 DSH↔Cindy identity 和 projection cursor | maker-core DshAgent interface、Main bridge client、append-only migration、history/follow synchronizer | 多会话隔离、重启恢复、sequence gap 补齐、未知 receipt 不重发、无 raw-log scraping |
| **F4：通用 Agent 事件和交互** | text / thought / tool / usage / interaction / error 的无损映射 | DSH translator、`AgentEvent` 有限扩展、interaction resolver、usage accounting | 真实 event fixture 覆盖乱序、重复、缺字段、permission 关联、cancel / EOF；性能和准确性指标有实测 |
| **F5：Desktop 核心体验** | 创建、继续、模型/effort、附件、会话历史、tool approval、状态与恢复 UI | maker IPC、preload、renderer session / selector、i18n、Light / Dark | 真实本地 DSH 任务从创建到恢复完成；用户能看懂 capability、执行位置和失败恢复 |
| **F6：Cindy DSH activity 控制面** | plan/todo、commands、terminal、task/job/workflow/schedule activity panels | versioned `cindy-dsh` activity schema、panel reducer、terminal ownership / signal、job lifecycle | 每类 Cindy-owned object 有 identity、观察、控制、取消和 disconnect 语义；不会伪称为 DSH native object 或混入 Orca |
| **F7：MCP、skills、profiles 与 extensions** | 原生扩展与 Cindy 受控 bridge 并存 | home-mode settings、native settings UI、MCP factory / leases、plugin / profile lifecycle | 用户显式 native 操作可安装、更新、启停、恢复；secret 不泄露，内部 MCP 不越权 |
| **F8：SSH remote** | 远端 DSH Host 和完整远端任务连续性 | remote installer、home、forward、remote file / attachment / MCP / terminal adapters | 远端 create/resume/approval/terminal/reconnect 均在远端执行；本地和远端隔离、无 credential / path 串线 |
| **F9：device-link 与 Mobile** | 被控端投影与移动控制面 | protocol / allowlist、payload validator、Mobile reducers / UI、旧端降级 | 新旧 Desktop / Mobile 交叉矩阵通过；两个控制端并发时一个断线不影响另一个 |
| **F10：Orca 与 DSH 协作边界** | DSH session 可按显式策略参与 Orca，同时保留 native team 区别 | Orca policy、origin / provenance、budget / permission / result handoff | DSH native child 和 Orca worker 从 DB、UI、停止、审计到恢复均不混淆；不支持嵌套时明确拒绝 |
| **F11：发布与回归治理** | 多平台发布、升级、可观测性、文档从“方案”转为“维护不变量” | CI fixtures、release runners、upgrade / rollback、diagnostics、support runbook | §12 的完整验收矩阵、DCO、相关测试和安全 review 全通过，维护者批准后才可移除未准入标记 |

**阶段拆分规则**：F1–F4 可以先形成没有高级面板的 native foundation；F5–F7 完成“本机 Desktop
完整 DSH”；F8–F10 才完成 Cindy 全平台完整接入。任何提前演示必须写清所处阶段，例如“DSH
native Desktop foundation”，不得简称“完整 DSH”。

## 12. 验收、发布与持续兼容

### 12.1 分层验收矩阵

| 层 | 必须证明的事项 |
|---|---|
| 制品 / 供应链 | source tag→commit→tree/lockfile/build-script、Cindy build provenance、archive hash、tree manifest、sidecar、license、所有声明平台的启动与 ACP version/capability handshake |
| Cindy bridge | ACP version/capability negotiation、scope 隔离、多 session、active-handle close 后的 list / reconcile / resume、follow / cancel / close、异常 carrier、scope restart 和不确定结果 |
| 数据 | migration replay、旧三 Agent 无回归、dsh binding 唯一性、序列投影幂等、删除 / 归档 / fork provenance、损坏状态 reconcile |
| Agent 正确性 | event 顺序、tool / permission 关联、usage、模型路由、附件、MCP、plan / terminal / job state；translator 热路径性能与典型任务事件流 |
| 安全 | Renderer / Mobile 无 endpoint 或 secret、IPC sender / payload 校验、Home mode 隔离、profile / plugin 来源、MCP URL / token / lease、日志脱敏、退出无孤儿进程 |
| Desktop UX | Light / Dark、五 locale、capability-driven UI、断线 / unsupported / upgrade 提示、停止 / 恢复和用户可理解的 native activity 状态 |
| SSH / Mobile | 远端路径和凭证归属、forward 断线恢复、old/new 兼容、allowlist、至少两个 device-link peer 的故障半径回归 |
| 生态互操作 | Orca origin 分离、Cindy plugin / DSH plugin 不串权限、现有 Claude / Codex / Pi 的 session / model / remote 回归 |

### 12.2 每次 DSH 升级的兼容门

DSH 是快速演进的外部 runtime；升级不只是更新 manifest。每次 runtime、ACP capability、profile
或 Cindy bridge 版本变化都必须：

1. 重做 Part I §2 的制品对应和完整性证据，并新增 ACP capability / Cindy bridge contract diff。
2. 对 §9.1 的每个能力重跑真实 fixture；删除、重命名或语义变化的 event / setting / permission
   必须先更新 adapter、UI 和 migration / compatibility policy，不能靠 `unknown` 静默吞掉。
3. 运行至少本地 Desktop、支持的 Windows / Linux 发布 runner、SSH remote 和 device-link 的
   targeted integration suite；未支持的平台不注册 DSH。
4. 保持既有 DSH binding、managed Home、user-selected Home mode、已安装 native plugin / profile
   和任务历史可恢复。做不到自动迁移时，升级阻断并给出可逆的恢复计划；绝不要求用户重新
   登录、重装或丢弃会话来掩盖兼容问题。

### 12.3 PR 与发布纪律

- 涉及 Main、preload、IPC、Home、credential、database、protocol、remote 或 native process 的
  PR 必须在描述中逐项说明适用的专项规则、风险、实际验证、远程 / mobile 三选一结论；修改
  device-link 恢复还要回答故障半径三问。
- 每个提交遵守根 `AGENTS.md` 的 `pnpm test:unit:related`、受影响 package typecheck、DCO 和
  高风险定向测试门禁。文档-only 改动至少运行 `pnpm check:dev-docs` 与 `git diff --check`；不把
  未运行的测试写成已通过。
- 发布前由独立 reviewer 按本节矩阵做最终对抗性 review。P0 / P1（跨会话串线、秘密泄露、
  原生状态丢失、未知值回落其他 Agent、远程误落本机、破坏原生扩展恢复）任一未清零，均不得
  把 DSH 标记为完整可用。
