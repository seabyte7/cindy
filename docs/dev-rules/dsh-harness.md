# DSH harness 接入方案（DeepSeek Harness）

> **状态：方案已定稿，代码尚未实施。** 本文是把 `deepseek-ai/deepseek-harness`
> 接成 Cindy 第四个 agent harness（claude-code / codex / pi 之外）的施工正本。
> 开始任一阶段前先读本文；实施过程中把「方案」逐步改写成「已交付规则 + 维护不变量」，
> 最终形态对齐 [`pi-harness.md`](pi-harness.md)。
>
> 调查基线：dsh `0.1.2-alpha.4`（npm）/ `0.1.2a3`（PyPI runtime wheel），2026-09-02。

## 目录

- [1. 已定裁决](#1-已定裁决)
- [2. dsh 侧可接入面](#2-dsh-侧可接入面)
- [3. 施工阶段](#3-施工阶段)
- [4. 能力降级声明](#4-能力降级声明)
- [5. 风险与跨仓协调](#5-风险与跨仓协调)
- [6. 验证与门禁](#6-验证与门禁)

-----

## 1. 已定裁决

| # | 裁决 | 说明 |
|---|---|---|
| 1 | **协议走 ACP，不走 dsh 自家 SDK JSON-RPC** | SDK 通道无中断、无权限审批，Cindy 权限模型落不了地。详见 [§2.1](#21-协议选型acp) |
| 2 | **运行时复用 DeepSeek 官方自包含可执行** | PyPI `deepseek-harness-runtime-bin` wheel 内的原生可执行，内嵌 Node，不依赖用户本机 Node |
| 3 | **首版只做 MVP 骨架** | 跑通建会话 / 对话 / 审批 / MCP / 身份落库；其余能力按 `CapabilityStatus` 诚实降级 |
| 4 | **DB `agent_kind` 值用 `'dsh'`** | 不用缩写。一旦落库即为兼容承诺，不可回退 |
| 5 | **阶段 0（类型收敛）单独走一个 PR** | 否则功能 PR 会带上几百个文件的机械 diff，review 不可能有效 |
| 6 | **进程模型：per-session 一个 dsh 进程** | 与 CC / Codex / pi 的 teardown、账号边界 sweep、断链恢复语义一致。ACP 单连接多路复用 session 是后续优化项 |

-----

## 2. dsh 侧可接入面

### 2.1 协议选型：ACP

dsh 提供两条 out-of-process 通道：

| | `--profile sdk`（自家 JSON-RPC） | `--profile acp`（Agent Client Protocol v1） |
|---|---|---|
| 会话恢复 | ✗ | ✓ `session/list` / `session/resume` / `session/close` |
| 中断当前 turn | ✗（官方明说只能杀进程） | ✓ `session/cancel` |
| 权限审批 | ✗（官方称 dead capability） | ✓ `session/request_permission` |
| MCP 挂载 | ✗ | ✓ stdio + Streamable HTTP |
| 模型 / effort 切换 | 仅 initialize 时固定 | ✓ `session/set_config_option` |
| 语义事件 | 有 | ✓ 消息 / 思考 / 工具生命周期 / 配置 / 上下文用量 |

dsh 自身用 `@agentclientprotocol/sdk@1.4.0`（MIT）实现 ACP 两端，Cindy 客户端侧直接
依赖同一个包，不自造 JSON-RPC 分帧。

ACP 面**明确不支持**：fork、rewind、`session/load` 转录回放、plan 模式、slash 命令、
extra dirs、terminal、modes、elicitation。dsh 内部有 `dsh-plan-mode`、
`dsh-command-compact` 等插件，但 ACP 不暴露它们 —— 想要就得像 pi 的 `cindy-bridge`
那样写 cordis 插件注入 dsh 进程，属于后续里程碑。

### 2.2 运行时分发

- PyPI `deepseek-harness-runtime-bin` 的 wheel 里是官方打的自包含 `dsh` 可执行
  （内嵌 Node + 全依赖闭包 + `-rg` ripgrep sidecar；macOS 另含 `-spawn-helper`
  供 node-pty 用），**不需要系统 Node**。
- 平台矩阵：`linux-x64` / `linux-arm64` / `darwin-arm64` / `win32-x64`，各 ~70–78 MB。
- **缺 `darwin-x64`（Intel Mac）与 `win32-arm64`** —— 这两个平台不提供 dsh，走
  `optionalAsset` 静默降级路径。
- 该可执行强制要求显式 `DSH_HOME`，绝不回落 `~/.dsh`，与
  [`credentials-and-local-storage.md`](credentials-and-local-storage.md) 的落盘口径一致。

> Cindy 正式包 `RunAsNode=false`（见 [`pi-harness.md`](pi-harness.md) 不变量 11），
> Main 的 `process.execPath` 不是 Node 可执行文件，**不能**用
> `ELECTRON_RUN_AS_NODE=1` 跑 `dsh` 的 npm 版 `bin.js`。自包含可执行是唯一可行形态。

### 2.3 版本状态

`acp` profile **只存在于 alpha**：npm `@deepseek-ai/dsh@0.1.2-alpha.4` 才带
`@deepseek-ai/dsh-acp-app` 依赖，`latest`（`0.1.1-rc.2`）没有。上游 README 明写
「developer preview，THERE WILL BE COMPATIBILITY-BREAKING CHANGES」。

### 2.4 模型平面

`@deepseek-ai/dsh-llm-pi-ai` 支持手工声明网关路由，与 pi 的 `models.json` 同构：

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      cindy:
        api: openai-completions        # 或 anthropic 形态，按路由决定
        baseURL: http://127.0.0.1:<port>/...
        apiKeyEnv: CINDY_DSH_API_KEY   # 凭证只存 env 引用名，不落盘
        models: [ ... ]                # 由 Cindy 模型目录映射
```

派生链 `catalog-to-descriptors.ts` → `capabilities.availableModels` → profile patch
生成可整条复用 pi 的实现，不再造第二套。

**禁止双重转义**：与 pi 同口径 —— 能用 dsh 自身兼容层直达的路由，不要先转成
Anthropic 格式再转 dsh 兼容格式。

-----

## 3. 施工阶段

### 阶段 0：类型收敛（独立 PR，先行，零行为变更）

**动机**：`'claude-code' | 'codex' | 'pi'` 字面量联合在全仓被复制 40+ 次，
`'cc' | 'codex' | 'pi'` 在 renderer 侧另有 20+ 处；全仓 461 个文件含 `'pi'` 字面量。
不先收敛，加第四个值就是几百文件的机械 diff。

把 inline 字面量联合替换为已导出的类型别名：

- `MakerAgentKindWire`（maker-core 形态）与 `DbAgentKind`（DB / renderer 形态），
  正本在 `apps/desktop/src/shared/agentKindConversion.ts`
- `AgentKind` 正本在 `packages/maker-core/src/types/common.ts`

优先收敛顺序：`packages/maker-shared/src/*`（10 处）→
`packages/lizi-mcps/src/xdt-helper/*`（9 处）→
`apps/desktop/src/renderer/vite-env.d.ts` → renderer state 层。

验收：`pnpm test:unit` 全绿且**无任何行为差异**。

### 阶段 1：AgentKind 四值化 + dsh 运行时供给

**类型层**

- `packages/maker-core/src/types/common.ts` → `AgentKind` 增 `'dsh'`
- `apps/desktop/src/shared/agentKindConversion.ts` → `DbAgentKind` /
  `MakerAgentKindWire` 增 `'dsh'`（两侧同名，不做缩写映射）
- `packages/model-providers/src/types.ts`、`packages/maker-scheduler/src/types.ts`、
  `packages/lizi-mcps/src/types.ts`
- `apps/desktop/src/main/localDb/schema.ts` 的 4 处
  `text('agent_kind', { enum: [...] })` 增 `'dsh'`

> SQLite 下 drizzle 的 `enum` 是**类型级**约束，不生成 CHECK DDL，
> **不需要新增 migration**。提交前用 `pnpm --filter desktop run typecheck`
> 加一次 migration runner 实跑确认；结论写回
> [`database-and-migrations.md`](database-and-migrations.md) 前先复核该文件的既有口径。

**二进制供给**

- `apps/desktop/src/main/agent-binaries/types.ts` → `VendorKey` 增 `'dsh'`
  （该类型标注 `@frozen v1.0(additive)`，加法合规）
- `apps/desktop/src/main/agent-binaries/index.ts` → `CONFIG.dsh`：
  `artifactKind: 'tar-gz-dir'`、`optionalAsset: true`、`installSubdir: 'dsh'`、
  `binaryName: process.platform === 'win32' ? 'dsh.exe' : 'dsh'`
- 新增 `tools/dsh/latest.json` + `tools/dsh/update.mjs`（对照 `tools/pi/`）：
  从 PyPI JSON API 取 wheel 的 URL / sha256 / size，把 wheel 内 `runtime/` 目录
  （主可执行 + `-rg` + macOS `-spawn-helper`）重打成 tar.gz，归档根即完整目录
- `apps/desktop/src/main/bootstrap-electron.ts`：加 dsh 的可选、带超时的准备流程
  （对照 `PI_AGENT_INSTALL_STARTUP_DEADLINE_MS`），CDN 异常不得阻塞启动页

### 阶段 2：`DshAgent` 骨架（`packages/maker-core/src/agents/dsh/`）

文件布局对照 `agents/pi/`：

| 文件 | 职责 |
|---|---|
| `acp-client.ts` | 基于 `@agentclientprotocol/sdk` 的 `ClientSideConnection` over stdio；连接生命周期、请求超时、保留 stderr 尾巴供错误诊断 |
| `translator.ts` | `session/update` → `AgentEvent`。`agent_message_chunk` → `text{isFinal}`；`agent_thought_chunk` → `thinking{stage,blockId}`；`tool_call` / `tool_call_update` → `tool_use` / `tool_result`；context usage → 用量投影；`stopReason` → `done`。**形状对齐 codex / pi**，流式只发 delta |
| `profile-assembly.ts` | 在 `$DSH_HOME/profiles/cindy-acp/` 物化 `package.json`（`dsh.profile.bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']`，`patchReload: startup`）与 `cordis.patch.yml`（`llm-pi-ai` 路由、persona 追加 Cindy 产品段） |
| `index.ts` | `DshAgent extends BaseAgent`：spawn → `initialize` → `session/new` / `session/resume`；`setModel` / `setEffort` → `session/set_config_option`；`abort` → `session/cancel`；`session/request_permission` → `InteractionRequest` |

**权限档**：ACP 把审批决策交给 client，比 pi 干净 —— 不需要往 dsh 进程注入扩展。
`ask` / `auto` / `bypassPermissions` 三档在 Cindy 侧实现，`auto` 复用现成的
`agents/shared/auto-review.ts` dispatcher（分类抛错 / 无 resolver 一律 fail-closed）。

> **不变量（继承自 [`pi-harness.md`](pi-harness.md) 不变量 1）**：
> `capabilities.permissionModes` 顺序必须是 `[ask, auto, bypassPermissions]`，
> `[0]` 是最严档 —— 无人值守链路（`hook-control/defaults.ts`）在「显式档不被支持」时
> 回落 `[0]`，顺序写错会把更严选择静默放宽成完全访问。必须由
> `dsh-capabilities.test.ts` 守住。

**凭证**：API key 只经 env（`CINDY_DSH_API_KEY`）传入，profile 文件里只留 env 引用名，
不落盘、不进仓库。

**stdout 纯净**：ACP 帧独占 stdout。Cindy 生成的 profile patch 不得插入任何 stdout
logger row，也不读取用户自有 profile。由契约测试断言。

### 阶段 3：Desktop host 接线

- 新增 `apps/desktop/src/main/maker-host/dsh-host.ts`（对照 `pi-host.ts`）：
  `buildDshAgentForDesktop()`，注入 `resolveDshAgentHome`、模型目录、logger、proxy 端点
- `apps/desktop/src/main/maker-host/index.ts`：`makerAgents.dsh = buildDshAgentForDesktop()`
  + `_registerDshAgent` 懒注册（对照现有 pi 的 `makerAgents.pi` 与 `_registerPiAgent`）
- 新增 `apps/desktop/src/main/mcp-integrations/dshEnvironment.ts`：复用
  `codexHttpBridge` 把 in-process MCP providers 暴露成 localhost Streamable HTTP，
  作为 `session/new` 的 `mcpServers` 传入。**比 pi 简单** —— 不需要注入扩展，
  也不需要 pi 那套 `cindy_mcp_list_tools` / `cindy_mcp_call_tool` 网关包装
- `apps/desktop/src/main/bootstrap-electron.ts`：`onQuit` 与账号切换时
  `shutdownDshEnvironment`
- `maker-host/session-storage.ts` 的 `toDbKind` / `fromDbKind` 已委托
  `agentKindConversion`，阶段 1 改完即生效

### 阶段 4：会话身份全链

pi 在这一步栽过跟头（提交 `f166e005b`）：DB 写对了、子进程真跑了，但 UI 底部标签显示
Claude Code、模型自称 Claude Code —— 根因是若干
`x === 'codex' ? 'codex' : 'claude-code'` 二元判定把第三家吞掉。加第四家会重演，
必须一次性覆盖：

- `renderer/features/cc-agent/CCAgentSessionView.tsx`：`displayAgentKind` /
  `runtimeAgentKind` / `session.agentKind` 派生 / vendorKey
- `renderer/features/cc-agent/NewMakerDraftRoute.tsx`：`capabilityAgentKind`、
  vendor 候选列表
- `renderer/components/new-chat/ModelSelector.tsx`：`vendorKey`、`toVendorKey`、
  `vendorKeyToAgentKind`、`agentName`、browse vendor（15+ 处）
- `renderer/lib/makerChatStore.ts`、
  `renderer/state/{newMakerDraft,modelEnginePrefs,modelFavorites}.ts`
- Mobile：`MobileAgentMark.tsx`、`MobileVendorIcon.tsx`、
  `session/{newSession,sessionAgentSwitch,sessionMenu,composerPalette}.ts`
- i18n 四语（`en` / `zh-CN` / `ja` / `ko`）：`trigger.agent.dsh`、权限档文案
- **system prompt 声明 harness 身份**（`github.com/deepseek-ai/deepseek-harness`），
  否则底层模型会自称 Claude Code

**新 UI 硬性要求**（[`../design-rules/DESIGN.md`](../design-rules/DESIGN.md)）：
dsh 图标与 vendor 标签必须同时实现 Light / Dark，颜色一律走语义 token；
图标须遵守上游 `BRAND_GUIDELINES.md`。UI 文案里的产品术语先查
[`../../i18n/GLOSSARY.md`](../../i18n/GLOSSARY.md)。

-----

## 4. 能力降级声明

MVP 的 `Capabilities`：

| 能力 | 状态 | 依据 |
|---|---|---|
| `switchModel` / `effort` | ✓ | `session/set_config_option` |
| `permissionModes` | ✓ `[ask, auto, bypassPermissions]` | `session/request_permission` |
| `setPermissionModeMidSession` | ✓ | 客户端侧策略，热切 |
| `multimodal.text` / `.image` | ✓ | ACP 支持 PNG / JPEG / WebP / GIF |
| `multimodal.file` | ✗ `sdk-missing` | ACP 只收 resource_link |
| `abort` | ✓ | `session/cancel` |
| `sameTurnSteer` | ✗ `sdk-missing` | 每 session 只允许一个 in-flight prompt |
| `fork` / `rewind` / `sessionTree` | ✗ `sdk-missing` | ACP 明确不支持 |
| `planMode` | ✗ `sdk-missing` | dsh 有插件，ACP 不暴露 modes |
| `extraDirs` / `writableDirs` | ✗ `sdk-missing` | ACP one primary workspace |
| `memory` | ✗ | 由 `cindy_memory` MCP 覆盖 |
| `exportSessionHtml` / `compactSession` | ✗ | ACP 无 commands 面 |
| `runtimeCapabilities` | ✗ | 无对应查询面 |
| `hasFastMode` | `false` | — |

会话历史真相仍以 Cindy 自己的 DB 为准 —— ACP `session/resume` 明确不回放历史，
与 pi 同口径。

-----

## 5. 风险与跨仓协调

| 风险 | 说明 | 处置 |
|---|---|---|
| **acp profile 只在 alpha** | `latest` 无 `dsh-acp-app`；上游声明会有破坏性变更 | pin 到具体 alpha 版本；`optionalAsset: true`；ACP 握手失败即静默不注册；产品上标为实验入口 |
| **Intel Mac 无官方包** | 上游不发 `darwin-x64` wheel（`win32-arm64` 同）| 该平台不提供 dsh，check-environment 静默降级（与 pi 缺 manifest 字段同路径）|
| **CDN manifest 跨仓** | manifest 顶层 `dsh` 字段与资产上传在**服务端仓**，本仓改不了 | `optionalAsset: true` 保证本仓可先行合入；服务端另行协调 |
| **70–78 MB × per-session 进程** | 内存 / 磁盘开销明显高于 pi | MVP 接受；「单进程多 session」列为后续优化，需先厘清 teardown 与账号边界语义 |
| **stdout 纯净是部署约束** | 任一 stdout logger 会污染 ACP 帧 | profile patch 由 Cindy 生成、不读用户 profile；契约测试断言生成的 patch 不含 stdout logger row |
| **新增外部依赖** | `@agentclientprotocol/sdk@1.4.0` 进 maker-core | 需过 [`architecture-invariants.md`](architecture-invariants.md) 的依赖方向检查 |

-----

## 6. 验证与门禁

每个阶段提交前（根 `AGENTS.md` 硬性要求）：

- `pnpm test:unit:related`
- 涉及的每个 package 跑 `pnpm --filter <包名> run --if-present typecheck`
- `pnpm check:dco`、`pnpm check:i18n-glossary`

新增测试（对照 pi 的自动化安全网）：

- `dsh-capabilities.test.ts` —— 权限档顺序契约
- `dsh-translator.test.ts` —— ACP update → `AgentEvent` 映射
- `dsh-agent.integration.test.ts` —— 真 dsh 二进制 + 真 MCP server + 假模型工具调用，
  覆盖安全命令直通 / 危险命令升级审批并 deny 拦截 / MCP 工具经桥命中 / 模型切换 / cancel
- `dshBinaryDistribution.test.ts` —— 断言 dsh 只走受管 CDN 链，不进安装包
- profile patch 契约测试 —— stdout 纯净、凭证不落盘

阶段 4 之后**必须实机验证**（pi 正是靠 CDP 驱动真实沙箱才发现身份错标）：
底部引擎标签、模型自述 harness 身份、DB `agent_kind`、子进程 argv、MCP 工具挂载数。
