# Cindy 客户端架构说明

> 本文是对当前 Cindy 客户端仓库的架构导览，重点说明各层的职责、运行位置、数据归属与相互调用方式。
> 内容依据当前源码、workspace `package.json`、本地协议 package 及开发规则静态核对得出。
>
> **核对边界**：本文描述的是客户端仓库现状，不包含独立服务端的内部实现；本次未启动 Desktop、Mobile
> 或真实远程设备，因此运行期、人机验收和跨端线上兼容仍需另行验证。

## 1. 先给结论：Cindy 是什么架构

Cindy 不是把某一种模型重新实现一遍的聊天页面，而是一个以 Desktop 为执行宿主、以 Mobile 为控制端、以
共享 package 为能力层、以本地协议实现及跨仓兼容契约连接各端的 AI Agent 客户端。

它的核心职责是把以下对象连接起来：

```text
用户
  │
  ├─ Desktop Renderer / Mobile UI       查看状态、输入意图、审批、控制
  │
  ├─ Desktop Main                       本地数据、文件、进程、凭证、网络、权限
  │       │
  │       ├─ Maker Host → Maker Core    组织 Agent、模型、会话和事件流
  │       ├─ Local DB / Storage          保存产品数据与运行期索引
  │       ├─ MCP / Skill / Plugin        扩展工具、工作方法与富交互
  │       ├─ Scheduler / IM / Voice      自动派活、消息入口、语音输入
  │       └─ Device Link / SSH           连接其它设备与远程工作区
  │
  ├─ Claude Code / Codex / Pi            外部或随包 Agent Harness
  ├─ Models / Gateways / OAuth            模型与授权来源
  └─ Remote services                     独立服务端，不在本仓库内
```

从职责上看，可以把系统分为五层：

| 层 | 主要目录 | 主要问题 | 不能做什么 |
|---|---|---|---|
| 终端层 | `apps/desktop`、`apps/mobile` | 如何展示、输入、导航和控制 | 不能把 Renderer 当成可信系统层；Mobile 不直接执行 Agent |
| Desktop 宿主层 | `apps/desktop/src/main`、`preload` | 如何访问文件、数据库、进程、凭证、网络和 Electron | 不能把主进程能力直接暴露给网页或插件 |
| 能力 package 层 | `packages/*` | 如何抽象 Agent、模型、远程、调度、文件、MCP 等通用能力 | 不应反向依赖 Desktop Renderer/Main |
| 协议契约层 | `packages/*-protocol` 与相关 validator | 客户端、服务端、relay、插件和 Mobile 之间交换什么数据 | 不能由单端私自复制或漂移 |
| 外部执行层 | Agent CLI/SDK、SSH daemon、远程服务端 | 真正执行模型调用、工具调用、远程连接和云端业务 | 不属于本客户端仓库的可见实现 |

### 1.1 两个最重要的架构判断

1. **Desktop Main 是执行真相和系统权限边界。** Renderer 负责视图和交互；需要数据库、工作目录、Agent
   进程、密钥、系统能力时，都必须经 preload / IPC 进入 Main。
2. **Mobile 是远程控制端，不是第二个 Desktop。** Mobile 通过 device-link 调用被控 Desktop；会话、工作目录、
   Agent 进程和大部分持久数据仍归被控 Desktop 所有。

## 2. 仓库与依赖方向

### 2.1 顶层目录

| 路径 | 功能与用途 |
|---|---|
| `apps/` | 终端产品和随桌面端分发的二进制资产。当前主要是 Desktop、Mobile 与 Agent/工具 binary 包。 |
| `packages/` | 与平台无关或由宿主注入适配器的共享能力。Desktop 是主要集成宿主，Mobile 只使用其中一部分。 |
| `packages/*-protocol` | 客户端本地维护的 wire protocol package；服务端在其独立仓中维护兼容实现。当前包含 device-link、插件与 Slack hook 等契约。 |
| `config/` | 区域和环境相关的端点清单，启动早期解析，供鉴权、模型访问、device-link、更新等链路使用。 |
| `scripts/` | 依赖、开发启动、Agent binary、端点、文档、测试和 worktree 工具。 |
| `tools/` | Claude、Codex、ripgrep、Pi 等 Desktop runtime 的版本 pin 与更新脚本。 |
| `docs/` | 工程、产品、设计、协议、安全和架构规则；本文位于 `docs/architecture.md`。 |

### 2.2 依赖方向

```text
apps/desktop ───────────────┐
apps/mobile ────────────────┼──> packages/*
                            │
apps/desktop/mobile ────────┼──> packages/*-protocol
                            │
packages/* ────────────────> maker-shared / protocol / 外部 SDK（按包而定）

禁止：packages/* ──X──> apps/desktop/src/renderer
禁止：packages/* ──X──> apps/desktop/src/main
禁止：apps/mobile ──X──> Desktop 的 SQLite、Electron 或 Main 模块
```

这条方向使共享 package 可以在 Desktop、Mobile、远程 daemon 或测试中复用；平台相关行为通过 host 注入，例如：

- `@cindy/device-link` 不自己创建 WebSocket，而由 Desktop 或 Mobile 注入 WebSocket 实现。
- `@cindy/im` 不直接假设 Electron IPC、文件路径或凭证位置，由宿主注入存储和适配器。
- `@cindy/maker-core` 不知道 Electron、React、数据库和具体 UI，只接收 storage、logger、auth、MCP 等接口。

### 2.3 根工程与运行版本

根 `package.json` 将本仓库组织为 pnpm monorepo：

- Node.js：`>=22.12`
- pnpm：`>=10.7 <11`
- 当前 package manager pin：pnpm 10.33.2
- workspace：`apps/*`、`packages/*`

根脚本负责把“下载依赖 / 准备 Agent binary / 启动客户端 / 运行测试 / 打包发布”串起来；产品运行时的业务
逻辑仍在 Desktop、Mobile 和共享 package 中。

## 3. Desktop：执行宿主的完整分层

Desktop 使用 Electron + Vite + React。其关键不是“Electron 包装了一个网页”，而是 Electron 的三个进程边界
把 UI、系统能力和协议适配拆开：

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron Main                                                 │
│  bootstrap / windows / auth / DB / Maker / IPC / protocols     │
│  filesystem / subprocess / credentials / device-link / update │
└───────────────▲───────────────────────┬──────────────────────┘
                │ typed contextBridge   │ IPC invoke / push
┌───────────────┴───────────────────────▼──────────────────────┐
│ Preload                                                       │
│  fixed electronAPI surface; validate input/output; no raw IPC  │
└───────────────▲───────────────────────┬──────────────────────┘
                │ window.electronAPI    │ controlled events
┌───────────────┴───────────────────────▼──────────────────────┐
│ Renderer                                                      │
│  React routes / layout / feature / store / local view state    │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Main 进程

入口文件是 [`apps/desktop/src/main/index.ts`](../apps/desktop/src/main/index.ts)。它是启动前置门：

1. 解析区域、userData、开发模式、隔离 profile 和 device identity。
2. 在加载更多主进程模块前准备 logger、PATH、机器 ID，并清理不应泄漏给 Agent 的环境变量。
3. 安装 device-link 的 IPC invoke capture，使后续注册的 IPC 能被远程控制链路捕获。
4. 进入 [`bootstrap-electron.ts`](../apps/desktop/src/main/bootstrap-electron.ts)，等待 Electron `ready`，然后注册窗口、协议、IPC 和各宿主服务。

源码当前使用 `index.ts` 的 bootstrap boundary 动态加载 `bootstrap-electron.ts`；仓库架构规则要求 Main 的常规
依赖使用顶层静态 import。这里是现状与规则之间需要注意的实现细节，不应在新代码中继续扩大动态加载边界。

`bootstrap-electron.ts` 的职责是总装配，而不是单一业务模块。启动的大致顺序是：

```text
Electron ready
  → 解析并校验 client endpoint manifest
  → 注册 endpoint IPC / model access / auth 相关早期能力
  → 注册媒体、模型、文件、remote media 等自定义协议
  → 安装主文档 CSP 与窗口/WebView 安全策略
  → 注册通用 IPC、文件浏览和 Local DB IPC
  → 创建主窗口与辅助窗口
  → splash / 环境检查 / Agent binary provision
  → 装配 Maker、MCP、scheduler、voice、device-link、IM、plugin 等宿主
  → 对 renderer 广播状态，进入正常运行
```

#### Main 的模块分区

| 目录或模块 | 功能 | 为什么放在 Main |
|---|---|---|
| `main/bootstrap-electron.ts` | Electron 生命周期、窗口、协议、CSP、全局注册顺序 | 需要最早掌握应用生命周期和系统权限 |
| `main/maker-host/` | 创建并配置 Maker 单例，注入 DB、认证、模型、MCP、Agent runtime 和远程适配器 | 只有 Main 能安全持有凭证、进程和工作目录能力 |
| `main/maker-ipc/` | 把 Maker 能力映射为 `maker:*` IPC；处理 session、输入、权限、交互和事件推送 | 统一 renderer、Mobile/remote 与 MCP 进入核心运行时的边界 |
| `main/localDb/` | SQLite、Drizzle schema、migration、DB worker/transport、备份、恢复和 DB IPC | 数据库是用户数据和账号 owner 级资源，必须由 Main 独占管理 |
| `main/device-link/` | Desktop 作为控制端或被控端接入 device-link，处理 dispatch、allowlist、presence、重连、owner 和媒体 | 设备连接会触及凭证、IPC 和其它窗口/进程 |
| `main/mcp-integrations/` | 浏览器、电脑、Android、Codex MCP bridge、LSP、SSH、通讯录等宿主接入 | MCP 工具可能读写文件、调用系统或进入远程环境 |
| `main/cindy-brain/` | 插件运行时、Ghost bridge、沙箱、能力 slot、权限与插件生命周期 | 插件是不可信代码，必须在宿主隔离和授权后运行 |
| `main/plugin-market/` | `.cindy` 插件来源、下载、安装、权限 review、安装 ledger | 分发和批准状态属于宿主可信数据 |
| `main/skillhub/` | Skill/command/agent 文件扫描、frontmatter 校验、市场同步、安装、发布和使用索引 | Skill 会进入 Agent 工作流，需要统一校验和落盘 |
| `main/scheduler-host/` | 把 cron 引擎接到 DB、Maker、脚本能力和通知渠道 | 定时执行不能由 renderer 是否打开来决定 |
| `main/im/` | 飞书、Telegram、Discord、企业微信、钉钉、WeChat 等消息入口和出站适配 | IM 连接与凭证、附件和后台生命周期相关 |
| `main/voice-input/` | Desktop 麦克风、ASR provider、润色、字典和持久化 | 需要系统音频权限、网络与本地设置 |
| `main/remote-ssh/` | SSH 连接池、远端 Agent、remote file service、cc-manager 配置 | 远端工作目录与进程不能误读为本机资源 |
| `main/git-*` / `main/worktree/` | Git 快照、上下文、review、worktree 创建/恢复 | 涉及真实项目文件和不可逆操作，需要 Main 控制 |
| `main/updateService.ts` | Electron 侧更新服务 | 更新过程可替换整个客户端，属于高风险生命周期能力 |
| `main/log-upload/` | 日志定位、脱敏、崩溃标记与待补传 | 可能接触用户内容和授权边界，必须遵循白名单脱敏链路 |

### 3.2 Preload：最小且固定的桥

[`apps/desktop/src/preload/preload.ts`](../apps/desktop/src/preload/preload.ts) 通过
`contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露命名 API。它的主要用途是：

- 将 `maker:*`、Local DB、device-link、文件浏览、SSH、voice、plugin、window 等能力变成可审计的固定接口。
- 对事件和部分入参做运行期校验，避免 renderer 直接发送任意 IPC channel。
- 将 Main 的错误、状态和异步事件转换成 renderer 可消费的契约。
- 不暴露原始 `ipcRenderer`，不让 renderer 自己拼任意 channel。

插件 WebView 使用独立的 [`ghostPreload.ts`](../apps/desktop/src/preload/ghostPreload.ts)，桥面更窄；插件面板
本身不应获得主应用的完整 `electronAPI`。

### 3.3 Renderer：视图、交互和派生状态

Renderer 入口是 [`apps/desktop/src/renderer/index.tsx`](../apps/desktop/src/renderer/index.tsx)，主要负责字体、i18n、
主题、全局诊断、utility view 判定和 React root 初始化。应用壳在
[`apps/desktop/src/renderer/App.tsx`](../apps/desktop/src/renderer/App.tsx)：

- 建立 `ThemeProvider`、`LocaleProvider`、`AuthProvider`、`WorktreeProvider`、`EnvCheckProvider` 等全局上下文。
- 连接 `makerChatStore` 的全局 Agent 事件监听。
- 处理登录 owner 变化、DB gate、Maker bootstrap、scheduler 通知、插件确认和全局错误提示。
- 将 UI 偏好同步给 Main 或 device-link 被控端。

路由在 [`router.tsx`](../apps/desktop/src/renderer/router.tsx) 中分三层：

| 路由层 | 作用 |
|---|---|
| `GuestRoute` | 未登录入口，当前主要是 `/login`。 |
| `ProtectedRoute` | 只允许已认证用户进入产品壳。 |
| `LocalDbGate` | 按当前 userId 等待 Main 完成本地 DB owner 切换；数据库未就绪时不进入主功能区。 |

主路由包含：

- `cc-agent`：新建任务、任务列表、任务详情、工作目录文件浏览、Orca 协同。
- `scheduled`：自动化/定时执行管理。
- `skillhub`：本地 Skill 与市场。
- `plugins`：插件管理。
- `settings`：账号、模型、偏好和系统配置。
- `issues` 与 `maker-experimental`：问题入口和运行链路诊断。
- `sidebar-window`、`ghost-panel-window`：从主窗口拆出的辅助窗口。

这里的“任务”是产品层可独立打开、删除、重命名的 session；“对话”用于任务内的交流过程或没有项目归属的
workspace 分类；单条往来称为“消息”。代码中仍大量使用 `session`、`chat`、`message` 等内部术语，不能把
这些内部名词机械替换成一个中文词。

### 3.4 主界面布局树

主界面不是若干写死的左右栏，而是共享布局树：

- [`shared/layoutTree.ts`](../apps/desktop/src/shared/layoutTree.ts)：定义递归 split/pane 结构、默认布局、校验、
  合法变换和 `chat-main` 不变量。
- [`main/layout/LayoutStore.ts`](../apps/desktop/src/main/layout/LayoutStore.ts)：把用户级布局保存在
  `userData/layout.v1.json`，启动时同步读取，非法或损坏时自愈为默认树，并使用原子写入。
- `renderer/layout/LayoutRoot.tsx`：把布局树渲染为 pane、split 和拖拽交互。
- `renderer/panels/registry.ts`、`builtinPanels.tsx`：以 `panelKind` 注册面板能力和折叠语义。

当前布局不变量：

1. `chat-main` 在整棵树中恰好一个、可见、不可关闭、不可折叠，最小宽度 400px。
2. 面板身份看 `panelKind`，不看它当前位于左侧还是右侧。
3. 未注册或暂时抽离的面板可以保留在存档中，但不渲染；重新注入后恢复原位置。
4. 布局是用户级配置，不是某个任务的会话数据；首帧应直接使用用户布局，不能先显示默认布局再跳变。

### 3.5 Session 数据与 Agent 事件如何到达 UI

[`renderer/lib/makerChatStore.ts`](../apps/desktop/src/renderer/lib/makerChatStore.ts) 是 renderer 侧的会话事件投影层：

```text
Agent SDK / CLI
      ↓ vendor event
maker-core translator
      ↓ AgentEvent
Maker Session
      ↓ Maker process-level event listener
maker-ipc → maker:event / maker:* push
      ↓ preload fan-out
makerChatStore（按 sessionId 分片）
      ↓
消息、状态、队列、交互请求、usage、UI 组件
```

它用 module-level `Map<sessionId, ...>` 保存每个任务的 UI 投影，并只安装一组全局 IPC listener，再把事件按
任务 ID 路由到对应分片。这样组件卸载、路由切换或任务暂时不可见时，不会错误地清理仍在运行的 Agent。

Renderer 侧的 [`sessionService.ts`](../apps/desktop/src/renderer/lib/sessionService.ts) 和
[`makerTransport.ts`](../apps/desktop/src/renderer/lib/makerTransport.ts) 进一步把“任务数据来自本机还是远程设备”
隐藏在同一套 UI API 后面。

## 4. Desktop 本地数据与持久化

### 4.1 Local DB

[`apps/desktop/src/main/localDb/index.ts`](../apps/desktop/src/main/localDb/index.ts) 是 SQLite 运行入口，使用
`better-sqlite3`、Drizzle 和独立的 migration 链。数据库由 Main 管理，按用户保存于：

```text
<Electron userData>/<brand db prefix>-<userId>.db
```

它负责：

- userId 切换时关闭旧库、打开新库。
- schema migration、schema drift 检测、备份、损坏恢复和兼容策略。
- SQLite WAL/crash recovery、SQLite vector 能力以及 DB client/worker transport。
- 将 DB readiness 作为登录后进入主应用和启动 scheduler/embedding 等后台服务的前置条件。

`apps/desktop/src/main/localDb/schema.ts` 及 `drizzle/` 保存 schema 和 migration。产品持久数据通常包括：

| 数据 | 用途 |
|---|---|
| sessions / messages | 任务元数据、对话内容、消息和 fork/branch 关系 |
| projects / aliases / workdir metadata | 项目、工作目录和远程项目的关联 |
| model/provider/session preferences | 模型、provider、effort、权限档和任务级偏好 |
| scheduler tables / run records | 定时配置、运行状态、结果索引和未读状态 |
| Orca team/worker records | Lead、Worker、team 和聚焦 worker 的持久元数据 |
| plugin/skill records | 安装、启用、市场、使用和权限相关的产品状态 |
| media references / ledgers | 附件、图片、视频等媒体的归属、引用和回收索引 |

运行中的 Agent 状态不等同于 DB 状态：Maker/Session 内存中保留当前进程、事件队列、交互 resolver 和 watchdog；
DB 负责恢复所需的产品记录和历史。两者通过 host 的生命周期同步钩子关联，不能把 UI 投影或某个 DB 字段单独当成
正在运行的 Agent 真相。

### 4.2 凭证与文件位置

- Desktop 凭证由 Main 的 auth/credential store 和 Electron `safeStorage` 管理，不能下放给 Renderer、插件或
  通用 device-link payload。
- Mobile 使用 SecureStore 等平台安全存储。
- Cindy 管理的持久数据应进入 Electron `userData`；临时文件应进入系统 temp 目录下的任务专属目录；不能以
  `process.cwd()` 或仓库根作为持久数据、凭证或临时文件回退路径。
- 插件只能通过 Host 授权的 grant/deposit/ledger 交换附件、目录和媒体，不能拿到不必要的宿主绝对路径。

## 5. Maker：Agent 编排核心

### 5.1 Maker Host 与 Maker Core 的关系

```text
Electron Main
  └─ maker-host
      ├─ Local DB / SessionStorage adapter
      ├─ auth / safe credential adapter
      ├─ model providers / route resolver
      ├─ MCP provider factory
      ├─ SSH / remote-file / cc-manager adapter
      ├─ Claude / Codex / Pi runtime config
      └─ lifecycle hooks / logger / usage / memory
              ↓ 注入依赖
        @cindy/maker-core
              ↓ 统一抽象
        Maker → Session → BaseAgent / vendor adapter
```

`main/maker-host/` 是 Desktop 适配层，负责把 Electron、SQLite、凭证、模型 catalog、MCP 和远程运行时装配起来。
它可以控制系统资源，但不应把这些细节扩散进共享核心。

`packages/maker-core` 是平台中立的 Agent 运行时：

| 组件 | 功能与用途 |
|---|---|
| `Maker` | 注册不同 `AgentKind` 的 BaseAgent；以 `(agentKind, workDir)` 等上下文创建和复用 session；维护 active session、Codex thread claim、singleflight 与生命周期钩子。 |
| `Session` | 一个 Agent session 的运行包装器；负责发送输入、订阅事件、交互决策、权限/能力切换、状态和 stall watchdog。 |
| `agents/base-agent.ts` | Agent vendor 适配器的公共基类和生命周期接口。 |
| `agents/claude-code` | Claude Code SDK/CLI 的连接与事件翻译。 |
| `agents/codex` | Codex app-server、thread、MCP context 和 Responses 路由。 |
| `agents/pi` | Pi harness 的可选接入，拥有独立环境和 MCP 适配。 |
| `agents/shared` | AsyncQueue、usage 计量、自动 compact/review、网络错误、图片大小等共用原语。 |
| `interfaces/*` | `SessionStorage`、`Logger`、`AuthAdapter`、`McpProvider`、运行时配置等宿主注入接口。 |
| translators | 把 Claude/Codex/Pi 的 vendor event 转成统一 `AgentEvent`，供 Maker IPC 和 UI 消费。 |

Maker Core 不负责：UI、Electron、产品账号流程、具体 DB 查询、插件界面、服务端请求策略或凭证文件位置。这些都
由 Host 或上层负责。

### 5.2 Agent 运行时与 binary

Desktop 随包使用或按需准备 Claude Code、Codex、Pi、ripgrep 等 runtime：

- `apps/claude-code-bin`、`apps/codex-bin`、`apps/ripgrep-bin` 保存平台分发入口，不把实际二进制直接当源码维护。
- `tools/*/latest.json` 保存版本 pin。
- `scripts/ensure-agent-binaries.mjs` 负责安装、校验和准备。
- 远程 SSH 场景会把所需 runtime/bundle 和 daemon 安装到远端，并通过 remote-forward 或 NDJSON RPC 连接。

不同 Agent 的执行方式不同，但上层目标一致：把 vendor-specific 的输入、事件、交互和 usage 映射到统一的
Maker/Session 契约中。

### 5.3 模型与协议桥

模型链路分为“目录/路由”和“协议转换”两层：

| 模块 | 功能 |
|---|---|
| `@cindy/model-providers` | provider catalog、模型可见性、路由选择、OAuth/API key/source、effort/fast mode 等纯逻辑。 |
| `@cindy/model-providers` | 客户端侧模型 catalog/registry 的 wire types、严格解析与路由逻辑。 |
| `@cindy/anthropic-compat-proxy` | 本地 loopback HTTP proxy，剥离非 Anthropic 后端无法理解的 Anthropic 专属字段，让 Claude SDK 通过网关访问其它模型。 |
| `@cindy/anthropic-responses-bridge` | Anthropic Messages 与 OpenAI Responses 的 loopback 转换，供 Claude SDK 使用 ChatGPT subscription/xAI 等 native route。 |
| `@cindy/responses-anthropic-bridge` | 进程内 OpenAI Responses ↔ Anthropic Messages 转换。 |
| `@cindy/responses-chat-bridge` | 进程内 OpenAI Responses ↔ Chat Completions 转换。 |
| `@cindy/embedding-client` | 通过网关调用 OpenAI 兼容 embeddings API；Desktop host 负责生命周期。 |

这组桥的价值是让上层 Agent 会话保持统一，而把 provider 和 wire format 的差异收敛在连接层；它们不应偷偷改变
Agent 事件顺序、工具能力或 system prompt 语义。

## 6. 工具、MCP、Skill 与插件

### 6.1 MCP：能力接入层

`packages/lizi-mcps`（package name 为 `@cindy/mcps`）提供可复用的 MCP server 集合，Desktop 的 `main/mcp-integrations` 负责按本机环境和用户配置
创建 provider/bridge，再以 `McpProvider` 注入 Maker Core。典型能力包括：

- 浏览器与 computer control。
- Android/ADB、LSP、SSH 和远程文件。
- GitHub、GitLab、联系人、记忆、embedding。
- scheduler、IM、Orca。
- Codex HTTP MCP bridge 和 thread/session context。

MCP 的作用是“让 Agent 能够调用某项能力”，不是让 Renderer 直接调用系统。工具是否可见、是否可用以及实际调用
时的身份/权限，最终仍由 Main host 和具体 server handler 决定。

### 6.2 SkillHub：可复用工作方法

Skill 是描述“工作如何完成”的可复用方法，通常由 markdown/frontmatter、脚本或工具编排构成。Desktop 的
`main/skillhub` 负责：

1. 扫描 global/project 层级的 Skill、command、agent 文件。
2. 校验 frontmatter、命名、来源和项目归属。
3. 以原子写入编辑内容，并维护本地索引和使用记录。
4. 对接 Skill 市场的同步、安装、发布和协议包。
5. 将被允许的 Skill 交给 Agent 工作流；不把 Skill 本身变成任意主机权限。

Skill 的协议和分发契约由 SkillHub 与相应服务端实现共同维护。

### 6.3 插件：沙箱化的富交互能力

插件的用户形态是 `.cindy` 包，代码中沿用 `Ghost` / `cindy-brain` 命名。相关模块关系如下：

```text
SkillHub / 手动 .cindy 包
          ↓ manifest / package validation
plugin-market + install ledger + permission review
          ↓ approved manifest
GhostManager / GhostRuntime
          ↓ isolated Electron sandbox + session partition
network / notify / confirm / fs / skill / agent / cindy slots
          ↓ typed cindy.send / cindy.onHostMessage
Ghost panel / plugin UI
```

插件基座的关键职责：

- 每个运行中的插件使用独立沙箱进程和 session partition，不直接访问 Node、宿主文件系统或网络。
- 插件只能通过最小 contextBridge 管子申请能力；主机按实际 `webContents` 反查 ghost identity，不信任 sender 自报。
- 能力必须先在 manifest 声明 slot，经过校验、权限展示和 Host 强制授权；prompt 或前端文案不是安全边界。
- 网络使用 manifest 域名白名单；凭证由 Host 注入，不能明文读回插件。
- 附件、媒体、目录、保存路径用 grant/deposit/ledger 交接，避免暴露宿主绝对路径。
- 已安装、已批准、已启用的存量插件升级后必须继续可用；批准记录、指纹、manifest、slot、安装布局等改动必须
  带旧数据迁移和升级用例。

插件协议和 manifest/delivery contract 由 `@cindy/plugin-protocol` 提供；插件运行时的具体安全实现位于
`apps/desktop/src/main/cindy-brain/`、`main/plugin-market/`、`shared/ghost.ts` 和对应 renderer feature。

## 7. Orca：多 Agent 协同

Orca 是 Desktop 内的多 Agent 协同系统，而不是一次性 subagent API：

```text
Lead session
  ├─ start team
  ├─ create worker(s)
  ├─ send / queue / update / cancel worker message
  ├─ focus worker in split view
  └─ inspect / accept / archive
          ↓
Worker session（完整 Agent session，有自己的模型、工具、上下文和事件流）
```

当前实现要点：

- 一个 active team 绑定一个 Lead session。
- Worker 是完整 session，不是无状态函数调用。
- DB 用 `sessions.orca_role`、`orca_teams` 和 `orca_workers` 保存协同元数据；fork 关系使用独立的
  `parent_session_id` / `forked_at_message_id`，不能与 Orca role 混用。
- renderer 使用 `OrcaSplitView` 和 focused worker pane；当前不是多个 worker 同时并排显示。
- UI IPC 与 `cindy_orca` MCP 共用 Main 侧 Orca service，避免两套状态机。
- Lead/Worker 的生命周期、worker 创建、队列消息和 inter-agent dispatch 分别由 Orca service 负责。
- Codex 的 MCP 工具是全局注册、调用时恢复 thread context，再由 handler 拒绝越权；不能把 MCP transport session id
  当作 maker session 身份。
- device-link 被控场景中，Lead、Worker 和 team 都在被控 Desktop 内真实运行，控制端只是镜像。

Orca 的主要实现入口：

- `apps/desktop/src/main/maker-ipc/orca*`
- `apps/desktop/src/renderer/features/cc-agent/OrcaSplitView.tsx`
- `packages/orca-workflow`
- `packages/maker-core` 的 Codex MCP context
- `packages/lizi-mcps` 的 Orca server

详细状态契约以 [`orca-team-architecture.md`](dev-rules/orca-team-architecture.md) 和当前源码为准。

## 8. 远程能力：SSH、Desktop-to-Desktop 与 Mobile

远程场景不是把本地 API 的 URL 换一下，而是三种不同的拓扑。

### 8.1 SSH 远程工作区

```text
本地 Desktop Main
  ├─ maker-remote-ssh：连接池、认证、远程 host
  ├─ remote-file-service：远程目录扫描、搜索、预览
  └─ maker-cc-manager：远端 Claude SDK 多 session daemon
          │ SSH exec / stdio / remote-forward
远程主机
  ├─ 工作目录
  ├─ Agent runtime / daemon
  └─ 远程文件与工具
```

路径和进程真正位于远端时，本地 Main 不能直接用本机 `fs` 访问；必须经 remote-file-service、cc-manager、SSH exec
或已有的远程通道。远程 Codex/Claude 的 MCP bridge 也需要按 host 建立 remote-forward 和身份上下文。

### 8.2 Desktop-to-Desktop device-link

device-link 分两层：

1. `@cindy/device-link-protocol` 定义 relay envelope、routing、hello/presence、ping、
   link-open/accept/close、invoke/result/push 等 wire 语义。
2. `packages/device-link` 定义客户端重连、heartbeat、IPC allowlist、topic 和 host 注入的 WebSocket client。

被控端 Desktop 仍拥有真正的 DB、Maker、文件、Agent、插件和凭证；控制端只通过被控端白名单 channel 调用并订阅
推送。relay 只负责路由，不应在客户端另造一份协议。

Desktop renderer 的 [`makerTransport.ts`](../apps/desktop/src/renderer/lib/makerTransport.ts) 对上层 UI 提供透明路由：

```text
sessionId
  ├─ 本地 session  → window.electronAPI.maker / localDb service
  └─ 远程 session  → deviceLink.invoke(deviceId, channel, args)
```

它还维护 sticky session origin，避免 relay 瞬时重连期间把远程 mutation 错发到控制端本机；远程 mirror cache 则
负责 owner token、invalidation 和消息快照。

### 8.3 Mobile

Mobile 是 Expo / React Native 客户端，直接依赖的核心共享包是：

- `@cindy/auth-client`
- `@cindy/device-link`
- `@cindy/maker-shared`
- `@cindy/model-providers`
- `@cindy/voice-input-core`

根入口 [`apps/mobile/app/_layout.tsx`](../apps/mobile/app/_layout.tsx) 的 gate 顺序包括：

```text
endpoint manifest
  → OTA / canary / forced-update gates
  → AuthProvider
  → DeviceLinkProvider
  → Push notifications / worktree recovery
  → NavigationGate
  → Expo Router pages
```

Mobile 主要页面和职责：

| 页面/目录 | 功能 |
|---|---|
| `app/(auth)/login` | 登录、账号初始化和登录 handoff。 |
| `app/devices` | 发现设备、查看在线状态和进入被控 Desktop。 |
| `app/sessions` | 任务列表、创建任务、消息流、输入、停止和交互审批。 |
| `app/files` | 远程工作目录浏览、预览和导出。 |
| `app/automations` | 远程查看和控制自动化/定时配置。 |
| `src/device-link/DeviceLinkContext.tsx` | WebSocket 生命周期、presence、重连、后台释放、topic registry、rehydrate 和响应性熔断。 |
| `src/device-link/mobileMakerTransport.ts` | 把 Mobile 操作转换成被控 Desktop 的稳定 `maker:*`、文件、voice 和 schedule channel。 |
| `src/session/remoteSessionStore.ts` | 保存远程任务镜像、消息、状态和失效/重连处理。 |
| `modules/`、`plugins/` | 原生音频、TapDB、WeChat 登录、iOS 分发等进入 runtime fingerprint 的原生能力。 |

Mobile 不直接打开 Desktop SQLite，不启动 Claude/Codex/Pi，也不拥有远程工作目录。它把适合手机的查看、输入、审批
和控制呈现出来，而把执行职责留给 Desktop。

## 9. Device-link 协议与状态流

### 9.1 基本请求流

```text
Mobile / remote Desktop
      │ invoke(deviceId, channel, args)
      ▼
DeviceLinkClient
      │ envelope + allowlist + relay
      ▼
被控 Desktop Main dispatch
      │ IPC handler / maker handler
      ▼
真实 session / DB / file / scheduler
      │ result 或 push topic
      ▼
控制端 cache/store/UI
```

### 9.2 重连与故障半径

Device-link 是 1:N 拓扑：一个被控端和 relay 之间的连接可能同时服务多个控制端。因此恢复逻辑要区分：

- 单个请求失败：只处理该请求。
- 单个 peer/link 停止 ACK：只处理该 peer 的 link。
- relay 连接断开：才处理整条连接。

不能把一个手机退后台造成的单 peer 问题放大成所有控制端一起掉线。presence 是设备可用性的权威判断；普通请求
应答是额外的直达证据，但不能随意覆盖 relay 的 unavailable verdict。

### 9.3 IPC allowlist

远程 channel 不是“本地存在就自动可用”。任何涉及远程/手机版的 invoke、push 或 topic，都要在
`packages/device-link/src/allowlist.ts` 登记，并保证控制端与被控端版本对未知 channel 采取安全降级。新 channel
若只注册了 Desktop IPC、没有登记 allowlist，静态类型检查可能通过，但 Mobile 运行时仍然不可用。

## 10. Scheduler、IM、Voice、Git 与其它横向能力

这些能力不直接改变 Maker Core 的职责，而是由 Desktop Host 把共享 package 接入应用生命周期。

### 10.1 Scheduler

`@cindy/maker-scheduler` 是纯 cron engine 和 storage/runner/notifier interface；Desktop 的
`main/scheduler-host` 注入：

- Drizzle storage。
- `MakerScheduleRunner` 和脚本 runner。
- capability broker、锁和项目自动化加载器。
- Desktop、飞书、企业微信等 notifier。
- DB ready、Maker ready、Agent binary ready 后的启动顺序。

因此定时执行不依赖 renderer 是否打开；开发时的 passive mode 可以禁用自动触发，避免共享 userData 被开发实例误派活。

### 10.2 IM 与 WeChat

`@cindy/im` 提供可复用的 IM transport、凭证存储接口、冲突检测、附件下载和统一出站 API；Desktop Main 负责具体
channel 的连接生命周期和 IPC。`@cindy/wechat-ilink` 是 Electron-agnostic 的 Tencent iLink personal WeChat
协议客户端。IM 的职责是把外部消息接入 Cindy 的任务/自动化入口，不取代 Maker 的会话编排。

### 10.3 Voice

`@cindy/voice-input-core` 提供 provider-neutral 的听写状态机、润色 guard 和字典同步；Desktop 负责麦克风、
provider、持久化和 overlay，Mobile 负责原生录音/音频和远程 voice channel；跨端 payload
以对应客户端与服务端的兼容契约为准。

### 10.4 Git、Worktree 与文件浏览

- `@cindy/file-browser-core` 统一 workdir 扫描、ignore、ripgrep list/search、二进制判定和路径安全。
- `@cindy/remote-file-service` 把同一套语义放到 SSH 远端，以 NDJSON RPC 暴露。
- Desktop `main/git-*`、`main/worktree` 负责 snapshot、context、review、branch/worktree 等真实项目操作。
- Renderer 只消费文件树、diff 和状态，不直接读工作目录。

## 11. 跨端协议：本地实现与兼容契约

协议 package 是客户端内的本地实现；服务端在独立仓维护兼容实现。客户端不再依赖协议
submodule：两端以稳定 wire 语义、fixture 和发布协调来维持兼容。

| 协议包 | 功能 |
|---|---|
| `@cindy/device-link-protocol` | relay envelope、路由语义、连接层 payload 和协议版本。 |
| `packages/model-providers` | 模型 catalog、registry、严格解析和 canonical serialization。 |
| `@cindy/plugin-protocol` | 插件 manifest 和 Desktop 插件分发契约。 |
| `@cindy/slack-hook-protocol` | Slack hook server 与 Desktop 之间的双工任务协议。 |

修改这些协议时，必须同时考虑服务端兼容、两端实现的可追溯版本、relay 与 device-link 的边界，以及旧客户端
的降级行为。不能只在 Desktop 或 Mobile 中手工复制一套类型就认为协议已完成。

## 12. 安全边界与信任模型

```text
不可信输入
  ├─ Renderer UI 状态与表单
  ├─ 外部网页 / WebView
  ├─ 插件进程与插件消息
  ├─ 远程设备请求
  ├─ Agent 输出与 MCP 参数
  └─ 外部 IM / webhook
          │ 经过 schema、allowlist、owner/session/manifest 校验
          ▼
可信宿主动作
  ├─ Main IPC handler
  ├─ DB / file / credential adapter
  ├─ Maker host / session identity
  ├─ plugin capability slot
  └─ device-link dispatch
```

关键原则：

- Renderer 没有 Node、文件系统、数据库和凭证权限。
- Preload 只提供固定、最小、可审计的 contextBridge。
- Main 在 sender、owner、session instance、remote identity、manifest、路径 canonical realpath 和能力 slot 上
  重新校验，不能只相信 UI 传来的字段。
- WebView、外部 URL 和插件面板使用隔离 session、导航规则、CSP 和外部浏览器打开策略。
- Agent prompt 不是权限边界；插件 prompt、UI 确认文案和“工具可见”也不是权限边界。
- 远程调用必须同时满足 protocol、allowlist、设备状态、session 来源和被控端 handler 校验。
- 日志和崩溃上报只能使用 deny-by-default 的来源白名单；不能为了调试把用户消息和凭证混入日志。

## 13. 启动、构建、发布和验证链路

### 13.1 Desktop 开发启动

```text
pnpm dev:desktop / dev:desktop:remote
  → ensure-deps
  → ensure-dev-runtime-assets
  → build:remote-bundles
  → Electron Forge + Vite
  → Main bootstrap + Renderer
```

远程开发会显式使用端点和登录态；`--isolated` 或独立 userData 用于多实例、迁移和不污染正式数据的验证。

### 13.2 Desktop 构建与发布

```text
依赖与 Agent binary pin
  → remote bundle
  → Electron/Vite build
  → package / make
  → 平台安装包与 updater 资源
```

Desktop 更新器由 `apps/desktop/cindy-updater/` 和 Main 的 `updateService.ts` 组成；这是影响所有已安装用户的高风险
链路，普通架构说明只描述其位置，不把它当作普通业务模块修改。

### 13.3 Mobile 构建与发布

Mobile 使用 Expo / React Native / Expo Router：

- OTA、canary 和 forced-update 在根布局 gate 中先于业务页面决定是否进入产品树。
- 原生模块、`app.json`、config plugin、`eas.json`、`apps/mobile/package.json` 等会影响 runtime fingerprint；
  非必要不要改动它们。
- Mobile 的真实跨端行为需要 device-link smoke、模拟器/真机或 native E2E，不能只靠 TypeScript 检查。

### 13.4 验证层级

| 验证 | 适合发现的问题 |
|---|---|
| `git diff --check` | Markdown/源码空白错误。 |
| `pnpm check:dev-docs` | 开发文档命令、内链和仓库文档契约。 |
| package typecheck | package/API、跨层类型不一致。 |
| Desktop unit / migration / DB tests | IPC、Maker、DB schema、历史数据兼容。 |
| Mobile smoke / device-link tests | 远程路由、缓存、presence、重连和 Mobile 页面。 |
| Desktop/Mobile 实机或真实远程运行 | 窗口、权限、凭证、Agent binary、relay 和用户体验。 |

静态检查通过不代表真实 device-link、SSH、Agent binary、模型 provider 或插件运行时已经验收；这些属于不同的
证据层级。

## 14. 典型调用链

### 14.1 本地 Desktop 创建并运行任务

```text
Renderer 新建任务
  → preload electronAPI.maker / session API
  → Main maker-ipc
  → Local DB 创建 session 元数据
  → maker-host getMaker()
  → Maker 创建/恢复 Session
  → Claude/Codex/Pi adapter 启动 vendor runtime
  → MCP/model/credential adapter
  → AgentEvent
  → maker:event
  → makerChatStore
  → 消息、工具调用、状态、交互和 usage UI
```

### 14.2 Mobile 控制一个 Desktop 任务

```text
Mobile page
  → mobileMakerTransport
  → DeviceLinkProvider.invoke(deviceId, 'maker:*', args)
  → relay envelope
  → 被控 Desktop device-link dispatch
  → 被控端 maker-ipc / localDb / Maker
  → result 或 session topic push
  → Mobile remoteSessionStore
  → 手机页面更新
```

### 14.3 Agent 使用工具

```text
Agent runtime
  → Maker Core MCP provider
  → Main MCP integration / MCP server
  → browser / file / Git / scheduler / IM / Orca / plugin slot
  → 结构化结果
  → translator → AgentEvent → UI / 下一步 Agent loop
```

### 14.4 定时任务派活

```text
DB schedule
  → scheduler-host cron runner
  → lock / capability broker / project automation
  → MakerScheduleRunner 或 ScriptRunner
  → Maker session / Agent runtime
  → DB run record + notification
```

## 15. 架构优点、风险与当前边界

### 15.1 优点

- **执行与控制分离**：Desktop 能做重执行，Mobile 能做轻控制；同一任务可以跨设备继续。
- **Agent 可替换**：Claude Code、Codex、Pi 通过 Maker Core 共享 Session、事件和 UI 契约。
- **协议与平台解耦**：wire contract 放在本地 protocol package 和兼容实现中，平台实现放在 host，减少跨端复制。
- **能力可复用**：文件、SSH、scheduler、MCP、voice、model bridge 等 package 可被不同宿主组合。
- **安全边界清晰**：Renderer、preload、Main、插件沙箱、远程设备各自有权限边界。
- **布局可演进**：面板以 panelKind 和布局树持久化，不必把业务身份绑定到“左栏/右栏”。

### 15.2 需要持续关注的风险

1. **Main 总装配复杂度高。** `bootstrap-electron.ts` 集中了大量副作用和启动顺序；新增服务必须明确依赖的
   ready gate、退出清理和多窗口广播。
2. **远程路由容易出现“看起来能用、实际打错机器”。** 所有 session mutation 都要沿 session origin、sticky
   origin、owner token 和 device-link allowlist 检查。
3. **DB schema 是历史资产。** migration 需要连续、可回放、可恢复；不能用临时分支 schema 直接打开共享用户数据。
4. **插件基座与 Mobile 原生层都是高风险边界。** 一个看似小的批准 schema、manifest、slot 或 native fingerprint
   改动，都可能影响存量插件或触发冷更。
5. **协议兼容不能仅靠单仓测试。** 客户端 typecheck/单测通过，仍可能与服务端或旧客户端 wire 不兼容。
6. **“静态状态”和“运行状态”并存。** DB、Maker memory、renderer store、remote mirror cache、presence 之间必须
   维持 owner 和失效规则，不能把任意一份缓存当作权威。

### 15.3 本文没有覆盖的内容

- 独立服务端的 auth-server、model-access-server、relay、heartbeat-server、market 和更新 CDN 内部实现。
- 每一个 renderer feature 的组件级设计、视觉 token 和逐条 UI 交互。
- 每个 Agent vendor 的完整 SDK 行为和模型服务商内部协议。
- 真实设备、SSH 主机、relay、多控制端和插件升级的运行期验收结果。

## 16. 代码导航表

需要继续深入时，建议按下面顺序阅读：

| 想了解什么 | 首先阅读 |
|---|---|
| 仓库整体边界 | [`README.zh-CN.md`](../README.zh-CN.md)、[`repo-map.md`](dev-rules/repo-map.md) |
| Desktop 启动 | [`main/index.ts`](../apps/desktop/src/main/index.ts)、[`bootstrap-electron.ts`](../apps/desktop/src/main/bootstrap-electron.ts) |
| Electron 安全 | [`electron-security-and-process-boundaries.md`](dev-rules/electron-security-and-process-boundaries.md) |
| Renderer 路由和壳 | [`renderer/App.tsx`](../apps/desktop/src/renderer/App.tsx)、[`renderer/router.tsx`](../apps/desktop/src/renderer/router.tsx)、[`renderer/components/layout/MainLayout.tsx`](../apps/desktop/src/renderer/components/layout/MainLayout.tsx) |
| 布局树 | [`shared/layoutTree.ts`](../apps/desktop/src/shared/layoutTree.ts)、[`LayoutStore.ts`](../apps/desktop/src/main/layout/LayoutStore.ts)、[`panels/registry.ts`](../apps/desktop/src/renderer/panels/registry.ts) |
| IPC 表面 | [`preload.ts`](../apps/desktop/src/preload/preload.ts)、`main/*ipc*`、`shared/*ipc*` |
| 本地数据 | [`localDb/index.ts`](../apps/desktop/src/main/localDb/index.ts)、[`localDb/schema.ts`](../apps/desktop/src/main/localDb/schema.ts)、[`drizzle/`](../apps/desktop/drizzle/) |
| Agent 编排 | [`packages/maker-core`](../packages/maker-core/)、[`main/maker-host`](../apps/desktop/src/main/maker-host/)、[`main/maker-ipc`](../apps/desktop/src/main/maker-ipc/) |
| 远程与 Mobile | [`packages/device-link`](../packages/device-link/)、[`mobile DeviceLinkContext`](../apps/mobile/src/device-link/DeviceLinkContext.tsx)、[`mobileMakerTransport`](../apps/mobile/src/device-link/mobileMakerTransport.ts) |
| Orca | [`orca-team-architecture.md`](dev-rules/orca-team-architecture.md)、`main/maker-ipc/orca*`、`packages/orca-workflow` |
| 插件 | [`plugin-security-and-authoring.md`](dev-rules/plugin-security-and-authoring.md)、`main/cindy-brain`、`main/plugin-market`、`shared/ghost.ts` |
| 协议 | [`protocol-compatibility.md`](dev-rules/protocol-compatibility.md)、`packages/*-protocol` |
| 远程适配 | [`remote-and-mobile-adaptation.md`](dev-rules/remote-and-mobile-adaptation.md) |
| 数据/凭证 | [`database-and-migrations.md`](dev-rules/database-and-migrations.md)、[`credentials-and-local-storage.md`](dev-rules/credentials-and-local-storage.md) |

## 17. 结语

Cindy 的架构主线可以压缩成一句话：

> **Renderer/Mobile 表达意图，Desktop Main 持有执行权，Maker Core 统一 Agent，packages 提供可复用能力，
> 本地协议实现和跨仓兼容契约保证跨端协作，远程设备通过白名单和归属路由把同一项工作延续下去。**

理解这条主线后，新增功能首先要回答三个问题：它的真实执行者是谁、数据真相在哪一端、它是否需要经过协议或
device-link 扩展；然后再决定代码应放在 App、Main host、共享 package、protocol 还是插件/Skill 中。
