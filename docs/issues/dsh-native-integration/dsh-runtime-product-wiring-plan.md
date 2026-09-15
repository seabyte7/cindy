# DSH Runtime 与工具能力完整修复方案

> **修订 13（2026-09-14，待实机验收）**：本轮 GUI 重试新增暴露并已修复三个本地入口缺口：
> DSH binding 的 SQLite 父记录创建顺序、共享输入队列对 `dsh` 的显式白名单，以及把不支持的
> 通用“变更审查捕获”错误地作为发送前置条件。DSH 现在在该审查功能上诚实降级，但**不会**因此
> 阻断文本 prompt；每次工具调用确认、受管 workspace、Main-owned ACP 及 Device Link 禁止仍保留。
> 新签名包的 signed-Helper E2E 9/9、Desktop typecheck、迁移回放和定向回归通过。真实 provider
> 的首条与续接文本请求尚需在该新安装包上验证，不能被 loopback E2E 替代。完整证据见
> [分析报告 §7.5](dsh-create-failure-analysis-2026-09-14.md#75-后续-gui-阻塞的逐项修复2255-更新)。

> **修订 12（2026-09-14，执行中）**：按用户“修复 重新打包”指令，将 workspace admission 与 task router
> 统一为 `{ cindySessionId, cwd }` 具名参数；新增真实模块组合回归及 Main-only 安全失败阶段日志。
> 267 项定向回归、Desktop typecheck 与文档合同通过，使用已有固定 build.11 输入重打包。
> 本次 App、安装/进程身份及真实 provider 验收以
> [分析报告 §7](dsh-create-failure-analysis-2026-09-14.md#7-本次修复与验收记录) 为准；下方修订 11 是历史调查截面。

> **最新调查（2026-09-14，修订 11，仅分析）**：已确认 Main 将 `consumeWorkspaceBookmark(cwd, sessionId)`
> 直接接到按 `(sessionId, cwd)` 调用的 task router，导致授权之后、DSH 子进程启动之前确定性失败。
> 该接线同时存在于旧运行包和最新安装包。当前进程仍映射旧 App，但仅重启也无法修复这处错误。
> 修订 10 的“FD3 是此次失败根因、书签已交接 fd4”结论撤回。完整证据、无网络复现及下一步修改顺序见
> [授权后创建失败分析报告](dsh-create-failure-analysis-2026-09-14.md)。本轮只更新报告，未修改产品代码或重打包。

> 状态：**build.11 已完成本机 source build、签名打包、安装替换和受控端到端复验**；本文同时记录已落地的修改、已取得的证据、尚未完成的安全边界与最终验收计划。日期：2026-09-11。
> 范围：Cindy 客户端仓；本机 macOS Apple Silicon 优先。不修改服务端，不推送或发布。
> 源码基线：`1b12b75dbcf2c3ed721d09ff1cdf79f2ed9a9c91`；分支
> `docs/dsh-harness-integration-plan`。现有 `.pnpm-store/` 不属本次修改。
> 修订 6：用户已授权开始修改，并要求完成后**不得打包**。本轮已完成 P2、P5a 的静态 profile
> 变更、P5d 的 Renderer → maker-core → Main 输入链路，以及 P5b 的源码安全骨架：每任务 bridge/
> scope、Main-only workspace picker grant、用途分离的 fd 4 implicit bookmark 与 Helper 生命周期释放。
> P5c 已加入 runtime PATH 与 tool PATH 分离、受控标准工具目录的注入合同，以及 build.11 的固定
> 上游 source adaptation：工具子进程使用审核后的 PATH，并清除全部 `CINDY_DSH_*` 启动变量。六个
> adaptation 已在干净的固定源码树顺序应用且 postimage 校验通过。以下“尚未打包/验收”的描述是
> **修订 6 的历史状态**，已由修订 7 的 build.11 证据替代；仍未逐项验收的能力以 §10 矩阵为准。**本次新增 P1/P3 修复**：修正 per-task lazy bridge
> 在注册阶段没有读取密钥、因而被误判为“配置已变化”并永远拒绝注册的根因；注册现封存 Main 内的
> 当前密钥并在任务启动/发送前复核。配置确有变化时，DSH 只在所有 DSH 任务结束后才替换 adapter，
> 不重置 Claude Code/Codex/Pi；Settings 的 DSH tab 现有安全状态卡和固定“重试注册”动作。状态卡明确
> 把“任务工厂可用”与模型/命令/文件/附件/审批的签名 App 验收分开；不会把源码改动显示成工具已可用。

> 修订 7（本轮）：从 DeepSeek upstream 固定 tag `dsh-v0.1.2-alpha.3`（commit
> `dd6322d604e00eec1ba5e0c8541159906a21094a`）重建
> `cindy-dsh-0.1.2-alpha.3-build.11-macos-supervised`，固定输入为 Node `v24.20.0` 与
> pnpm `11.7.0`；archive SHA-256 为
> `62dd87fa43af718d019f2f14ca6b3fd9318c80c36f7d008fdd9bb7e198914162`。解除 capability floor 后，
> 首次签名包暴露出 ad-hoc 签名无 Team ID 时 Hardened Runtime 拒绝加载 separately sealed
> `sharp` / `koffi` / `node-pty` 的根因；仅 DSH SEA runtime 的 inherit entitlement 增加
> `com.apple.security.cs.disable-library-validation`，Main 与 Supervisor 不获得该例外，且 sealed cache
> 的 regular-file、摘要和路径校验仍在。重新打包后的 `codesign --verify --deep --strict` 通过，受控
> local-loopback signed-Helper E2E 为 **8/8**：包括真实 `bash` 工具调用、Main-owned 一次 allow、
> `pwd` 输出及 provider key/base URL 不进入 shell 子进程。随后已将新 App 安装到 `/Applications/Cindy.app`，
> 旧 App 移入废纸篓，并对**安装后的实际路径**重新验签和重跑同一 8/8。该证据不使用真实用户 endpoint 或项目目录，
> 不把尚未逐项执行的文件搜索、附件/图像、外部 workspace bookmark、跨任务并发与远程平台写成已验收。

> 修订 8（2026-09-14，创建任务故障修复）：用户界面能选中「DSH / 受管 DSH 运行时」，但点击发送后
> 出现“创建任务失败，请重试”。Main 日志的确定错误为
> `[UNSUPPORTED_CAPABILITY] DSH sessions require the managed host and binding runtime`。根因不是 DeepSeek
> key、endpoint 或 `deepseek-flash` 模型：`NewMakerDraftRoute` 仍把 DSH 首条消息交给
> `local-db:sessions:create`；该通用入口按设计必须拒绝 DSH。现改为仅 DSH 走既有的
> `maker:create-session` 窄 IPC：Main 复核已注册的受管 Helper、固定
> `DSH_MANAGED_RUNTIME_MODEL_ID`、拒绝 renderer provider，然后才创建任务和 SQLite 行。DSH 也不再进入
> Worktree 创建补偿流程，避免第二条回到通用 DB 的旁路。preload/Renderer 类型只扩展此既有窄入口的
> `dsh` 与 `workspaceKind` 表达能力，不暴露 endpoint、key、bookmark 或 native handle。已通过
> composer 边界、普通首条消息、Main 创建参数和创建 handler 共 36 个针对性测试及 Desktop typecheck。
> 已重新打包 924 MiB 的本地 App，`app.asar` SHA-256 为
> `3457413748a244a83d8c273dab8e34458d0877833d114e58d0b875e6a2589030`，并安装到
> `/Applications/Cindy.app`；安装后 `codesign --verify --deep --strict` 通过，受控 signed-Helper
> E2E 为 8/8。下一门仍是用户以其已保存的 DSH 配置选择本地工作目录授权并做一次真实文本请求；
> 这一步才可证明 A07/A07b，不能用当前静态或 loopback fixture 结果代替。

## 1. 结论与目标

**DSH 应作为第四个 Runtime，与 Claude Code、Codex、Pi 并列。DeepSeek 是模型供应商，
DeepSeek Harness 是执行任务的 Agent runtime；两者不能用一个“DeepSeek 已连接”状态代替。**

当前界面中的独立 DSH 配置卡不是完全无效的占位：它已有持久化、独立密钥和 Main 注册链路。
但入口组织、状态反馈、配置变更后的运行时生命周期、DSH-only 供应商可见性及真实工具能力
尚未形成完整产品闭环。把卡片挪进 Runtime tab，只能解决其中一项。

本方案分两道验收门：

- **A：Runtime 与任务链路可用**——能发现、配置、诊断、创建 DSH 任务，真实发消息、停止、
  在已证明的边界内恢复；修改配置后可有控制地重新接入。
- **B：本机工具和附件能力可用**——恢复七项被禁用模块，在同一签名 App 中能搜索/读取工作目录、
  按授权修改文件、执行命令、接收本地文件附件，并按原生能力处理图片；工具过程、审批、停止及清理可验证。

A 可单独交付为“文本能力可用”；**本次“DSH Agent 功能接上”的最终完成标准为 A+B**。
仅 A 通过属于中间里程碑，不关闭本次修复。七项模块恢复的明细与能力验收见 §8 和 §10。
不能在仅通过 A 时对外称完整编码 Agent 已可用。SSH、Mobile、device-link、Orca、完整历史分叉
等另有 F8–F11 计划，本次不顺带开放，也不宣称完成全平台 DSH 集成。

## 2. 当前事实与修改依据

| 环节               | 当前源码事实                                                                                                                                                                                               | 本次处理                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 配置编辑           | **已改（源码）**：`CustomProviderDialog.tsx` 已把 DSH 设为第四个 Runtime tab；不再在上方保留重复卡片                                                                                                       | 保留专属 endpoint/key 语义，不把 DSH 伪装成通用模型协议                                      |
| 配置存储           | `custom-provider-store.ts` 接受 `runtimes.dsh={baseUrl,models:[]}`；密钥独立保存                                                                                                                           | 兼容读取，不重填、不复制其他 Runtime 的密钥                                                  |
| 供应商展示         | **已改（源码）**：DSH-only provider 会投影为 `agents:['dsh']`、`models.dsh:[]` 并可在列表管理                                                                                                              | 不伪造模型或通用 `routing.dsh`                                                               |
| 首次添加           | `AddProviderWizard.tsx` 的 preset 初始化复用普通模型 Runtime；自定义入口转编辑表单                                                                                                                         | 首次添加与编辑走同一 DSH 配置组件和校验，不要求先配 Claude Code                              |
| 配置选择           | `provider-config.ts` 要求恰好一个 DSH provider；多个返回 `multiple-configured`                                                                                                                             | 显式选择当前 DSH 来源，兼容现有唯一来源                                                      |
| 注册结果           | **已改（源码）**：lazy per-task bridge 的注册先封存/复核当前 Main key，后续 task 启动与发送重验；不再要求注册阶段已启动 child 才能通过密钥复核                                                                      | DSH task factory 可注册；真实 ACP/模型调用仍须同包动态验收                                    |
| 配置更新           | **已改（源码）**：provider CRUD 后只在 DSH provider/route/key 实际变化时换代；旧实例对新 prompt fail-closed                                                                                                    | 有活跃 DSH task 时标记 pending 并等待用户关闭；无活跃 task 时安全注销/释放/重新注册          |
| Agent 生命周期     | **已改（源码）**：`Maker.unregisterAgent(kind, expectedInstance)` 只在该 kind 没有 active 或 pre-publication session 时移除                                                                                       | 仅 DSH coordinator 使用；不 reset 整个 Maker，不影响其它 Agent                               |
| 新建任务           | **已修复（源码）**：New Maker 的 DSH 首条消息走 Main 的 `maker:create-session`，使用固定受管 runtime marker；不再走会拒绝 DSH 的 `local-db:sessions:create`。DSH 草稿禁用 Worktree 旁路。状态卡可说明“未注册 / 注册中 / 可建任务 / 等待旧任务关闭” | 保持身份及草稿，不回退到其他 Agent；重新打包后由 A07、A07b–A12 实机验收                       |
| 模型与推理强度     | `DshRuntimeConfigurationPanel` 已消费 live ACP 候选；普通 `Capabilities` 仍不承诺通用模型切换                                                                                                              | 复用 DSH 专属入口；补确认、失效和真实模型生效验收                                            |
| 恢复               | 已有 binding、receipt、projection journal；仅支持同一任务、已 settle 的受限恢复                                                                                                                            | 保留无重放边界，补正式 UI 和真实 App 验收                                                    |
| 工具 profile       | **已构建并签名验收**：build.11 删除 `capability-floor` adaptation，七项不再被 Cindy 强制 `disabled:true`；`sharp` / `koffi` / `node-pty` 的 sealed cache 已在受控签名 App 真实加载 | 已证明 profile boot 与 `bash` tool；文件搜索、附件/图像与每项负向沙箱仍须按 B 矩阵逐项验收 |
| 附件传递           | **已改（源码）**：`DshBridgePort` 使用版本化 text/file/image/mention 合同；Main 校验普通文件/符号链接并复制到任务哈希目录；图片仅在 ACP handshake 宣告 `image:true` 时内联真实 bytes，否则作为受限文件资源 | Renderer 原始路径不直通 ACP；普通文件可供工具读取，但生命周期/持久 lease 仍须随 P5b/P5e 完成 |
| 工具与审批         | **已签名 App 验收**：真实 ACP `tool_call` 关联到 Main 的 generic interaction resolver，返回单次 `allow-once`，随后 `bash` 成功完成；没有持久批准或自动批准 | 仍须补用户交互实际界面、拒绝/超时/重复回包与并发任务的产品验收                              |
| 目录授权与命令环境 | **部分实机**：runtime `PATH` 固定 `/usr/bin:/bin`，另有验证过的 `CINDY_DSH_TOOL_PATH`；已证明 shell 内没有 provider key/base URL，且 `pwd` 成功 | 本次 shell fixture 位于 Helper 自身 container；真实项目目录仍必须由 Main picker 的 task-scoped fd 4 bookmark 实机证明 |

**2026-09-11 补充核实**：源码的 `stage-sealed-pkg-native-cache.patch` 已有 `sharp`、`libvips`、
`koffi`、`node-pty` 缓存 staging；`/Applications/Cindy.app` 的 Helper Resources 中也实际存在这些
`.node`/`.dylib` 文件及 spawn helper。因此“这些依赖都没打包”不能作为当前根因。
已确认的是旧禁用补丁已从**新 source release manifest** 移除，Cindy 输入不再固定为文本；原生组件在解除
限制后的加载、嵌套沙箱、工具执行和文件授权仍待同包动态验证。早期文档中的缺依赖原因保留为历史排查线索。

以上证明的是代码结构及已知限制，**不是当前用户本机无法使用的唯一根因诊断**。
已有包、已有测试、配置保存、ACP 握手、真实模型请求、工具执行，是不同层的证据。
本轮不读取密钥，不根据密钥文件名或未匹配到的 DB 路径推断用户没有配置。

权威边界沿用 [DSH 规则 §0.2](../../dev-rules/dsh-harness.md)：Cindy Main 的
`DshControlPlane` 通过公开 ACP 控制 runtime；不等待另一套上游 Host API，不读取私有历史文件模拟 API。

## 3. 设置页怎么改

### 3.1 布局与字段

继续使用现有“模型供应商 → 编辑”弹窗，不新建一套设置页面。

```text
显示名称：DeepSeek
鉴权方式：API 密钥

Runtime  [Claude Code] [Codex] [Pi] [DeepSeek Harness]

DeepSeek Harness
  模型 API 基础 URL   [供应商的 DeepSeek API Base URL]
  API 密钥           [留空保留已保存密钥]
  当前来源           [设为 DSH 当前来源]

  运行时状态         未配置 / 启动中 / 已就绪 / 不可用：原因
  模型连接           尚未验证 / 验证中 / 成功 / 失败：原因
  工具与附件         命令 / 文件搜索与读写 / 本地附件 / 审批：各自状态
  [保存] [验证模型连接] [新建 DSH 任务]
  高级：DeepSeek Harness home（复用已有设置入口）
```

- 对外名称遵循 `i18n/GLOSSARY.md` 的 **DeepSeek Harness**；短空间可显示 DSH 并有完整可访问名称。
- 把原卡片移入第四 tab；不在上方保留第二份同义字段。
- 当前 `DSH 端点` 实际经固定 DeepSeek adapter 作为模型 API base URL 使用，**不是 ACP 服务地址**。
  字段说明必须写清；示例不再使用 `adapter.example.com` 暗示用户必须部署代理。
- 当前输入提示已改为官方 OpenAI 格式 base URL `https://api.deepseek.com`；固定 adapter 自己追加
  `/chat/completions`，所以不要手填该路径或 Claude Code 的 `/anthropic`。官方预设地址须与 pin 住的 adapter 路径拼接一致并完成真实请求验证；不把 Claude Code 的
  `/anthropic` 地址自动填到 DSH，也不要求填写 `/v1/messages`。本方案不更改用户已有 URL。
- DSH tab 不显示普通 Runtime 的协议切换、自定义 headers、精确请求路径、模型发现 URL、
  手填模型列表、“填充其他 runtime”。当前协议不支持的配置不做出可填外观。
- API key 可由用户手动填写与其他 Runtime 相同的有效 key；“独立”指独立存储与生命周期，
  不代表必须向供应商再申请一个 key。禁止后台读取其他 Runtime 的 key 自动复制。
- Endpoint 未改变且已有 key 时留空保留；改变 endpoint 必须重新输入；清除 key 是明确操作，
  不用空字符串同时承担“保留”和“删除”。
- 原 provider 使用 OAuth/无需鉴权时，不为添加 DSH 强改其共享鉴权方式；DSH tab 说明当前只支持
  API key，并引导新建独立的 API-key provider，保护原 Runtime 的登录方式。

### 3.2 首次接入与列表

1. 用户可从新建任务的 DSH 项或供应商设置进入，并定位到 DSH tab。
2. 没有 DeepSeek provider 时可以直接添加 DSH-only provider；已有时编辑该记录。
3. 供应商列表展示已配置 Runtime 摘要；DSH-only 不依赖模型数量可见。
4. 模型数量只统计模型目录；不把“DSH runtime 1 个”显示成“模型 1 个”。
5. 供应商整体连接状态与 DSH 就绪状态独立。Claude Code 连接成功不能使 DSH 显示绿色。
6. DSH tab 保存成功后保持在原位置并展示启动结果；普通保存按钮的行为不强迫其他 Runtime 用户改变。
7. 模型验证只针对已保存配置；有未保存改动时提示先保存。不得假测已保存旧配置后给新草稿亮绿灯。

实现列表时不能只改最后一个 filter：以现有自定义供应商查询的安全配置摘要补齐 DSH-only 记录，
与普通模型目录按 provider id 合并列表/详情。普通模型目录允许没有该记录；不得为满足 `ProviderView`
的模型约束伪造模型、认证状态或把 DSH 加入通用目录。订阅和非 DSH provider 的原列表规则保持不变。

### 3.3 组件和类型边界

新增设置页专用 `SettingsRuntimeKind = ModelProviderAgentKind | 'dsh'`，或等价判别联合。
普通模型路由继续使用 `ModelProviderAgentKind`；不全局放宽它来让 DSH 通过编译。

提取 `DshRuntimeSettingsPanel`，由新增与编辑共同使用；普通 Runtime 字段保留原组件。
运行时安装/就绪/模型验证/工具/附件状态采用共享 hook 消费 Main 快照，不在每个页面各做一套判断。
七项模块是集成实现细节，不做成七个要求用户手动勾选的开关；正常入口提供可用功能及必要权限说明。
复用现有 Tabs、表单、状态和按钮规范，键盘可达、窄窗口可用、Light/Dark 均实现；所有新文案 i18n。

## 4. 配置与凭证合同

### 4.1 数据兼容

- 保留现有 `runtimes.dsh` 及 key 存储格式；保留 `models: []`，不要迁移为普通 provider 模型目录。
- 当前来源增加 owner-scoped 的可选 `activeDshProviderId` override，使用既有账号配置存储。
  只保存显式选择，不复制 URL/key，不写入项目目录或 Renderer localStorage。
- 暂停使用以独立的 owner-scoped `dshRuntimeEnabled=false` override 表达；未设时沿用现有
  “配置可用则尝试启动”行为。重新启用删除这个 false override，仍使用显式选择或唯一候选规则。
  不能通过清除 `activeDshProviderId` 表示暂停，否则唯一候选会再次自动启用。
- 未设置 override：无候选为未配置；一个候选沿用该来源；多个候选要求选择，绝不按排序选第一个。
- 已设置 override 但来源不存在、缺 key 或无 DSH 配置：明确不可用，不自动切换到另一个来源。
- “恢复自动选择”删除 override；来源选择迁移不根据 provider 显示名称猜测意图。
- 不自动启用所有名叫 DeepSeek 的供应商，不重写已有 endpoint，不删除其他 Runtime 字段。
- 若实施发现必须增加持久字段，走新增 schema/migration 及旧数据测试；不改历史 migration 0100–0103。

### 4.2 写入与禁用

复用 provider CRUD 的凭证回滚和 route mutation 基础设施，在同一 owner/config generation 内校验。
新增来源选择与 provider 保存涉及多个存储时，必须有明确顺序、失败补偿和重读，不声称跨存储天然原子。
持久化成功但启动失败：保留用户配置，状态显示失败，不回滚成假成功或丢失新 key。

停用来源/清除 DSH 配置/删除 provider 都必须触发同一 DSH 失效路径；供应商普通模型停用开关
是否覆盖 DSH 不能靠模型目录推断。明确展示“停止作为 DSH 来源”及影响，不用删配置代替暂停使用。
关闭弹窗不撤回已经成功保存的配置；取消仅丢弃尚未保存的编辑。

## 5. Main 状态、诊断与连接验证

### 5.0 本轮源码状态卡（已落地，非连接成功声明）

新增 `shared/dshRuntimeStatus.ts`、Main-only status/retry IPC 和 DSH tab 的状态卡。它只投影：

- 配置原因（无来源、多来源、非 API-key、无效形状/路由、缺 key）；配置可用时仅显示 provider 名称；
- task factory 的 `not-registered` / `registering` / `task-factory-ready` /
  `reconfiguration-pending`；以及受影响活跃任务计数；
- 固定证据状态：模型连接、命令、文件工具、附件、审批均为
  `not-verified-in-this-app`，直到最终同一签名 App 的 A/B 验收转正。

该接口不接受 provider id、URL、key、原生 session id 或任意 probe 参数；只允许可信顶层
Renderer 调用固定 get/retry。重试复用主注册门，不另开裸 HTTP 探测路径。状态卡显示“可新建本机
DSH 任务”只表示 Main task factory 已按当前配置注册，**不表示**模型请求或任何工具已在用户机器通过。

本轮不启动计费模型请求，因用户要求停在打包前；§5.2 的受控模型连接验证仍是下一签名 App 阶段的
必做项，不能被状态卡替代。

### 5.1 安全状态快照

在 `apps/desktop/src/shared/` 新增 DSH runtime status 合同，至少包含：

- 不透明 revision、支持的平台、release 显示版本、所选 provider 的 id/名称。
- 配置状态：未配置、缺 key、多来源待选择、格式不合法、来源失效、可用。
- host 状态：未启动、启动中、已就绪、等待任务收尾、启动失败、需要恢复核对。
- 启用状态：启用/用户已暂停；暂停时配置和密钥保留，不自动启动。
- 模型验证：未验证、进行中、成功、失败及验证对应的配置 revision/时间。
- 可执行操作与安全 reason code；细粒度能力状态独立展示。

工具能力来自本 release 的验收记录、实际 profile/组件初始化和本任务权限；不能因为 ACP
握手成功就全部置 true。文件附件和图像模型输入分别报告；模型不支持视觉不能被表述为附件模块坏了。

不返回 key、key hash、原始 ACP、native session id、Home 路径、bookmark、环境或原始异常。
已有配置编辑 API 的 URL 字段不因此扩大；状态推送不携带 endpoint。
状态只表示该 owner、该配置 revision 的结果；切账号、改 key/URL、换 release 后旧成功失效。

建议 IPC 操作为 `getDshRuntimeStatus`、`retryDshRuntime`、`verifyDshModelConnection` 及状态变化推送。
名称待实现时按已有 channel 命名合同落地。模型验证仅针对当前启用且已保存的来源，不接受任意 provider 作为探测目标。
全部验证可信顶层 Renderer 和当前 owner；Main 决定
binary/profile/argv/路由。不能传任意 URL、key 或 native session id 让诊断接口变成探测器。
不加入 device-link allowlist；远端入口返回明确不支持。

### 5.2 三种结果必须分开

| 验证         | 做什么                                                        | 能证明什么                                 |
| ------------ | ------------------------------------------------------------- | ------------------------------------------ |
| 保存校验     | 校验字段、独立 key、写入后重读                                | 配置已保存，不证明连接                     |
| Runtime 就绪 | 固定 signed Helper admission + ACP 握手 + 当前配置复核        | 本机 DSH host 能运行，不证明模型鉴权       |
| 验证模型连接 | 同一 release、adapter/profile、保存的来源执行一次限额文本请求 | 该次真实模型路由与鉴权有效，不证明工具权限 |

模型验证由用户点击触发，提示可能产生少量供应商费用；固定短诊断文本，不发送项目文件/历史。
使用独立、无项目授权的受管诊断 scope，不运行用户 existing Home 的扩展；复用生产 admission、
路由和清理逻辑，不新建绕过验证的裸 HTTP 路径。此结果只声称模型连接，不声称已验收用户扩展。
工具功能开放后仍使用明确的无工具诊断 profile，并验证它的实际工具集合为空；不得因共用新版 runtime
让模型连接测试获得工作目录或命令执行能力。
限制并发、时长、输出及额度；诊断 scope 有独立 receipt 生命周期，结束或失败均关闭并回收。
不污染用户任务列表，失败不自动重复发请求；响应不确定时禁止重放。

错误码区分本机包缺失/版本不符/签名或 addon 问题/Helper 启动失败/ACP 不兼容，以及可可靠识别的
鉴权、余额或配额、模型不支持、网络超时；无法可靠分类时展示“模型请求失败”而非猜测。
诊断日志只记允许的阶段、reason、release、耗时；原生异常不得原样 toast 或上报。

## 6. 配置改变后的运行时生命周期

当前关键缺口是“已经注册就返回成功”，而旧 bridge 又绑定启动时的来源和 key。
必须建立一个 Main-owned 的 DSH lifecycle coordinator，并复用现有注册/bridge 模块：

1. 保存、来源选择、key 轮换、Home 选择、停用、删除进入统一 mutation 门。
   只对实际影响 DSH 的配置差异换代；修改名称、排序或其他 Runtime 的字段，不重启 DSH。
2. 若有运行中 DSH 消息/工具/待审批，**修改前**返回受影响任务及操作说明；用户先明确停止。
   不静默中断，更不能影响 Claude Code、Codex、Pi。
3. 没有活跃轮次时，关闭本 generation 的 DSH live handles，保留任务记录、binding 和已提交投影。
4. 校验实例身份与 generation 后注销旧 DSH adapter，再 dispose 其持有的全部任务 bridge，禁止旧异步结果重新注册。
5. 读取最新 owner/config，重新 admission/启动/注册，并广播 unavailable → starting → ready/failed。
6. 停止或关闭结果不确定时进入 needs-reconcile；禁止自动发送、自动重建成新任务或回放上轮请求。

`Maker` 如需新增注销接口，合同必须是“expected instance 相等、没有所属 live handles、只移除指定 kind”。
DSH coordinator 是本次唯一新增使用方；工具任务按 §8.3 分配独立 bridge，注册成功只表示该版本的
任务工厂可用，每个新任务仍需独立 admission。不提供任意 Renderer unregister 接口，不调用全局 `resetMaker()`
来实现 DSH 切换。create/send 必须和 mutation 使用同一准入边界，不能在预检与提交之间新起一轮。

key 轮换但来源/路由未变：已 settle 的任务按现有恢复规则重新验证；来源或 endpoint 改变：旧任务
不得静默绑定新来源。先显示不匹配，允许用户新建 DSH 任务；不在本次引入未经设计的历史迁移。
owner 切换清除状态和在途诊断，dispose 的故障半径只限原 owner 的 DSH scope。

### 6.1 本轮源码落实

1. `agent-registration.ts` 在注册前从 Main-only key store 读取一次唯一 DSH key，冻结为该
   registration generation 的 loader，再在桥接构造后重新解析 provider/key。此前 per-task router
   不会在注册时创建 Helper，因此旧逻辑的 `launchedSecret === null` 会让**每次**注册都返回
   `configuration-changed-during-start`；该阻塞根因已消除。
2. `maker-host/index.ts` 的 `assertCurrentConfiguration()` 现在同时校验 owner、provider id、base URL、
   origin 和当前 key。旧 generation 遇到变更只可 close，不能用新 key 发下一条 prompt。
3. `Maker.unregisterAgent()` 要求 expected instance 一致，且该 kind 没有已发布 session 或尚在
   `startSession()` 的 pre-publication session。DSH coordinator 先检查这些条件，再 dispose 旧 adapter；
   配置改变不会 reset Maker，更不会打断 Claude Code、Codex 或 Pi。
4. 若 DSH task 仍活跃，coordinator 标记 `reconfiguration-pending` 并广播状态，不静默关闭它。用户关闭
   最后一项后，通过 Maker `session:closed` 事件重新 admission 当前 generation。若关闭结果不确定，
   不自动重放 prompt；按既有 binding/reconcile 边界处理。

当前 provider CRUD 的保存成功仍不倒回用户刚写入的配置；有活跃 DSH task 时新的配置先安全保存、
旧 generation 拒绝新 prompt，状态卡要求用户关闭受影响 task 后再接入。要实现“保存按钮在写入前列出
受影响任务并阻止保存”的额外交互，必须把 preflight 接进现有 provider CRUD 事务，不能事后从 Renderer
猜测；它不影响本轮的 fail-closed/不静默中断不变量。

## 7. 新建、消息、模型和恢复链路

### 7.1 新建任务

- 本机 Agent 选择器保留可发现的 DSH 项；不可用时展示具体原因和“配置/重试”入口，不静默消失。
- 远程 SSH/跨设备目标明确不支持，不能使用本机 ready 状态冒充被控端 ready。
- 从设置点击“新建 DSH 任务”显式选中 DSH；保留用户的项目/草稿，不自动提交消息。
- create/send 在 Main 重验可用性；未就绪不创建空壳、无主 worktree 或失败后回退的 Claude 任务。
- 保留 `agent_kind='dsh'` 和 `DSH_MANAGED_RUNTIME_MODEL_ID` 的内部占位合同；不得把占位值当真实模型展示。
- **创建路径不共用 local DB**：普通 Agent 仍由 `local-db:sessions:create` 创建；DSH 必须调用
  `maker:create-session`，由 Main 完成注册准入、private dialogue workspace 分配和 native workspace
  bookmark 选择。该分叉是安全边界，不能通过删除 local DB 的 DSH 拒绝守卫来“修复”。
- DSH create payload 固定 `agentKind='dsh'`、`DSH_MANAGED_RUNTIME_MODEL_ID`、`permissionMode='auto'`、
  `fastMode=false`、`planMode=false`，不带 renderer-selected `providerId`、附件额外目录或可写目录。
- `DSH_MANAGED_RUNTIME_MODEL_ID` 是已在 create IPC 边界验证过的内部 runtime 身份，不是通用 provider
  catalog 的聊天模型。因此 `maker:create-session` 的新建路由和每 turn 的 generic model-route guard 都只能对
  **精确**的 `(agentKind='dsh', marker)` 跳过 catalog 判定；DSH 仍由 Main control plane 在 native create /
  prompt 前重新校验唯一 HTTPS endpoint、当前 owner 和 key。不得以 agentKind 单独跳过，也不得让普通 model
  guard、停用/付费 guard 或其他 Agent 失效。
  Main 对同一不变量再次校验；Renderer 的类型放宽不构成授权。
- DSH 当前不支持 Worktree、SSH 或 device-link。切换到 DSH 时 Worktree 入口禁用，旧的偏好状态也不得
  阻塞或误触发 Worktree saga；用户选定的普通本地工作目录仍由 Main 要求精确、一次性的 macOS 授权。

### 7.2 模型、推理强度和普通消息

- 模型候选以该 live session 的 ACP 配置为准，复用现有 DSH 配置面板，禁止复用 CC/Codex/Pi 的模型目录。
- 第一轮沿用受管 runtime 的有效默认值，并尽快展示其真实标签；没有原生候选时明确由 runtime 管理。
  本次不为了首条消息前选模型而预建隐藏用户任务。
- 选择只接受 Main 签发的 choice token，闲置边界执行；收到原生确认后更新，应用于后续消息。
  切换失败或结果不确定时重新读取权威状态，不乐观显示成功；旧 session/revision 的 token 失效。
- 本次不持久化 opaque token、不新增全局“记住 DSH 模型”偏好；重启后读新 runtime 状态。
- 验收要证明选中模型实际用于随后请求；只看到 dropdown 改字或 fixture 通过不算生效。
- 发送、流式展示、usage、停止、关闭复用既有 DSH bridge/translator/receipt；未知事件诚实降级。
  不把无文本错误显示为空白成功，不根据流停止推断 cancel 已确认。

### 7.3 恢复与能力边界

- 重启后保持原 Cindy 任务身份；只恢复同一已验证 Home/release/来源边界内、receipt 已 settle 的绑定。
- 先 close 后 fresh list/reconcile/resume；不得把 close 当作删除历史。
- history gap、未知结果、绑定不匹配、Home 授权失效时呈现原因和可用操作，不生成新的 native 任务冒充恢复。
- 本地计划/待办继续注明 Cindy 保存，不宣称为 DSH 原生计划 API。
- 本地文件附件按 §8.6 交付，图片输入按 runtime 与模型共同能力开放；不再保留“DSH 永远只收文本”的分支。
- 跨 Agent 切换、fork/rewind、scheduler、Orca、review 变更快照等按实际能力保持不可用。
  `sendToSessionExecutionConfig.ts` 的 DSH 拒绝属于其他任务派发覆盖路径，不能当普通 New Maker 阻塞而直接删掉。
  `beginTurnChangeSetAtDispatch` 的 DSH 拒绝同样必须按调用方审计，不通过绕过 review 门禁“修通”。

## 8. 七项禁用模块的恢复与具体修复

### 8.1 必须开启的范围

用户本次明确要求恢复以下七项；它们是一个完整本机工具方案的组成部分。采用同一
DSH 原生 ACP/profile/tool 执行链，Cindy 负责进程、授权、输入和结果呈现。

| 模块               | 最终行为                                              | 必须补齐的实现与证明                                                     |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `subprocess`       | 在任务工作目录启动命令/PTY 子进程，收集输出并停止     | `node-pty`/spawn-helper 装载与执行；命令环境；退出码、信号、后代清理     |
| `tool-bash`        | DSH 可执行用户任务需要的 shell 命令，包括开发工具     | 原生工具注册、cwd、授权、标准输出/错误、失败/取消事件；真实项目测试      |
| `tool-fs-search`   | 文件名/内容搜索，结果能定位到授权目录内文件           | 随包 `-rg` 可执行、路径/Unicode/大目录行为；搜索结果不串任务             |
| `permission`       | 原生工具需要审批时，Cindy 显示内容并回传一次允许/拒绝 | tool call 关联、原生 preset 配置、interaction UI、取消/超时/重复回包处理 |
| `sandbox`          | 原生文件/进程访问边界实际生效                         | `koffi` 与原生沙箱初始化；目录授权；和外层 Helper App Sandbox 的兼容性   |
| `bash-sandbox`     | shell 在与任务权限一致的边界内执行                    | 正向允许目录读写/命令测试与反向越界测试，不能只看模块加载成功            |
| `attachment-local` | 本地文件可作为输入；原生支持的图片可处理              | 附件入库/授权、Main 解析、bridge/ACP 内容传递、`sharp`/`libvips` 实测    |

文件修改不凭空假设有独立 `tool-fs-write`：复用该固定版本实际提供的编辑工具或已开启的
shell 工具完成，并以真实文件差异验收。`tool-bash` 可用也不等于实现了 ACP terminal API；
本次接通命令工具及结果展示，不把原生未提供的 terminal API 写成已支持。

### 8.2 构建补丁、native cache 与签名制品

修改点集中在以下已有文件，不从零建立第二套打包器：

- **已完成（build.11 source build + signed package）**：删除
  `tools/dsh/upstream-patches/deepseek-harness-alpha3-macos-acp-mvp-capability-floor.patch`，并从
  `tools/dsh/macos-supervised-source-release.json` 移除其 adaptation，release identity 升为
  `cindy-dsh-0.1.2-alpha.3-build.11-macos-supervised`。source-release test 断言不再把
  `packages/bundle/acp-app/cordis.patch.yml` 作为 Cindy adaptation。固定上游 checkout、Node 与 pnpm
  输入已重建 runtime；新 App 的 signed Helper E2E 已证明七项 profile 可启动，且真实 `tool-bash`
  调用可以返回结果。旧 build.9 制品仍保留其历史 capability floor，不能与 build.11 混为一谈。
- **已完成（静态 source release + signed execution）**：`deepseek-harness-alpha3-cindy-tool-path.patch` 精确绑定
  alpha.3 的 `subprocess` 源码和 fixture。它仅在子进程环境生成点消费
  `CINDY_DSH_TOOL_PATH` 为 `PATH`，再剔除所有 `CINDY_DSH_*`；固定提交原本的
  `scrubbedParentEnv()` 继续剔除 `*KEY*`、`*PASSWORD*`、`*SECRET*`、`*TOKEN*` 与全部
  `DSH_*`。因此 provider key、内部 token、配置激活变量不会自然进入工具子进程。新 patch 与
  既有 build-script adaptations 已在干净固定 checkout **顺序 apply + postimage verify**；同一签名
  Helper 的 shell fixture 已实际断言 provider key/base URL 均为空。B08 其它开发工具与 B09 的内部
  token 组合仍需继续验收。
- `tools/dsh/upstream-patches/deepseek-harness-alpha3-stage-sealed-native-addon-cache.patch` 与
  `deepseek-harness-alpha3-stage-sealed-pkg-native-cache.patch`：复核已有 loader/cache 映射；只有动态测试
  暴露缺项才补依赖。覆盖 `sharp`、`libvips`、`koffi`、`pty.node` 的相对加载、架构及 Node ABI。
- `scripts/dsh-macos-supervised-source-build.mjs`、`tools/dsh/pnpm-dsh-build-wrapper.mjs`：
  让新的 adaptations、冻结依赖与 native 文件进入可重复构建；禁止用开发机偶然存在的包补洞。
- `tools/dsh/macos-supervised-source-release.json`：生成新的 build releaseId，更新 patch 摘要与
  preimage/postimage；`tools/dsh/latest.json`、runtime tree manifest、sidecars 和 descriptor 同步。
  原 `source-release.json` 是另一个历史 build 输入，仅在实际共用变更影响它时同步，不能覆盖历史证据。
- `apps/desktop/scripts/stage-dsh-macos-supervised-runtime.mjs`、`package-dsh-local-macos.mjs`：
  继续从受审制品打入固定 Helper，签署原生库、runtime、sidecar、Helper 与 App；复验最终包。
- **Hardened Runtime 修复（已完成且范围受限）**：在
  `apps/desktop/native/dsh/macos-dsh-runtime-inherit.entitlements` 仅为 DSH SEA runtime 增加
  `com.apple.security.cs.disable-library-validation`，并在 staging 脚本中 post-sign 断言。原因是本机
  ad-hoc 签名没有 Team ID，Hardened Runtime 会拒绝 separately sealed 的 `sharp`、`koffi`、`node-pty`。
  Main 与 Supervisor 保持 library validation；这个例外不允许从 sealed cache 外部加载模块，缓存的
  manifest/regular-file/realpath/摘要校验不变。

动态验证必须在**工具 profile 已启用的同一签名包**运行，包括 native 库装载、图像转换、PTY、
spawn helper、rg 和原生沙箱初始化。文件存在、构建通过、`codesign` 通过分别记录，不能互相替代。
native cache 的寻址 key 与签名前输入相关；签名后文件摘要可能改变，须保留输入及最终制品两套摘要，
验证 loader 的实际寻址语义，不能随意用签后摘要重命名缓存目录。

DSH 自身启动继续使用随包执行程序，不回退全局 `dsh` 或系统 Node；**用户任务中的 git、Node、
Python、pnpm 等是正常开发工具**，按 §8.4 提供可用环境，不能误套 runtime 分发限制而一律拒绝。
签名与工具能力可以同时保留。若当前组合有兼容错误，先在固定版本适配中修复并记录具体失败；
只有确有证据需要升级上游版本时才提出带差异的版本选项，不把永久关闭七项作为修复结果。

### 8.3 工作目录授权与每任务运行时隔离

现有 `session-cwd-admission.ts` 只做 Main 侧一次性 cwd 准入；现有 implicit bookmark 主要用于
已有 DSH Home。它们不能直接证明 Helper 获得了项目目录的读写权。工具恢复后需补：

1. **已实现源码骨架**：Main 在 DSH task start 时对已校验的精确 `workingDir` 发起原生目录选择；
   仅选择结果 realpath 与该任务 cwd 完全一致时，才把 security-scoped bookmark 在 Main 内转换成
   不持久化的 workspace implicit handoff。它绑定当前 Cindy session、一次启动用途与 cwd；选父目录、
   兄弟目录、符号链接目标、取消或账户边界变化均拒绝。当前版本选择每次新 Helper 显式确认，
   **尚未**持久化跨重启 workspace grant，故不声称“无提示复用”。
2. 复用 `main-bookmark-bridge.ts`、`macos-dsh-main-bookmark-bridge.mm` 和
   `macos-dsh-implicit-bookmark.{h,m}` 的机制，扩展有版本的私有交接记录，明确区分 Home、
   workspace、attachment，不能把现有 Home bookmark 字段偷换成工作目录。
3. 更新 `macos-dsh-sandbox-supervisor.c`、`implicit-bookmark-handoff.ts` 和
   `dsh-acp-stdio-transport.ts` 的私有 descriptor 读写，校验数量/长度/用途/EOF 与代次；
   Helper 解析后持有实际目录授权，结束时释放。旧记录仍按旧语义读取，未知版本拒绝。
4. **已实现源码骨架**：`task-bridge-router.ts` 把 maker-core 的一个 DSH port 路由到每个 Cindy task
   一个 `MacosSupervisedDshBridge`。`scopeId` 的 hash 纳入 `taskScopeId`，因此 managed Home/process Home
   不再与其它工具任务共享；外部 opaque key 只能索引本任务的内部 bridge key。关闭一项会关闭其 Helper，
   不触碰其他任务。
5. **已改**：`maker-host/index.ts` 不再把 runtime configuration 直接打到全局 native bridge；它经任务
   router 按 `cindySessionId` 查找同一 task 的 control plane。任务启动前把 workspace grant 消耗掉，内层
   control plane 只接受相同的 cwd/session pair；Maker、Renderer 与 ACP 均不获得原始 bookmark。
6. scope 标识纳入任务身份，持久 Home 位置/ledger 身份保持可重建，临时实例代次仅用于失效旧调用。
   release 升级或旧共享 scope 迁移必须按公开 list/resume 证明身份和历史连续性；不可直接搬/改私有 DSH 数据。
   没有连续性证据的旧任务保留阅读及明确迁移说明，新建工具任务使用新 scope，不悄悄替换旧历史。

目录边界要覆盖路径规范化、符号链接跳出、文件替换与授权失效。外层 App Sandbox 和 DSH 内部
`sandbox`/`bash-sandbox` 都必须在实际目标目录上验证：工作目录内能正常工作，目录外请求走明确的
扩展授权或拒绝；不能为让命令跑起来直接授予整个用户 Home。

### 8.4 命令执行、文件读写与开发工具环境

工具 profile 装配后，核验原生工具列表包含 bash 和文件搜索，读取/编辑沿原生工具执行。
文件搜索使用随包 rg；UI 路径点击复用 Cindy 的现有文件打开能力。文件修改后的内容以磁盘实际结果为准，
文件树/文件预览复用原有刷新链，不能用模型“已修改”的文字代替落盘结果。

命令执行需要两个分开的环境合同：

- **runtime 启动环境**继续由 Main/supervisor 管理，固定程序、清理继承环境，保存独立模型凭证。
- **工具命令环境**已在源码中独立为 `CINDY_DSH_TOOL_PATH`：Main 只选择 canonical real directories
  `/usr/bin`、`/bin`、`/usr/local/bin`、`/opt/homebrew/bin` 的当前存在项；Helper 再次 realpath/lstat
  校验。runtime 启动 `PATH` 继续固定 `/usr/bin:/bin`，禁止复制 Electron `process.env`。build.11 的
  固定 source adaptation 已让 DSH `scrubbedParentEnv()` 只在工具 child 的 `PATH` 位置消费该值，并
  剔除全部 `CINDY_DSH_*`。固定提交本身还会剔除 credential-shaped 与 `DSH_*` 环境；故 provider key、
  bookmark/lease 类内部变量不会经常规环境继承。source fixture 与同包 B09 必须验证实际 spawn 路径，
  未验收前不可称 P5c 的用户功能完成。

当前 supervisor 会把 `CINDY_DSH_PROVIDER_API_KEY` 交给 DSH 进程。开放 subprocess 时必须检查原生
子进程环境构造，禁止把该 key、其他供应商 key、Home bookmark、内部 lease token 继承给命令。
必要修复写入受审、固定摘要的 DSH source adaptation；不靠输出脱敏代替阻止凭证进入子进程。
项目明确配置的工具环境继续按既有机制处理；不能复制整个 Electron 主进程环境给 shell。

执行记录关联到当前工具调用，覆盖 cwd、命令摘要、输出、退出码、错误和取消。输出采用有界流，
大输出不能突破现有 ACP frame 上限，截断必须可见。遵守原生 tool result 格式，不能把 PTY 字节
混进 ACP 控制流。开发工具正常安装/更新产生的访问请求沿本任务权限处理，不额外编造静态代码审批。

### 8.5 权限模块、沙箱与交互接通

恢复 `permission` 及原生权限 preset，首个工具版本采用经验证的“工作目录可写、需要时询问”
组合，让项目内编辑可用。实际 preset 名称/配置字段以固定版本源码为准；不能继续固定只读 profile
却在 UI 宣称能改代码，也不能默认切到全盘免审批。

一次工具交互为：原生 `tool_call` → Main 提交安全投影 → 原生 permission request →
现有 Cindy interaction 卡 → 一次允许/拒绝 → 原生执行/拒绝结果 → 消息区展示。

主要复用 `dsh-control-plane.ts`、`packages/maker-core/src/agents/dsh/{bridge-port,index,translator}.ts`
及现有 interaction listener；按 owner、任务、bridge 实例和 tool id 关联。`kind='other'` 不能用来
判断工具安全性；原生未给持久授权时 UI 不显示“永久允许”。取消、超时、任务关闭、重复点击和迟到回答
都有唯一结算，不能留在等待中，也不能影响别的工具调用。

用户选择文件夹授予的是目录范围，允许某次工具是该次操作授权，两者分别落实。首次工具版使用原生
ask 行为，只在原生发出请求时显示审批；不要给每次读取额外叠加一张 Cindy 确认。
会话中改变权限档位不是现有原生能力：需要新 profile 时在任务空闲边界通过 §6 受控重建并明确生效范围。
`auto`/免审批模式不是恢复 `permission` 模块的前提，本次不借开启工具自动赋予持久或全盘授权。

### 8.6 本地附件、图片和输入桥接

附件必须从 UI 到原生输入完整打通，不能只移除 `attachment-local` 的 disabled：

1. `ChatInput.tsx`、`NewMakerDraftRoute.tsx` 及 DSH composer tests：将针对 DSH 的固定附件禁用
   改为能力判断，开放文件选择、拖拽和受支持图片的粘贴；能力缺失时发送前说明具体类型原因。
2. 复用 `main/maker-ipc/normalizeAttachments.ts` 和现有附件归属校验，Main 解析用户选中的文件，
   对 MIME、大小、归属和可读性做校验，生成绑定任务/消息的附件引用与读取 lease。
3. `index.ts` 的 `textFromUserMessage()` 改为有类型的文本/文件/图片输入归一化；
   `DshBridgePort.prompt` 增加版本化内容合同。保留旧 `{text}` 读取兼容；如果替换契约则显式升版，
   全部本地 adapter/client/receipt 调用同步，不修改 ACP wire 的公开字段定义。
4. `dsh-control-plane.ts` 负责把已批准的内容转成 pin 住的 ACP prompt blocks，保留顺序、MIME 和
   内容身份。maker-core 不拿原始 bookmark，不把 Renderer 任意路径/URL直通原生。
5. **普通文件**：至少交付源码、TXT、Markdown、JSON 的实际内容读取；它们作为可读附件交给原生
   工具，不仅在模型输入里留下不可访问的文件名。该 tag 未宣告通用 embedded context，不能伪造
   ACP file block。使用 Main 为该任务准备的只读附件 staging/lease，再在用户消息内容中放原生可读引用，
   让工具实际读取；支持格式和原生是否需要额外注册以同版本 fixture 锁定。PDF 等格式按原生转换能力
   逐项列明，不能把“本地附件可用”泛化为所有文件格式均能理解。
6. **图片**：打通 `sharp`/`libvips` 的实际转换，`acp-client.ts`/control plane 保留并校验
   `promptCapabilities.image`，再与所选模型的图像输入能力取交集。两者都支持时传实际图片内容并
   做真图验收；只支持文件工具处理时明确说明可做文件处理、不支持视觉问答。不能伪造视觉能力，
   也不能因模型不支持视觉继续禁用普通文件附件。若当前 pin/profile 未宣告图片，查明可开启的原生
   条件并修复；确需换 runtime/模型时在报告中给出具体差异，不把未完成标为通过。
7. **本轮已完成最小安全输入边界**：`prompt-content-admission.ts` 只接受 Main 已归一化的绝对普通文件，
   拒绝符号链接和额外目录，将副本写入 Helper 已授权的 task-hash staging 目录（目录 `0700`、文件
   `0600`）；ACP 只收到该副本的 file URI 或受限内联图片 bytes。它不向 Renderer、maker-core 或
   ACP 暴露原路径。图片持久副本仍须走 `main/cindy-media/{ingest,blobStore,ledger}.ts` 及现有附件适配；
   TXT/PDF 等非媒体保持既有受控文件通道。Helper staging 是有期限的传输副本，不另造永久媒体仓。
8. 成功发送后保持消息的持久引用；取消草稿/发送前失败释放未提交 lease；原生发送结果未知时
   先按 receipt 核对，不能清理后自动重发。恢复历史消息时从持久引用重建读取授权，缺文件明确提示。

附件验收要让 DSH 返回文件内独有内容，证明真实读到了附件；只出现附件 chip 不算。
图片验收分别记录本地解码/转换成功和模型理解成功，二者不能混记成一个“图片已支持”。

### 8.7 工具停止、进程回收和任务恢复

复用 native supervisor 与 `dsh-acp-stdio-transport.ts` 的进程管理，补带 PTY/普通子进程/后代
的 cancel/close/退出/账号切换测试。停止按钮先取消该任务；超时后只终止该任务的 Helper/runtime，
随后确认子进程与文件授权已释放，不能关闭其他 DSH 或 CC/Codex/Pi 任务。

普通进程组清理不自动证明脱离进程组的后代已退出；新增工具能力必须实测后台后代和父进程先退出等
情况，并通过该任务的原生监督机制补齐可观察收尾。不能仅凭 UI 结束或主 PID 消失写入成功。
不能确认退出的任务标记 needs-reconcile，保留诊断与 receipt，不重跑可能已经修改文件的命令。
停止已成功修改过文件的命令不会自动回滚文件；结果显示已发生的修改和停止状态。

重启只恢复已验证的 binding 与已结算消息。旧任务、旧 release 和新 per-task scope 的连续性按 §8.3
核验；历史工具展示来自已提交投影，不通过重新执行命令“补结果”。

### 8.8 能力投影、用户体验与完成定义

`DshAgent` capabilities 与 renderer 入口随当前真实能力更新，清除已实现功能的 `not-implemented`
和文本专用提示。设置页展示工具初始化/文件授权/附件能力状态及修复入口；消息区展示真实工具过程、
审批及结果。双主题与术语同步，不能出现后台已开放、界面仍隐藏，或界面开放、Main 仍拒绝的两种断层。

本次不新增系统 persona、不重造原生工具 loop；完整 MCP、任意扩展、SSH/Mobile、Orca 和 history
fork 继续按原专项计划处理。F7 existing Home 的已有选择与重启行为必须回归，其扩展不能代替受管
工具 profile 的验收。**七项恢复及其对应的实际功能验收完成，才算 B 完成。**

## 9. 实施顺序与修改文件

| 阶段                     | 主要改动位置（仓库相对路径）                                                                                                                                                                                     | 交付门槛                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P0 基线与合同            | 本文、`docs/dev-rules/dsh-harness.md`、现有 release evidence                                                                                                                                                     | 核实实际 App 版本/制品及七项禁用的代码/运行证据，锁定 A+B 范围                                                              |
| P1 状态和生命周期        | `apps/desktop/src/main/dsh-host/{provider-config,agent-registration}.ts`；`main/maker-host/index.ts`；`packages/maker-core/src/maker.ts`                                                                         | **源码已完成核心换代**：lazy registration 修复、expected-instance 注销、active/pre-publication fence、关闭后重注册；不影响其它 Agent |
| P2 配置与入口            | `renderer/components/settings/{CustomProviderDialog,ProvidersSection}.tsx`；`packages/model-providers/src/user-provider.ts`                                                                                      | **源码已完成**第四 tab、DSH-only 可见、官方 URL 提示和状态卡；来源选择/暂停的 owner override 仍是后续兼容增强              |
| P3 诊断闭环              | `apps/desktop/src/shared/dshRuntimeStatus.ts`、`preload/`、`main/maker-ipc/dsh-runtime-status-ipc.ts`；Main probe 与测试                                                                                             | **已完成安全状态/retry源码**；保存/host/模型三层真实 probe 必须在最终签名 App、无工具诊断 scope 中执行                       |
| P4 任务闭环              | `renderer/features/cc-agent/{NewMakerDraftRoute,CCAgentSessionView,DshRuntimeConfigurationPanel}.tsx`；`components/new-chat/{AgentSelect,ChatInput}.tsx`；`hooks/useAvailableAgents.ts`；相关 create/send/resume | 新建、模型确认、回复、停止、受限恢复通过 A                                                                                  |
| P5a 原生组件和 profile   | `tools/dsh/` 的 floor/cache patches、release manifest；source-build、staging、packaging 脚本                                                                                                                     | **已完成本机 source build、staging 和签名 App boot**：七项不再 forced-disabled；native closure 实际加载；runtime-only library-validation exception 有 post-sign 断言 |
| P5b 每任务进程与目录权限 | `main/dsh-host/{scope,session-cwd-admission,task-bridge-router,workspace-bookmark-grant,macos-supervised-bridge,implicit-bookmark-handoff}.ts`；`native/dsh/`；`maker-host/index.ts`；DSH adapter | **源码骨架已完成**：任务独立 bridge/Home、fd 4 grant handoff 与释放；待 signed App 证明实际 sandbox grant、生效/失效与旧 binding 的产品迁移策略 |
| P5c 工具和审批           | 原生 subprocess 受审 adaptation；`dsh-control-plane.ts`；`agents/dsh/{bridge-port,index,translator}.ts`；现有 interaction UI                                                                                     | **部分 signed App 验收**：真实 tool_call → Main one-shot allow → `bash` 返回→后续模型轮次，且 provider key/base URL 未进 shell；仍须搜索、真实项目读写、取消/后代、并发和 UI 实机 |
| P5d 附件与图片           | DSH bridge/client/control plane；`prompt-content-admission.ts`；`ChatInput.tsx`、`NewMakerDraftRoute.tsx`                                                                                                        | **源码已完成首段**文件/图片输入、任务私有 staging 与 ACP image handshake 分支；实际读取/视觉识别及媒体 lease 生命周期待 P5e |
| P5e 同包联合验收         | DSH 原生、adapter、IPC/renderer tests；runtime smoke、signed App 测试                                                                                                                                            | **部分完成**：build.11 本机同一制品 8/8 signed-Helper E2E；A 与 B01–B18 尚未全数完成，不能把该本机 package evidence 误报为全量产品验收 |
| P6 交付收口              | i18n/术语、`docs/dsh-release-evidence/`、相关测试与规则状态                                                                                                                                                      | 从“待做”改为逐项证据，记录仍不支持的能力，正式包验收                                                                        |

实施依赖：`P0 → P5a → P5b → P5c/P5d → P5e → P6`；P1–P4 与工具链并行施工时，先固定
per-task bridge、状态与附件合同，P4 及最终注册链使用 P5b 的工厂。P1–P4 是连续产品链路，
不能只完成 P2 或只完成文本里程碑就关闭需求；P5 的每项都是本次必做。
`packages/model-providers` 如需配置摘要类型调整，只扩展示例/配置摘要，不把 DSH 塞进通用模型路由。
不借本次重构大型 `register.ts` 或无关 Provider UI；不修改服务端、远程协议或既有 Agent prompt。

## 10. 验证矩阵与交付证据

### 10.1 本轮已取得的同制品证据

- 静态 release/staging 测试与 packaging/source-build 相关用例共 **52/52** 通过；新增 staging
  assertion 确保只有 DSH SEA runtime 具备 library-validation 例外。
- 构建目录和安装后的 `/Applications/Cindy.app` 均已通过
  `codesign --verify --deep --strict`；受控 local-loopback
  `macos-supervised-runtime.integration.test.ts` 在安装后实际路径同样为 **8/8**。
- 第八项是明确的工具正向证据：fixed Helper 接到上游 `bash` tool call，先把脱敏、opaque 的
  request 投影给 Cindy Main；Main 返回 `allow-once` 后，shell 在 test-only Helper container workspace
  中返回 `pwd`，随后同一 provider 的 post-tool 轮次完成。测试还断言 provider API key 与 base URL
  不在 tool result/event 中，且 shell 中对应变量为空。

这三项只关闭“新签名制品可启动、工具 profile 不再静态禁用、一次审批和安全只读命令可运行”的证明缺口。
它们**不**替代以下矩阵中真实用户工作目录的 bookmark 授权、搜索、附件/图像、写入拒绝、并发、取消与跨平台验收。

| 编号 | 场景                                                 | 必须看到的结果                                                                                  |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A01  | 原 DeepSeek provider 仅有 CC/Codex；打开 DSH tab     | 原字段/key 不变；DSH 未配置，不跟随其他 Runtime 亮绿                                            |
| A02  | 从零添加 DSH-only；保存、关闭、重开设置              | 供应商仍可见，DSH 配置保留，不要求假模型或额外 Runtime                                          |
| A03  | endpoint 不变留空 key；变更 endpoint 却未填 key      | 前者保留，后者阻止；显式清除与保留不混淆                                                        |
| A04  | 多来源、删除选中来源、排序、恢复自动选择             | 不静默切换；状态及所需操作准确；其他 Runtime 不受影响                                           |
| A05  | 包缺失/签名或版本错误/ACP 启动失败/错误 key/超时     | 对应安全原因；不谎报连接、不泄露原始错误、不无限重试                                            |
| A06  | host 握手成功但模型验证失败                          | “Runtime 就绪”与“模型连接失败”同时准确展示                                                      |
| A07  | 本机 DSH 新建真实任务并发消息                        | DB 身份为 dsh，实际走 DSH 子进程，收到真实回复与终止事件                                        |
| A07b | DSH 草稿发送首条消息                                 | 不再出现 local-db 的 `UNSUPPORTED_CAPABILITY`；首次按需要选择精确本地工作目录，任务记录为 dsh，首条请求进入受管 Helper |
| A08  | live 模型/推理强度候选变更                           | 原生确认且后续请求生效；过期 token、忙时变更被拒绝                                              |
| A09  | 停止长回复、关闭、重启后恢复同一 settled 任务        | 不重复消息，不换身份；同一来源下可继续发送                                                      |
| A10  | 改配置、停用、换 owner 与注册/create/send 并发       | 旧结果不复活；拒绝跨 owner/旧 revision；其他 Agent 正常                                         |
| A10b | 暂停后重启 App；只改名称/排序/其他 Runtime           | 暂停不自动启用；无关改动不重启 DSH、不打断消息                                                  |
| A11  | receipt 未知、history gap、旧来源不匹配              | needs-reconcile 或明确不可恢复；不自动重发或伪造恢复                                            |
| A12  | SSH/device-link/非支持平台选择 DSH                   | 明确不可用，不回退其他 Agent，不使用本机状态冒充远端                                            |
| B01  | signed App 读取选定工作目录中的测试文件              | 原生工具事件和真实结果一致，目录外访问仍受限制                                                  |
| B02  | 允许/拒绝修改测试文件                                | 允许后真实落盘；拒绝后文件不变；请求不串任务                                                    |
| B03  | 执行无害命令、运行中停止/退出/切账号                 | 真实输出；进程及权限 lease 回收，未知结果不重放                                                 |
| B04  | two sessions + 工具审批/取消并发                     | 请求、工作目录、输出、权限不串；资源故障半径可证明                                              |
| B05  | 受管 Home 与用户已有 Home 切换、重启                 | 按各自授权恢复或明确失败，不借现有 Home 逃逸权限边界                                            |
| B06  | 七项模块在最终工具 profile 初始化                    | 每项有初始化与功能证据；普通 profile 无固定 disabled，诊断 profile 保持无工具                   |
| B07  | 实际执行随包 rg 搜索文件名/内容                      | 命中测试文件真实内容，中文/空格路径有效，范围和错误信息准确                                     |
| B08  | 运行本机开发工具及一个隔离样例的构建/测试            | git/Node/Python/包管理器按实际安装发现；工具不存在与权限拒绝可区分                              |
| B09  | 工具子进程输出测试环境变量的存在性                   | DSH 模型假 key/内部假 token 不在子进程；正常任务环境有效；禁止用真实 key 做测试                 |
| B10  | 原生 sandbox 与 bash-sandbox 的正反向用例            | 目录内读写成功；目录外/符号链接越界按既定权限处理；两个任务不能互读私有目录                     |
| B11  | 选择/拖拽 TXT、源码、Markdown、JSON 附件             | DSH 读到文件中独有内容；附件原件不被改动；chip 和历史引用正确                                   |
| B12  | 粘贴受支持图片、执行本地图像转换                     | sharp/libvips 真正处理并产出可验证结果；原图和处理结果归属/清理正确                             |
| B13  | 图片输入能力为 true/false、切换到不同能力的模型      | 支持组合真实传图并识别图中特征；不支持时明确限制，普通附件仍可用；不能仅靠 fixture 声称视觉通过 |
| B14  | 附件发送前失败/取消、发出后结果未知、App 重启        | 已提交引用保留，未提交租约释放，未知结果不重放；恢复能重新取得合法读取授权                      |
| B15  | 待审批时停止/关闭/切账号，重复或迟到回答             | 一次结算；无悬挂工具、无跨任务允许、无永久授权假象                                              |
| B16  | 大输出、命令失败、PTY、后台后代、主进程先退出        | UI/ACP 不堵死，错误与截断可见；工具及后代有确切退出结果，不只看主 PID                           |
| B17  | 修改前已有用户未提交代码；工具只改指定文件           | 原有改动保留，实际差异可见，停止不假称撤销已落盘修改                                            |
| B18  | 文本时代旧任务升级、两个新工具任务分别重启           | 历史身份/引用不丢；兼容的恢复不重发，不兼容明确保留；新 scope 权限不串                          |
| R01  | CC/Codex/Pi 创建、模型选择、保存 key、普通供应商测试 | 现有三条链路不退化                                                                              |
| R02  | Light/Dark、窄窗口、键盘、错误文案、loading          | 两模式实现，截图标注实际验过的模式；不把复用 token 当作实机证明                                 |

测试分层：纯函数/存储/状态机单测 → IPC 和 Renderer 交互测试 → runtime/SQLite 集成 → **同一份签名
App 的真实模型、工具与附件验收**。fixture、mock 和本地普通脚本不能替代最后一层。
对模型确实不支持的视觉场景，验收的是正确拒绝与本地图像处理，不能登记为“视觉问答通过”；
原生可支持的模块如果因本仓打包/适配未完成而不能用，仍记失败/未完成，不能当作不适用跳过。
自动测试使用隔离临时目录与测试凭证，不读真实用户 key；真实请求由用户授权的专用配置执行。

未来提交前必须运行 `pnpm test:unit:related`，以及实际涉及 package 的 typecheck：
`pnpm --filter desktop run --if-present typecheck`、
`pnpm --filter @cindy/maker-core run --if-present typecheck`；若改 model-providers，追加该包检查。
另跑相关 DSH source-build/packaging suites、i18n/glossary、`pnpm check:dev-docs`、`git diff --check`。
DSH 专项至少涵盖 `scripts/__tests__/dsh-{source-build-release,macos-supervised-source-build,pnpm-build-wrapper,native-host-gate}.test.mjs`、
`apps/desktop/scripts/{stage-dsh-macos-supervised-runtime,package-dsh-local-macos}.test.mjs`，及
`agents/dsh`、`main/dsh-host`、`dshControlPlane`、附件归属/回收、composer 的实际改动相关测试。
既有断言“七项始终关闭/DSH 始终只收文本”的测试，改为验证无工具诊断 profile、工具 profile 的
完整能力与各自输入边界；保留旧版本降级测试，不能直接删断言获得绿灯。
修改依赖清单、测试调度等按仓库规则退回全量；不靠跳过测试提交。commit 必须 DCO；推送/PR/发布另需授权。

验收报告逐项记录 commit、runtime release、archive/manifest/App hash、签名身份、macOS/架构、
配置状态、通过/失败/未执行用例，以及脱敏的界面和执行结果；不记录 key、完整用户配置或原始 ACP。
App 版本号为 `0.0.0` 时必须补制品身份，不把源码 HEAD 直接当作安装包版本。

## 11. 回退、风险与审核点

- UI 回退不删旧 provider/key。新增状态合同保留兼容；来源 override 不破坏原 runtimes 结构。
- 生命周期异常时只停用 DSH 新建/发送，保留已存任务与 receipt；不自动换模型或 Agent。
- 工具能力回退可临时恢复已验收的文本级 capability floor，但必须标注 B 未完成，并继续修复本次
  要求开启的七项；不能把永久回退为文本作为交付方案。
- 新增 migration 一律前向修复，不改旧 migration，不为回退删除用户历史。
- 最大工程不确定性在现有 native cache 的动态加载、原生/外层沙箱组合、工作目录授权、工具环境
  与附件原生消费；§2 已纠正“所有原生依赖都缺失”的笼统归因。
- A+B 以外的远程、完整 MCP/扩展生态与历史能力保持现有计划，不因本次页面变化宣称已支持。

用户已明确要求开启七项功能，范围不再停留于可选能力讨论。方案审核以“第四 Runtime 配置入口 +
完整任务链路 + 七项模块恢复 + 文件读写/命令/附件/审批实机可用”为一个修复目标。
实施可以按 P0–P6 拆分交付，最终必须给出同一 App 的联合验收报告；不再把 P5 列为以后再决定的选项。

build.11 已完成 source build、签名打包和受控 8/8 验收；修订 8 修复了 DSH 首条任务错误走
`local-db:sessions:create` 的旁路。实际 GUI 重测随后暴露第二个、同样发生在 provider 请求之前的遗漏：
`maker:create-session` 把 `cindy-dsh-managed` 错当作普通 agent-chat model，报
`[INVALID_PARAMS] model "cindy-dsh-managed" is not an agent chat model`。修订 9 用精确的
`isManagedDshRuntimeRoute(agentKind, model)` 仅跳过上述内部 marker 的两处 generic catalog guard；新包
`app.asar` SHA-256 为 `0a1ca74289fd5ba316081a12d4ae287985e8536080149e6f3cf6313b2a671da8`，已签名校验并
安装到 `/Applications/Cindy.app`。尚未把修订 9 的实际用户 provider 文本请求记为通过：首次启动后的 GUI
重测仍须由用户确认运行该新建应用，并在 macOS 精确工作目录授权后执行 A07b/A07。仍不能直接宣称全部工具
能力已在用户实际工作目录验收：文件搜索、附件/图像、真实写入、并发、取消与跨平台仍按 §10 保持“未执行”，
不能把移除静态 `disabled`、source adaptation 或 workspace 源码骨架写成用户机器已经完整可用。

修订 10 记录修订 9 之后的实际 macOS GUI 试跑：用户在系统 picker 中确认精确工作目录后，原先
`workspace picker did not return one security-scoped directory bookmark` 已不再出现，但
`DshAgent.startSession` 仍以 `create-failed` 结束。**修订 11 更正**：这只证明 Main 的目录选择与
书签准备已返回；领取书签时发生参数接反，尚未启动 Helper，不能认定书签已交接给 fd 4。
前次依据 Node 子进程描述符观测将这次失败归因为 FD3，证据不足，该根因结论已撤回。
以下保留修订 10 实际做过的修改记录，其必要性需后续以原生 Helper 入口证据重新核验：

- 在启动侧明确把这种 workspace-only launch 的空 fd 3 绑定到 `/dev/null`，并在 `spawn` 后立即关闭
  Main 自己的重复描述符；真实 Home / workspace handoff 仍仅使用专用 pipe/socket，未增加任何普通
  IPC、环境变量或路径通道。
- 在签名 Supervisor 中只把 socket/FIFO 认作私有书签 handoff，把字符设备明确当作“不存在的
  handoff”；未知描述符类型仍 fail closed。这样没有普通继承 descriptor 能把受管 launch 变成
  existing-Home launch。
- 增加真实 Node 子进程回归：fd 4 收到完整 versioned workspace frame，同时 fd 3 必须是字符设备。
  针对 transport、workspace grant、Main bridge、session request 与 renderer boundary 的 38 项检查为
  37 通过、1 项 Windows 有意跳过；Desktop TypeScript `tsc --noEmit` 通过。

修订 10 已以同一固定 runtime archive/manifest 重新签名打包，构建和安装路径均通过
`codesign --verify --deep --strict`；安装包 `app.asar` SHA-256 为
`ae2217ae66ac33c954478f26138f90b5d7f60017731b8d3ee5792a66413e30d4`，且本机受控
signed-Helper 集成测试 **8/8** 通过。它已安装为新的 `/Applications/Cindy.app`，替换前 App
移动到了废纸篓，未永久删除。尚未启动该新 App 并再次在真实用户工作目录中运行，故 A07b/A07
仍为**未通过、待实机复测**。
即使这次实机能创建并得到文本回复，也只能证明 DSH Runtime 的创建与首条模型链路；B01–B18 的文件、
工具、附件、写入、取消、并发与跨平台验收仍各自未执行，不得合并为“全部工具能力可用”。
