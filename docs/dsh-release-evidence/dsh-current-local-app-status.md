# DSH 当前本机试用状态

> **状态：LOCAL-PARTIAL（可本机试用，不是完整 DSH，也不是发布制品）**
> **范围：Cindy fork、macOS `darwin-arm64`、本机 Desktop、受 Cindy 管理的 DSH runtime。**
> **更新日期：2026-09-07**

本文是试用当前本机 Cindy.app 时的单一状态说明。它把已经可以在 Cindy 内使用的
DSH 能力，与尚未交付或尚未验证的能力分开列出；不要把「能看到入口」或「本地测试通过」
理解成 DSH 所有原生功能都已接入。

## 先看结论

当前 app 可以在本机 Cindy 界面中创建受管 DSH 文本任务；Cindy 负责任务入口、消息展示、
停止、同一任务的窄恢复、受限的运行时 model / effort 选择，以及 Cindy 自己保存的 plan / todo。

DSH 本身仍是受监督的执行引擎：Desktop Main 是唯一控制面，DSH runtime 只能经 ACP
stdio 访问。Renderer 不持有 DSH endpoint、API key、`DSH_HOME`、原生 session id 或原始
ACP payload。

```text
Cindy 界面
  -> 受限 IPC
Desktop Main: DshControlPlane / SQLite bindings / receipt journal
  -> 公开 ACP stdio
受监督的本地 DSH runtime
```

这不是嵌入 DSH Web UI，也不是把 DSH 包装为一个 MCP tool。Cindy 是产品界面和任务控制面；
MCP 仅是未来可由 DSH 使用的受控工具扩展面。

## 可以试用的能力

| 领域 | 当前可用行为 | 重要限制 |
| --- | --- | --- |
| DSH 入口 | 在 **New Maker** 中出现本机 DSH 入口；只有 Desktop Main 成功校验本机受监督 runtime、当前账号和唯一 DSH provider 后才注册 | 不支持 SSH、device-link、Mobile 或 scheduler；无合格配置时入口应不可用，而不是回退到其他 Agent |
| 文本任务 | 本机创建、发送文本、多轮对话、停止（cancel）、关闭；已提交的文本 / thought / 工具状态 / usage 有受限安全投影 | 仅文本；不支持 file、image、文件夹或额外目录附件 |
| 会话绑定 | Cindy 为每个任务保存 owner binding、命令 receipt 和安全投影 journal；同一 Cindy 任务可在满足条件时经受控 bridge 恢复 | 这不是完整历史同步或任意跨进程恢复；不确定 prompt 绝不自动重发 |
| model / effort | 本机 live DSH 任务可显示 DSH 当前广告的 model / reasoning-effort 候选项；选择只影响后续消息 | 选项是 Main 临时签发的 capability，不保存、不走通用 ModelSelector；尚未用真实 provider 证明不同模型实际生效 |
| Cindy activity | DSH 任务的 composer 下有 **本地计划和待办** panel，可创建 plan / todo、完成或取消 | 这些是 `cindy-dsh` 本地对象，数据只保存在 Cindy，**不会发送给 DSH runtime，也不是 DSH native plan/todo** |
| 安全边界 | endpoint/key 只由 Main 的独立 DSH provider 配置读取；route、owner、key 在启动、握手和原生操作前重验 | 只接受恰好一个已验证的 HTTPS DSH provider；不复用 Claude、Codex 或 Pi 的 key |

## 按阶段的交付状态

### F3：Cindy bridge、binding 与恢复基础 — 部分完成

已完成：Main-only durable owner binding、CAS lifecycle/cursor、display-safe projection journal、
prompt receipt ledger、receipt-guarded bridge rehydrate，以及同一 Cindy task 的窄 resume。
原生 session id 始终留在 Main，不会传给 Renderer 或 Maker adapter。

还未完成：公开 history synchronizer、多会话真实隔离 E2E、history gap 补齐、未确认 receipt
的 verified-history 收口，以及完整的恢复产品界面。任务无法确定恢复时，正确行为是要求重新
协调或明确显示不可恢复，而不是静默创建一条新的 DSH session。

### F4：事件、工具和交互基础 — 部分完成

已完成：有限、脱敏且有 schema 的 ACP update translator；已经提交到 durable journal 的事件才
能进入 adapter；Main-only、一次性的 `allow-once` / `reject-once` permission resolver。

还未完成：完整 event coverage、真实 runtime 的乱序／重复／EOF fixture、持久 usage accounting、
用户可操作的 tool approval UI，以及签名 app 中工具 / permission capability 的正式准入。
当前没有 approval UI 时，任何工具请求都不能被当作已获用户许可。

### F5：本机 Desktop 核心体验 — 进行中

已完成：本机 DSH task 创建、cwd admission、owner/provider/key revalidation、文本 composer、
narrow resume、受限 model/effort projection 和相应 Main/IPC/Renderer 边界。

还未完成：附件、完整 history/recovery UI、tool approval、真实 provider 的不同模型生效证据、
浏览器驱动的 DSH panel E2E，以及所有 DSH UI 的实际 Light/Dark 目检。

### F6：Cindy DSH activity 控制面 — 局部完成

已完成：版本化 `cindy-dsh` activity reducer、SQLite durable snapshot、session lifecycle root，
以及仅限本机任务的 plan/todo panel 与五个窄操作：read、create plan、create todo、complete、cancel。
close、EOF、无效 binding 或 Main write-admission 撤销后，全部本地 activity 必须变为 observe-only。

还未完成：DSH native plan/todo source 或 action、terminal attach/input/signal/close、command、
elicitation、task/job、workflow、schedule、remote/device-link/Mobile activity。没有经过公开、
版本化接口和 lifecycle 验证的对象，不会伪装成 DSH native object。

## 不可用或未准入的能力

以下能力不是“隐藏功能”，而是当前必须明确视为不可用：

- SSH remote、device-link、Mobile、scheduler、Orca 协作，以及多平台发布（F8--F11）；
- 上传图片、文件、文件夹或额外目录；
- 一般 history replay、fork、rewind、same-turn steer；
- 用户自定义 MCP、DSH plugin / skill / extension 的安装、更新、启停与恢复；
- Existing Home（选择并运行既有 DSH Home）的受保护书签链路：当前本机试用包为了兼容 Cindy
  既有 desktop profile，不给 Main 加 App Sandbox；该链路尚无可用的签名／Finder E2E；
- DSH native terminal、job、workflow、schedule；
- 永久 permission grant、自动批准或 bypass permissions；
- 将 Cindy local plan/todo 当作 DSH runtime 中的 native plan/todo；
- 通过 Renderer、普通 provider 测试接口或环境变量任意指定 DSH endpoint。

## 使用前配置

普通 DSH task 需要当前 Cindy 账号下存在**恰好一个** DSH runtime provider 配置。它必须是：

- HTTPS endpoint；
- API-key 认证；
- `runtimes.dsh = { baseUrl, models: [] }` 的受限 DSH 配置形状；
- 由用户明确输入的独立 DSH key。

DSH key 不会复用已有 Claude Code、Codex 或 Pi key。没有合格 provider 时，DSH 不应启动。

建议使用隔离的测试账号和测试 key，并先创建一个空工作目录。真实 provider 测试可能产生费用；
不要在提示词、工作目录或日志中放敏感信息。

## 建议的试用路径

1. 打开 Cindy，进入 **New Maker**，确认本机 DSH 可选。
2. 用空目录创建一条 DSH 文本任务，发送一条无敏感信息的短提示词。
3. 观察文本回复、停止按钮和任务关闭是否正常。
4. 若出现 model / effort panel，只在 idle 时切换一个选项，再发送下一条短提示词；这只验证
   UI 与协议回路，不证明真实模型差异。
5. 在任务下方的活动面板创建一个 plan 和 todo，完成或取消它；确认说明文字表明这些内容由
   Cindy 本地保存。
6. 关闭任务后确认 activity 变为只读；不要期待关闭后的任意 DSH session 都能自动恢复。
7. 遇到失败时记录：操作步骤、是否有 DSH provider、任务是否运行中、界面提示、以及时间。
   不要发送 API key、endpoint、`DSH_HOME`、原生 session id 或完整日志。

## 本地证据与未覆盖项

当前本地证据包括：固定 `darwin-arm64` source runtime、受监督 Main/Helper path、绑定／receipt／
projection SQLite 流程、loopback prompt/cancel、Cindy local plan/todo，以及签名 Helper 的 E2E。
这些测试使用临时目录、假 key 和 loopback fixture。

它们**不**证明：真实 provider 产品行为、完整浏览器 panel E2E、Existing Home 的人工 Finder 验收、
多会话恢复、DSH native activity、远程 / Mobile、发布或跨平台兼容。

更详细的本机构建与手工验证步骤见
[`dsh-local-macos-test-manual.md`](../dev-rules/dsh-local-macos-test-manual.md)。完整设计、能力合同和
阶段门槛见 [`dsh-harness.md`](../dev-rules/dsh-harness.md)。

## 反馈时请标注

请把发现按下面四类标注，便于不把产品问题误判为尚未准入能力：

| 分类 | 示例 |
| --- | --- |
| 已交付行为异常 | 发送文本失败、cancel 无效、plan/todo 在 active task 中不可写、endpoint 配置后 DSH 没有注册 |
| 未交付能力需求 | 想上传文件、查看完整历史、批准工具、使用 terminal / job / workflow |
| 恢复与状态问题 | 重启后任务状态错误、EOF 后仍可写 activity、任务变成新会话 |
| 体验问题 | 中文文案、暗色模式、加载态、不可用提示、配置入口、任务列表展示 |

每个问题优先附上可复现步骤和脱敏后的界面截图；敏感配置与任何凭证不要附上。
