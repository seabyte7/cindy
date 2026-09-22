# DSH Cindy 控制面接入方案（DeepSeek Harness）

> **状态：Cindy 自主控制面已裁决、legacy 对照制品已取证，当前工作树中的 F0 未注册 bridge 核心与真实二进制
> lifecycle / prompt / owned-follow / running-turn cancel（`end_turn` / `cancelled` 终止值白名单）以及有界
> operation timeout 的本机 evidence 已交付；carrier EOF/exit 已 fail-closed 为 `needs-reconcile`。F1 已完成
> 本机 Desktop 的 `dsh` identity closure。F2 的早期 build.4 在临时签名 App Sandbox 的固定 Helper.app 内通过
> credential-free `initialize → new → close → list → resume → close` lifecycle；F3 的 opaque durable binding
> 亦通过 create→close→SQLite E2E。F3/F4 的 Main-only projection journal、prompt receipt 与 `DshAgent`
> source-runtime／SQLite E2E 均通过。F5a 已接入 Main 的受监督注册、创建 transaction、会话绑定 cwd
> 授权和 provider-snapshot fail-closed；F5c 仅验证了同一本机 Cindy task 在已 settle receipt、同一
> managed Home 和 fresh `session/list` 一致时可跨进程 resume；它仍没有 history replay、完整 selector/UI 或
> cross-device claim。build.11 已删除 ACP MVP capability floor，并从固定 DeepSeek tag/Node/pnpm 输入重建。
> 同一签名 Helper 的 local-loopback fixture 已真实收到 `session/request_permission`，经 Main-owned
> generic interaction resolver 收窄为一次 `allow-once` 后执行安全 `bash` `pwd`，并验证 provider key/base URL
> 不进入 shell 子进程。该证明只覆盖 Helper container 内的 test-only workspace，既不是持久批准，也不是用户项目
> bookmark、文件搜索、附件/图像、并发/取消或跨端产品验收。Main-only provider route
> 加 Helper outbound-network entitlement 的严格 signed-Helper prompt E2E 已通过：Main canonical adapter base
> 会移除 root terminal `/`，使 sealed adapter 的固定 `/chat/completions` 拼接与 source-runtime path 相同。实测
> 通过两轮 exact loopback request、committed text/usage projection、public cancel、durable receipt 和 no-leak
> checks；fixture 没有放宽。它仍不是生产 endpoint、generic egress containment 或完整 Desktop UI evidence。
> **F7 internal MCP 本机证据（2026-09-05）**：build.9 重打的同一份本地签名 `darwin-arm64` App 已在 fixed
> Helper 内完成 `create → authenticated initialize/tools/list → close → same-Cindy-task resume → 第二次
> authenticated initialize/tools/list → close`；两次 close 后 endpoint 均为零。该 test-only loopback lease
> 没有 Renderer、settings、用户 endpoint、secret 持久化或跨端表面，不能外推为 MCP 产品能力或 Existing Home 验收。
> 故**没有任何 DSH capability 因此转正**。
> 本文是把
> [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
> 接成 Cindy 第四个 Agent harness 的施工正本。这里的“完整”不是“能发文字 prompt”，而是
> Cindy 对 DSH task 的会话、生命周期、权限、事件、恢复和跨端投影拥有可测试的控制面，且不
> 无故丢失已被受管 runtime 公开的能力。
>
> **F3/F5a adapter 更新（2026-09-04）**：`packages/maker-core` 现有一个仅供 Main-owned bridge
> 注入和本地测试的 `DshAgent` export。它只接受本地、文本的已建立 bridge session；启动前必须收到
> “已提交 projection + durable prompt receipt ledger”两个 admission 事实，且对外只给 Cindy
> session 的不透明 handle id，绝不泄露或持久化 native runtime session id。已验证的本机 Helper、唯一
> provider 和当前 owner 同时成立时，Desktop Main 才可将它动态加入 `Maker`；generic create transaction 随即
> 允许该 agent。F5c 的跨进程 resume 只接受该 Cindy task 先前保存的 opaque handle，并由 Main 从已验证
> binding 解析 native id；它不能被当成完整可发布 Desktop 体验、history recovery 或跨设备 resume 证据。
> build.4 真实本机 runtime／SQLite adapter E2E 已在新增 admission gate 后重跑并通过；它仍不能借此宣称
> production endpoint 或完整 egress containment。
>
> **F4 bridge 边界审计（2026-09-03）**：`DshBridgePort` 的公开契约现只含 safe receipt、Cindy
> owner tuple、Main 生成的 ephemeral capability key 与已提交 `AgentEvent`。native runtime session id
> 以及 raw ACP follow envelope 都是 Desktop Main 私有类型；即使 Main 内部 raw-follow callback 也不携带
> runtime id。translator 的 Main-only 输入同样不需要该 id，避免它因类型 export、receipt 或 event
> 再次跨入 Maker adapter 边界。
>
> **受监督 bridge 组合更新（2026-09-03）**：`startMacosSupervisedDshBridge` 现在要求同一 Main
> 数据库提供 durable binding、prompt receipt ledger 和 projection journal，启动时把 journal 注入
> `DshControlPlane`，并只返回这些 admission 已成立的 Main-only token。F5a 的独立 Main registrar 再校验
> 当前 owner、唯一 DSH config、启动时 key 与 handshake 后 config/key 快照，才注册 `DshAgent`；它仍不暴露
> Renderer selector/UI。对应 opt-in E2E 现使用 fixed Helper.app + Cindy 固定 managed profile + literal `127.0.0.1`
> provider + fake key + real SQLite receipt/journal 的 create→prompt→committed-follow→close；在显式本机
> evidence 变量下才执行。build.4 的新 route/profile 重跑已通过 lifecycle／binding 和严格 prompt/cancel/
> projection/receipt 闭环；它只刷新 local contained Helper evidence，不可外推为产品可用。
> build.9 已实现 `@yao-pkg/pkg` 动态 `process.dlopen` 的 archive-bound、Helper-signed 只读缓存。2026-09-05
> 已从全新、本地验证过的 source tuple 完成一次 `darwin-arm64` source rebuild：archive SHA-256 为
> `19d70a9f5346e99fd21680d176c3a4639eb04951fb58e22da8bf8c1a38e99db1`，manifest/tree verification 通过，且由该
> archive 重打的 Cindy.app signed-Helper E2E 为 7/7 通过。上游 legacy deploy 已替换为 lockfile-bound workspace
> closure；pnpm 将唯一工作区 `file:` 依赖绝对化时，Cindy 只在 disposable checkout 内临时加入该精确 locator 的
> build-policy entry，并在成功或失败后还原、重验 adaptation postimage。该证据只说明当前本机 source-build recipe
> 已成功执行且 packaged App 通过已列的 E2E，**不**解除 capability floor，也不是 installer、发布、跨平台或生产 endpoint
> 结论。

> **图片链路 / dev capsule 更新（2026-09-19）**：当前 macOS supervised pin 为
> `cindy-dsh-0.1.6-alpha.2-build.2-macos-supervised`，上游 tag/commit 不变。受控 archive SHA-256 为
> `0e1be7b1d8319671d9cc7ed6ee5b1274513350fd3aecb9bbdd948f6fd07ac4ce`，tree manifest SHA-256 为
> `63b09892136ad04c790a006dfc4cfdefb9bb59dc73efa77a897b7ba17114f579`。
> Main 的 managed ACP profile 显式默认 `deepseek-flash`，继续使用 Messages 与 thinking；
> 不改 Existing Home、不增加静态模型目录。连接的 image handshake 与当前模型能力分开：后者以原生
> session 配置及本轮拒绝为准，不能用启动时的 image=true 宣称每个模型都能看图。
>
> 图片按实际 MIME 作为 ACP inline image 发送，不再将超过 3 MiB 的图片降级成 resource_link。
> 总体按 16 MiB ACP frame 预算预留 envelope 空间，必要时仅压缩内存副本，仍超限则明确拒绝；
> 普通文件逐次进入独立 batch，准备失败清理该 batch。原图不修改。`read_image` 的合法 ACP 图片
> 工具结果投影为有限摘要，图片仍由 DSH 原生交给模型，不把 base64 复制进 Cindy 事件库。
>
> 新增受控 source adaptation 修复 App Sandbox 内附件持久化：Main 先 fsync managed Home 与祖先，
> 固定 Supervisor 仅为 managed 模式发出内部持久化标记，runtime 在 Home 边界继续证明附件目录持久性。
> 不扩张 entitlement；Existing Home 继续上游逻辑；子进程不继承 `CINDY_DSH_*`。
> 新增 `rejected` receipt 仅用于固定版本 ACP 已证明的入队前拒绝和本地序列化拒绝；未知错误、超时、
> 断链、有 follow 的错误仍为 uncertain，禁止自动重放。拒绝输入恢复进草稿并去重，用户替换或清空后不复活。
>
> build.1 → build.2 仅在相同 owner/task/managed Home 中复用 scope，固定 runtime version、controller
> 与其余 capability 必须一致。仅允许 image=false → true 的精确指纹变化；必须 receipt 已结算、原生
> list 命中、resume 成功后 CAS 更新绑定。`needs_reconcile` 不自动解除，不重写原生历史或强改已有模型。
> 已有 request header 的模型由 DSH 恢复；尚未产生 request header 的空任务遵循原生 fallback 新默认。
> 回退旧 build 不自动降级已升级绑定，不能通过手改 DB 或复制历史规避校验。
>
> 本地 dev 必须使用该 build.2 的签名 `out/Cindy-darwin-arm64/Cindy.app` capsule，并重启 Main；
> Renderer 热更新不足以更新 ACP 进程。验收区分新任务默认、旧任务已存模型、明确拒绝、结果未确认四种状态。
> 本机该 capsule 已通过 13/13 signed-Helper loopback 集成测试，包含 build.1 的空任务和已有模型历史两种
> 升级路径、重复多图、选模拒绝后重试、图片历史恢复、独立 `read_image`、原有 lifecycle/MCP/权限/cancel。
> 复验使用 `macos-supervised-runtime.integration.test.ts`：设置 `CINDY_DSH_E2E_APP`、
> `CINDY_DSH_E2E_HOME`、`CINDY_DSH_E2E_RELEASE_ID`、`CINDY_DSH_E2E_PROMPT=1`；升级两例另外需要
> `CINDY_DSH_E2E_PREVIOUS_APP` 指向签名 build.1 的 `Cindy.app`。测试只创建独立临时 Home/任务和假密钥。
> 回环测试只证明本机 signed Helper 的模型传输与存储链路，不代表真实 DeepSeek 识图质量、双主题目检、
> Windows/Linux、远端或移动端已验收。

> **上一版 source release / Settings 刷新（2026-09-18）**：当时 Cindy 本机 pin 更新为上游 tag
> `dsh-v0.1.6-alpha.2`、commit `ddefc45fbc7f8e46dd73185e68295696d1297887`、tree
> `5aca5ee6f8dfd110dc3ae199fbddf8a0f606625f`。`darwin-arm64` 受控 archive SHA-256 为
> `326631758bfc967fc90dd1e0304ba513505d96608517787b4ffdc496556172a9`，tree manifest SHA-256 为
> `97205313999712b87f90d2e768c51ed0f401d66965a5624be74f922d122905e9`。由该 archive 重打的本地签名
> Cindy.app 已通过 9/9 fixed-Helper loopback E2E，覆盖 bookmark、ACP lifecycle、durable binding、internal
> MCP、Cindy-owned plan/todo、一次性工具审批、fresh-bridge resume、Maker prompt/cancel/close 与 provider
> projection。此版本的 DeepSeek provider 使用 **Anthropic Messages** 路径；Main 管理的 profile 必须显式写入
> `protocol: messages`，官方 base URL 为 `https://api.deepseek.com/anthropic`，由 DSH 追加
> `/v1/messages`。历史配置中精确的官方根地址 `https://api.deepseek.com[/]` 只在 Main/Renderer 的 DSH
> 边界兼容升级到该 base URL，custom gateway 不改写，且该等价迁移不得要求用户重输已存 key。Settings 不提供
> Codex 的协议、精确路径、请求头或静态模型表；新建任务后只显示当前 DSH session 经 ACP 实际 advertise 的
> `model` / `reasoning_effort` 选项。Office sidecar 不在 Cindy 当前 release schema 与受控 archive 中，不能宣称
> 已支持。下文关于 alpha.3、build.11 与 `/chat/completions` 的段落仅保留为历史证据；凡与本段冲突，以当前
> alpha.2 release descriptor、源码与测试为准。本机 loopback 和临时签名证据仍不等同于 notarized installer、
> 真实付费 DeepSeek 请求、Windows/Linux、remote/mobile 或 Office 产品验收。

> **build.11 工具 profile / 签名审计（2026-09-11）**：固定 tag
> `dsh-v0.1.2-alpha.3` commit `dd6322d604e00eec1ba5e0c8541159906a21094a` 的本机 source build
> 使用 Node `v24.20.0` / pnpm `11.7.0`，archive SHA-256 为
> `62dd87fa43af718d019f2f14ca6b3fd9318c80c36f7d008fdd9bb7e198914162`。capability-floor adaptation
> 已移除；sealed native cache 的 `sharp`、`koffi`、`node-pty` 动态加载不再因 local ad-hoc 签名缺少
> Team ID 而被 Hardened Runtime library validation 拒绝。例外必须严格限制于 DSH SEA runtime 的
> inherit entitlement `com.apple.security.cs.disable-library-validation`；**不得**赋给 Cindy Main 或
> Supervisor，且必须保留 sealed-cache 的 manifest、regular-file、non-symlink、realpath 与摘要校验。
> staging 必须 post-sign 断言此 exception 仅在 runtime 存在。重新打包的 Cindy.app 已通过
> `codesign --verify --deep --strict` 和 8/8 signed-Helper loopback E2E；这不构成 installer、发布、
> notarization、真实 provider、真实用户工作目录或全量工具验收结论。
>
> **受监督 provider 路径审计（2026-09-04）**：用户已授权为 macOS Helper 添加
> `com.apple.security.network.client`；该 entitlement 允许的是通用出站连接，**不是** loopback-only
> 防火墙。故 `provider-route.ts` 只接受本 Main 进程创建的 capability object：生产 route 必须是
> 当前 account 中由 Main 重新校验的唯一 `runtimes.dsh` 配置的精确 HTTPS origin，且无默认外部
> endpoint；E2E route 只能是带端口的
> literal `http://127.0.0.1`。固定 ACP profile 只引用
> `CINDY_DSH_PROVIDER_BASE_URL` / `CINDY_DSH_PROVIDER_API_KEY` 变量名，绝不把 endpoint 或 key 写入
> profile、DB、IPC、argv 或日志；HostManager 先物化 profile，再在已 route-admit 的情况下读取唯一 key。
> native supervisor 再次执行精确环境 allowlist，并要求 provider endpoint/key 成对且非空；post-stage
> `codesign` 检查确认 Helper 签名确实含 sandbox 与 network-client entitlement。路由、profile、软链、
> 环境净化、native process cleanup 的本地定向回归已通过。因为上游 DeepSeek adapter 自己追加
> `/chat/completions`，Main canonical provider base 一律移除 terminal `/`，避免 `URL#toString()` 把 root
> origin 改成与 source-runtime control path 不同的请求输入。真实签名 Helper 的同一 strict prompt E2E 已于
> 此修复后通过；它验证 exact `127.0.0.1` route、text/usage 的 committed projection、cancel 与 receipt。F5a
> 只会在独立、已验证的用户 provider 配置下启动受监督 Helper，且配置或 owner 在启动中变化便关闭该桥接。
>
> **DSH 独立 Provider 配置审计（2026-09-04）**：DSH 配置复用 Cindy 的 custom-provider 持久化与
> safeStorage 生命周期，但不是通用模型 provider。唯一允许的持久化形状是
> `runtimes.dsh = { baseUrl: <HTTPS>, models: [] }`；不得包含 model、wire protocol、request path、
> headers、models discovery 或 Pi catalog 字段，且同一 provider 只能使用缺省／显式 `apiKey` auth。
> DSH key 使用独立的 `provider_key_<providerId>_dsh` safeStorage 名称；绝不复用 Claude Code、Codex
> 或 Pi 的 key，也不将已有 DSH key 回填给 Renderer。Settings 只允许用户为新 endpoint 明确输入 key；
> endpoint 未变时留空才保留 Main 的已有 key，改变 endpoint 而未提交新 key 必须拒绝保存。Main 从当前
> account 的已持久化配置中选取**恰好一个** DSH runtime：零个、多个、缺 key、非 API-key auth、非法
> shape 或 route 都是 unavailable，绝不按 provider 排序猜测一个。只有 Main 在重新校验 HTTPS URL 后，
> 才以该配置的 exact origin 构造 opaque route capability；泛化的 provider test / fetch-model IPC 不接收
> `dsh`，故 Renderer 不能把此设置变成任意 endpoint 探测器。该配置层现在是 F5a Main registration 的
> 唯一输入：启动前、握手后及每次 native create/prompt 前均重新核对 owner、provider、route 和 key；任一
> 变化都会拒绝新操作，旧 child 只可完成原生 close。它仍**不**代表 selector/UI 已完成或外部 endpoint 已经被访问。
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
> **本地开发范围裁决（2026-09-03，用户更新）**：当前只在本机 `darwin-arm64` 构建和验证受控
> runtime；不构建 Linux/Windows、不触发 GitHub Actions 或任何远端构建，也不向 `upstream` 推送、提
> PR 或写 issue。代码只推送至用户自己的 fork。固定上游 source tuple 仍须在本地复核 tag、commit、
> tree、lockfile、Cindy pnpm/pkg-toolchain 与 build-script digest；本地 archive / hash / tree manifest
> / ACP E2E 是开发证据，**不是**发行 provenance 或跨平台声明。未来若要分发、上游合入或支持其他
> 平台，必须先获得用户新的明确授权并恢复独立的发布门禁。官方 wheel 只作协议对照，绝不作为回退。
> 本机验证的顺序、命令、观察重点和未覆盖项见
> [`dsh-local-macos-test-manual.md`](dsh-local-macos-test-manual.md)；Existing Home 的 Finder 三进程
> 手工验收仍只按其链接的专用手册执行。
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

---

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
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 会话控制面 | **Cindy `DshControlPlane`** 是唯一的产品会话控制面。它在 Desktop Main 管理版本化 `DshBridgePort`；底层 runtime 的公开 ACP v1 只由该 port 使用。 |
| ACP | Cindy bridge 使用 ACP 的 initialize/new/list/resume/prompt/cancel/close/update/permission 面；Renderer、Mobile、插件和其他 agent 均不得直连 ACP。一个 DSH session 只允许一个 Cindy bridge record 作为 owner。 |
| 进程模型 | 生产路径按 `账号 × runtime release × 执行位置` 隔离长生命周期 **Cindy DSH scope**。首版可由每 scope 一个 ACP subprocess 承载多个 session；资源/故障证据不足时降级为每 session 一个 scope，不能共享不受控状态。 |
| 状态权威 | runtime 是 ACP session 与其持久历史的权威；Cindy DB 是任务壳、binding、命令 receipt、跨端路由、`cindy-dsh` activity 和可重建投影的权威。两边不得对同一字段各自写入。 |
| 运行时 | 当前只使用本机从受审阅固定 source release 构建、经本地 archive hash、sidecar、tree manifest 和版本验证的 `darwin-arm64` 自包含 runtime；不得回落用户 PATH、系统 Node、上游 wheel 或未验收源码 checkout。它不是发布制品。 |
| 原生扩展 | 默认使用 Cindy 管理的 DSH Home；用户显式选择使用既有 DSH Home、profile、skill 或 plugin 时，Cindy 必须提供可恢复的原生路径，而不是永久禁用。 |
| 非公开接口 | 不读取或写入 DSH 私有 JSONL / 数据库来模拟 API，不 patch 私有协议。runtime 未公开的 DSH UI object 不进入 Cindy 的 `dsh-native` 类型；需要的产品工作流由 Cindy 自己的 versioned `cindy-dsh` contract 实现、测试和维护。 |

**Cindy Bridge Gate**：完整实现进入产品代码的条件是同一份 release evidence 证明：(a) 受管
runtime 的 ACP v1 初始化和 capability negotiation；(b) Cindy 能在空 managed Home、非项目
launcher cwd 中通过公开 ACP 完成 create/close/list/reconcile/resume（若 runtime advertises）/
prompt/cancel/close 的真实 lifecycle；(c) `DshBridgePort` 对每个命令的 ownership、receipt、
非 prompt operation timeout（关闭 carrier、禁止重试）、prompt 静默观察、EOF/exit 和 reconcile
语义有独立测试。**已验证 alpha.3 的 lifecycle 事实**：active
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

---

## Part I：ACP Basic 基线

## 1. ACP 基线审计结论与边界

### 1.1 结论

以下四项是原方案的缺陷，已改正为实施前门禁。**注意 P0-1 的改法**：缺陷是「未验收就写成
既定」，不是「上游不支持」；把两者混为一谈会造出反向错误，见 §1.4。

| 级别 | 原方案的问题 | 审计结论 / 处理 |
|----|------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| P0 | 将 ACP 的 MCP、图片、流式 thought/tool/usage、会话恢复、模型/effort 热切换写成**既定**能力 | 源码取证（§1.4）显示这些能力在 pin tag 上**确实存在**，所以问题不是「上游不支持」，而是「未经本仓验收就写成既定」。处理：状态一律为**候选**，由 Gate A 的真二进制实测逐项转正；实测不通过就收缩。不得反过来把未验证写成上游拒绝。 |
| P0 | 以 npm alpha 和 PyPI wheel 混合描述一个“官方运行时” | 当前仅在本机用固定 source release 构建并验证 `darwin-arm64` 自包含 payload；上游 wheel 仅作对照证据，npm 包、源码 checkout、系统 Node 和用户全局 `dsh` 都不在启动链中。上游轻量 tag 不能当签名，必须复核 tag→commit→tree、lockfile、build-script 和本地 archive/tree evidence；它不构成发行 provenance。 |
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

---

## 2. 准入证据包

每次升级或首次接入都必须把下列内容作为可 review 的 release evidence packet。任一项缺失：
`optionalAsset` 路径保持不可用；不得静默退回其他 dsh 来源。

1. **受信构建输入**：写出上游 repository、tag、固定 commit 与 tree；本机在干净 checkout 中
   复核 tag→commit（允许 lightweight tag，但其不可被当作签名）、tree、`pnpm-lock.yaml`、
   `scripts/build-exe-for-python-sdk.ts` 和 package manifest digest。上游脚本调用的
   `@yao-pkg/pkg@6.21.0` 不在上游 lockfile：必须经 Cindy 的 `tools/dsh/pkg-toolchain/` 冻结
   lock + integrity 校验，以窄 wrapper 替换**仅该** `pnpm dlx`，其它上游 pnpm 命令不改写。
   固定 Node 自带的 npm 只能以 `--ignore-scripts` 下载 release definition 中 SRI 固定的 pnpm tarball；
   验证该 tarball 后才可解包并以其中的 pnpm 执行 `pnpm install --frozen-lockfile`。固定的 pnpm 11
   在含不同 `packageManager` 字段的 Cindy workspace 中还必须以 `COREPACK_ROOT` sentinel 加
   `--pm-on-fail=ignore` 禁止其自动下载另一版本；该 sentinel 不调用 Corepack，实际 CLI 仍须是
   已验 SRI 的 tarball。sealed `pkg` 执行前必须把完整的冻结 pnpm dependency closure 解引用复制到临时 regular-file tree；不得只复制 `pkg` 本体后以原始 Cindy `node_modules`／`NODE_PATH` 补依赖。`pkg` closure 唯一允许的 install script 是在其独立 workspace 明示的
   `esbuild: true`；不得继承 Cindy 根配置或使用交互式 approve。禁止 Corepack 或 runner-global pnpm 的可变下载、相似 alpha 名称、可变 tag 或本机
   `node_modules` 推定输入。
   `pkg --sea` 的 `node24` 简写会查询 Node index 并静默升级 base binary。alpha3 的上游 build parser
   原本拒绝精确的 `node24.20.0-*`，所以 Cindy 必须先验证干净上游 source object，再应用 release
   definition 逐文件 preimage/postimage 和 patch SHA-256 均固定的最小 adaptation，使其仅接受完整
   `node<major>.<minor>.<patch>` target。本机构建随后只能使用精确的 `node24.20.0-macos-arm64`，先从
   `nodejs.org/dist/v24.20.0/` 取得唯一 macOS archive、按 release definition 的 SHA-256 校验后才写入
   pkg 的 SEA cache sentinel，并在 build 后再验同一 archive；不得让 pkg 查询 index 或以远端
   `SHASUMS256.txt` 的即时结果决定输入。patch 不得扩展为运行时代码改写、不得触碰超过 release
   declaration 的文件，也不得绕过上游 source 的初始 clean-tree / digest 验证。
   上游 build 所需的 `pnpm dlx @yao-pkg/pkg@6.21.0` 只能由临时 PATH shim 接到 Cindy wrapper；不得
   把 wrapper 注入 `npm_execpath`，否则 pnpm 自己的 dependency-state check 可能递归运行 wrapper 并变成
   未声明的 production install。
2. **本地 macOS 制品与证明**：只对 `darwin-arm64` 本地构建自包含 runtime，保存 source input、
   archive filename/size/SHA-256、主可执行、`-rg`、`-spawn-helper` 与完整 tree manifest。它不生成
   GitHub provenance、上传制品或发行声明。
   archive 解包必须拒绝路径穿越、symlink、特殊文件、缺旁车、额外文件或不可执行主文件。
3. **实际协议探针**：用该主可执行、空的 Cindy 管理 `DSH_HOME`、非项目 launcher `cwd`
   启动 ACP；保存已脱敏的 initialize response、支持的 capability / config option、一次
   `session/new`、文字 prompt、cancel、permission request 和关闭过程。不能只测
   `--help` 或只测 initialize。
4. **能力 fixture**：对准备打开的每个能力，保存最小的 request / response / update fixture
   与预期失败 fixture。未知 enum、缺字段、乱序 update、重复 done、stdout 杂讯与进程异常
   必须由 adapter 拒绝或确定性收口，不能猜测成功。
5. **供应链与平台**：本轮唯一声明目标是本机 `darwin-arm64`，运行 `--version`、ACP handshake、
   close smoke 和 Desktop Main E2E。Linux、Windows、Intel macOS 与任何远端 runner 都没有构建或
   运行结果，必须保持 unavailable；本机 macOS 结果不得外推为其它平台或发行证据。

上游源码的 `python/sdk-runtime/README.md` 规定自包含可执行、sidecar、非空 `DSH_HOME` 与
`scripts/build-exe-for-python-sdk.ts` 的构建路径；它不替本地 archive/tree 验证，也不自动证明任何
ACP 扩展能力。

---

## 3. 受控运行时与安全边界

### 3.1 运行时分发

- F0 使用 `tools/dsh/source-release.json` 驱动**本机** `darwin-arm64` source build；输入是已审阅的
  source release pin，不是运行时查询到什么就接受什么。它保存 repository、tag、commit、tree、
  lockfile/Cindy pkg-toolchain/build-script digest、固定 Node/pnpm、唯一 target/sidecar。轻量 tag
  没有上游签名时必须明确记录。每次本地构建先验证输入和 SEA archive，再从刚验证 archive 的新解压目录
  运行 smoke/E2E。source input 必须已在本地具备 pin 的 HEAD/tree/tag；缺失时 fail closed，绝不
  `git fetch`、clone 或联系 source remote。禁止 GitHub workflow、上传 archive、attestation 或任何其它平台构建。
- F2 已交付**本机离线 admission 基座**：`tools/dsh/latest.json` 固定唯一 `darwin-arm64`
  archive 的 filename/SHA-256/size、可执行、sidecar 与全 tree manifest；`tools/dsh/update.mjs`
  只导入调用方明确给出的、已经 F0 `verifyReleaseBundle` 验证的本地 archive。它没有 URL、fetch、
  CDN、默认输出目录或 `PATH`/npm/pnpm/pip/curl fallback，且不提交 runtime。Desktop Main 的
  `dsh-host/local-runtime.ts` 在解包前、staging、原子同卷提升后和**每次 spawn 前**都复验 regular-file、
  mode、SHA-256、realpath containment、sidecar 和 marker；任何不一致均为 unavailable。
- 当前不会把 dsh 放进现有 CDN `agent-binaries` 流程：该流程的 manifest/download 模型与本机离线
  pin 不同。待存在经验证、受 containment 约束的本机 product launcher 后，才可新增
  `VendorKey` / `AgentBinaryKind: 'dsh'` 的 optional directory asset；届时仍只能消费上述固定
  local pin，缺失/失败必须只让 dsh unavailable，不能阻塞 Cindy 或回退到系统下载器。
- 受监督 source runtime 的本机基础使用独立的
  `tools/dsh/macos-supervised-source-release.json`（当前定义为
  `cindy-dsh-0.1.2-alpha.3-build.11-macos-supervised`）。它只产出 `darwin-arm64` archive，记录
  source/build/adaptation digest；除 bootstrap addon 的 `requiredNativeAddons` 外，还将最小
  `pkgNativeCache` 整树纳入 archive manifest。构建时从刚 deploy 的 closure 选出实际 Darwin `sharp`、
  `koffi` 与 `node-pty` 文件，按 native module SHA-256 写到 `pkg/<hash>/…`，绝不读取或复制用户 Home cache。
  native supervisor 从已签名 `Contents/Helpers/Cindy DSH Supervisor.app` 自身派生 runtime、bootstrap addon
  cache 与 pkg cache 路径，以固定 argv 和最小环境启动 child，并以 `NARB_NATIVE_CACHE_DIR`、
  `CINDY_DSH_SEALED_NATIVE_CACHE=1` 及 `CINDY_DSH_SEALED_PKG_CACHE_DIR` 拒绝运行时向可写 cache 提取模块。
  `@yao-pkg/pkg` 的 sealed SEA bootstrap 只允许 regular、non-symlink 的 Helper cache entry，缺失即失败。2026-09-05
  的新鲜本机 source rebuild 已生成并验证 archive/manifest（archive SHA-256
  `19d70a9f5346e99fd21680d176c3a4639eb04951fb58e22da8bf8c1a38e99db1`），再由该 archive 打包的 Cindy.app
  signed-Helper E2E 7/7 通过。它是严格限定的本地 F0 source-build 与 package evidence：runtime 仍不能作为普通
  用户目录的可启动二进制，也不是 installer、发布、notarization、跨平台或 production endpoint 的声明。
- 构建只能通过 `pnpm build:dsh:local-macos -- --release <checked-in-release.json> --repo-root <Cindy-root>
  --source-root <already-local-clean-checkout> --node-archive <verified-node-v24.20.0-darwin-arm64.tar.gz>
  --pnpm-tarball <verified-pnpm-11.7.0.tgz> --output-dir <new-local-output>` 进入。它先检查主机、所有绝对
  local input、source tuple、冻结 toolchain、Node SHA-256 与 pnpm SRI，才对 disposable source checkout 应用
  声明的 adaptations。该 checkout 还必须没有任何预装 `node_modules`（包括 symlink）；旧依赖树既不是受信输入，
  也不得让 headless pnpm 进入替换确认。随后用临时 HOME 中的已验证 Node SEA cache、已验证 pnpm CLI 和受控 shim
  PATH（其中只有 Cindy pnpm wrapper、当前 host-verified Node 的 shim，以及仅允许 `npm run` 映射到该 pnpm wrapper 的兼容 shim）完成构建。依赖安装前，已验 pnpm 只可基于已验证的冻结 lockfile，以 `fetch --frozen-lockfile --ignore-scripts` 写入新的私有临时 store；这是受 lockfile integrity
  约束的入站依赖准备，不是远端构建、不会上传、不会执行 install script，且发生在 adaptations 修改 source checkout 前。随后环境级 `npm_config_offline=true` 及 wrapper 在每个依赖物化命令（`install` / `deploy`，包括上游的 `pnpm --filter … deploy`）前注入的 `--offline` 必须覆盖所有后续依赖准备；`pnpm exec` 不支持该 CLI flag，但继承环境级 guard。只有该最初的直接 `fetch` 临时设为 false。install、deploy 和 build 只可使用此私有 store，绝不读取用户 Home cache。上游 deploy 通过 review-bound adaptation 改为 lockfile-bound closure；pnpm 对唯一工作区 `file:` 依赖写入 deployment lockfile 时会将其转换为绝对 file URL，因此 runner 只在 disposable checkout 的 `pnpm-workspace.yaml` 中临时插入由该 checkout realpath 计算出的**唯一** allowBuild entry。该 entry 必须在 source build 的 `finally` 中还原，并再次通过 adaptation postimage 验证；它不得改成包名级、通配或 `dangerouslyAllowAllBuilds` 放行。输出目录必须不存在，避免覆盖旧证据；它不会 Git fetch、clone 或联系 source remote，也不构建非 `darwin-arm64` 目标。任一缺失／不匹配输入都必须在源码修改前失败。
- build.11 不再用 Cindy adaptation 静态关闭 `attachment-local`、`subprocess`、`sandbox`、
  `bash-sandbox`、`permission`、`tool-bash` 或 `tool-fs-search`。这不等于把它们无条件标为已验收：
  只有 native closure、runtime-only library-validation exception、sealed-cache checks 和同一签名
  Helper 的对应功能用例全部通过，某项能力才能在状态/UI 中转正。不得用 fallback、系统全局 runtime、
  可写提取或 Main/Supervisor 的 library-validation 例外绕过该边界。
- staging 在 `Cindy DSH Supervisor.app/Contents/Resources` 写入受签名的
  `cindy-dsh-supervised-runtime.json`。它只是 Main 的 identity/availability record，不是 launcher
  input：记录唯一 target、release/version、父/Helper bundle identity、固定 supervisor/runtime/sidecar
  名称和 sealed addon source/cache 相对路径；native supervisor 不读取它，仍只从自己的 bundle 派生路径。
  `dsh-host/macos-supervised-runtime.ts` 只在 `darwin-arm64` 接受固定
  `Cindy.app/Contents/Helpers/Cindy DSH Supervisor.app` 拓扑，逐项复验两个 `Info.plist` identity、
  regular/non-symlink runtime、sidecar 和 addon cache/source。它唯一可交给 `spawn` 的 binary 是固定
  supervisor；descriptor、Renderer、`userData`、PATH 或调用方均不能选择 runtime 或 argv，Home 只可由
  Main 提供当前用户根后推导 Helper container，绝不可来自 Renderer 或 DSH 请求。
  cindy-managed scope 则位于 Helper 的独立
  `~/Library/Containers/<helper-bundle-id>/Data/dsh-agent-home` 及其专属 temp child，而非 Cindy 主
  `userData`。仅该 Helper container 和其 temp child 可由 factory 创建；不存在的 `Library/Containers`
  层级一律 fail closed，防止把用户 Home 当成 DSH staging 根。`dsh-agent-home`、scope、process Home 和
  managed DSH Home 必须逐级以 direct real directory 创建，拒绝预存 symlink；每次 spawn 前还须对所有
  launcher/Home/temp 路径做 `realpath` containment 复核，不能以字符串前缀代替。
- factory 是 F2 的 Main-owned、显式调用能力，仍未从 agent catalog、IPC、Renderer、remote 或 Mobile
  注册。它在交给泛型 `DshHostManager` 前启动具体 `DshAcpClient` transport；其 generic client port 不
  获得 `start()`，所以其它 F0/F3 bridge path 的启动序列不变。请求 `releaseId` 必须与 factory 刚验证
  的 runtime release 一致，避免过期请求占用不同 release 的 scope。
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
- MVP 使用上游固定 `--profile acp` 的最小、版本化组合。`acp` 会在首次启动时自行创建
  `profiles/acp` 模板，故 Cindy 不得把策略写进该会被模板重建的目录；唯一受 Cindy 管理的
  policy layer 是 `$DSH_HOME/cordis.patch.yml`，它在公开 profile composition 中晚于 profile
  patch 加载，且只由 native supervisor 的固定 `--profile acp` 使用。不得读取、合并或运行用户
  profile / plugin，不允许 `dsh plugin`、外部 bundle、profile live reload 或用户可写的 module
  resolution。每次 spawn 均原子重写该 Home-level patch；不得在并发 session 间改写共享 scope。
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

**F4 本地基础状态**：未注册 Main bridge 在 transport 启动前安装
`session/request_permission` handler。每个活跃 binding 只有持有同一 Main-issued
`bridgeSessionKey` 的 adapter 才能绑定 resolver；缺绑定、错误/过期 capability、未知/重复/已清理的
`toolCallId`、超时、EOF、关闭、投影失败和选项不匹配一律返回
`{ outcome: { outcome: 'cancelled' } }`。运行时可在 `tool_call` update 后立即请求授权，因此 handler
只等待该 binding 已排队的 durable projection tail 在总超时内完成；它绝不从未提交 raw event
生成审批上下文。`DshAgent` 只把已脱敏的 opaque `toolUseId`、工具名和 record-shaped input 交给 Cindy
既有 interaction resolver，并把 `allow` / 其余结果严格收窄为 `allow-once` / `reject-once`，忽略
`updatedInput` 与持久 `permissionUpdates`。历史未封装 `darwin-arm64` 的 loopback fixture 曾在
显式 `DSH_PERMISSION_MODE=read-only` 下证明 `reject-once`；当前 build.11 的**同一签名 Helper**
fixture 则已证明真实 ACP request 经该链路到达 generic interaction listener、返回 `allow-once`，并在
test-only Helper container workspace 完成一个无写入 `bash` 命令。fixture 同时证明 provider key/base URL
不进入该 tool 子进程。

这不等于开放持久或无限制权限：每次 request 仍只能 allow-once/reject-once，任务 close/EOF 会撤销
resolver 和 pending tool mapping；现有 Main 条件注册只在 current owner、唯一 DSH configuration、封装
Helper、bookmark admission 与 binding/receipt/journal 都有效时启用 DSH。真实用户项目目录需要 picker 取得
task-scoped fd 4 bookmark；文件搜索、附件/图像、拒绝/超时/重复回包、并发/取消、scheduler、remote 和 Mobile
仍未获得本机产品验收，状态/UI 不得把它们显示为已完成。

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

- MVP 不装载任何 MCP endpoint：无 Main lease 时，create 保持空 `mcpServers` declaration，resume
  保持旧 wire shape 而不加该字段。§1.4-1 显示 pin tag 的 `initialize` advertise
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
- **F7 已交付的窄底座（仍非产品 MCP）**：`internal-mcp-lease.ts` 只接收静态的 Main
  endpoint factory；它不依赖 Electron、IPC、配置或持久化，也不存在默认或用户可配置 endpoint。
  每个 `create` / `resume` 先以新的 Cindy session-instance id acquire 租约，再把一次性的
  `http` declaration 直接附到同一 ACP 请求。factory 只接受精确 `127.0.0.1` / `[::1]` 的带端口
  loopback HTTP + 非根 path prefix，或精确静态 HTTPS origin + path prefix；拒绝 `localhost`、无端口、
  root prefix、query / fragment / userinfo、越界路径和 origin 漂移。token 是每个 endpoint / lease
  新生成的内存 bearer 值，只进入该 ACP header；注册失败反向回滚，session close、create/resume
  失败和 carrier EOF/exit 均释放已取得租约。factory 提供 `revokeAll()` 给宿主 teardown，当前
  control plane 已在 carrier close 调用它；以后 account switch、Home reset 或配置撤销接入真实
  factory 时也必须先调用它。没有 production endpoint factory、Renderer 配置、普通存储、SSH /
  device-link 转发或 user-native MCP 设置，因此 `CapabilityStatus` 仍为 `not-implemented`。
- per-session 进程的 close / abort / account sweep 必须幂等且有界：先停止 prompt，再关 ACP，
  再 TERM / 有界 KILL，并只在确认退出后清理材料。POSIX 必须让 runtime 自成进程组、向整组
  发信号，不能只杀 direct child 留下继承凭证或文件句柄的孙进程；但进程组**不能**阻止后代
  `setsid` / double-fork 逃逸，不能伪称为 OS 级 containment。F0 只把它作为未注册 bridge 的
  普通后代清理证据；F2 开通任一产品 launch 前，Linux 必须有受监督 launcher / delegated cgroup
  等可证明 containment，macOS 必须有等价的受监督原生方案，Windows 则必须有启动时的
  identity-bound Job Object 或等价机制。不得用可复用裸 PID 的 `taskkill` 把“尽力而为”伪装成
  已确认清理。启动半途失败也必须纳入同一收口；不能因进程已不可观察就把会话写成可恢复或已
  安全退出。

---

## 4. ACP Basic 施工阶段

### Gate A：先建立 Cindy Bridge 证据，再写产品路径

完成第 2 节 release evidence packet、无 key real-loader subprocess 测试、Cindy bridge 的
create/list/resume（若 advertise）/prompt/cancel/close/EOF/exit lifecycle 和本节的 profile /环境
安全测试。若实际 ACP 能力比保守基线更少，MVP 继续收缩；若更多，也必须按第 5 节逐项开放，
不能在一个 PR 顺手打开。runtime 缺少另一套 Host API 不构成阻塞。

### 阶段 0：类型收敛（F1 已交付，仍不可执行）

把 inline union 收敛到 `packages/maker-core/src/types/common.ts` 的 `AgentKind` 及
`apps/desktop/src/shared/agentKindConversion.ts` 的 `MakerAgentKindWire` / `DbAgentKind`。
`dsh` 在两侧同名，不引入缩写映射。

- 先产出全仓 inventory：联合类型、二元 ternary、switch default、数据库 JSON decoder、
  scheduler、Orca、search、renderer state、mobile projection、IPC / device-link payload。
  不以“含 pi 的文件数”代替实际调用点清单。
- conversion module 是唯一双向映射。历史的 `null` / `cc` 兼容可保留；新的 dsh 输入、未知
  值与二元 fallback 必须逐一审计，不能把 dsh 或非法值默默归为 Claude Code。
- 交付记录：`AgentKind`、事件 source、Desktop DB/IPC 转换与展示都识别 `dsh`；`null`/缺失仍是
  唯一可落入历史 `cc` 的输入，显式未知值抛错。New Maker 和 model-provider 仍只允许已注册的
  三种运行时，DSH 不获得隐式模型或 UI 选择项。
- 本阶段没有新增二进制、runtime 注册、SQLite migration 或可执行产品 UI；证据与定向测试见
  [`dsh-f1-local-identity-closure-report.md`](../dsh-release-evidence/dsh-f1-local-identity-closure-report.md)。

### 阶段 1：AgentKind、DB 与受管二进制（拆分；身份部分已完成）

- `AgentKind`、model-provider、scheduler、MCP / remote 相关声明按 inventory 增 `'dsh'`。
  `sessions.agent_kind` 等无 SQLite CHECK 的字段、以及 schema 中 four 处类型 enum 都逐项核对。
  Drizzle SQLite enum 是类型提示而非 DDL 约束，因此“无需 migration”只能在确认没有数据迁移、
  CHECK、companion、历史 parser 或跨端 validator 后成立；结论须运行
  `db:validate` 和 `test:migration-replay` 证明，不能修改历史 migration。
- F1 已完成前一项的本机 Desktop identity/decoder/explicit-unavailable 分支；没有修改 migration，
  因现有 `agent_kind` 是无 CHECK 的 SQLite text 字段。未触及 Mobile、SSH 或远端构建。
- F2 的本地 macOS foundation 已实现第 3.1 节受管二进制链、可选启动准备与 platform downgrade，
  且 F5a 仅在固定的 `darwin-arm64` signed Helper.app、当前 owner 的唯一 DSH provider、binding/receipt/journal
  均可用时动态注册产品 agent。`getReadyBinaryPath('dsh')` 只能返回本次 prepare 成功验证的路径；不回落用户安装、
  旧缓存或未经本轮验收的目录。未支持平台、无配置或 Main revalidation 失败时保持未注册。
- F2 已新增 binary distribution、Cindy source-build provenance / archive extraction / manifest、unsupported platform、
  CDN failure 和 sidecar 缺失测试；同步 lockfile、第三方 notices 与依赖方向检查。缺少本地 pin/tag/tree
  证据时必须失败，不能 fetch、clone 或联系远端补齐。
- 本机 macOS F2 package evidence 只能通过
  `pnpm --filter desktop package:dsh:local-macos --archive <local-build.9.tar.gz> --manifest <local-build.9.json>`
  执行：它固定本机 `darwin-arm64`、只接收 direct regular local inputs、禁止下载并复用已验证的本地
  ripgrep，跳过 remote-agent bundles 与 iOS preparation。它把独立签名的 DSH Helper 写入 Cindy 自己的
  App bundle，再由内到外重签普通 Electron code，**不得**以 `--deep --sign` 覆盖 DSH Helper 的
  sandbox/network entitlement；随后必须对该已打包 App 运行 signed-Helper E2E。该命令是本地 ad-hoc
  证据，绝不是 installer、notarization、upload、attestation、normal package 或跨平台 release 的授权。

### 阶段 2：最小 `DshAgent`（`packages/maker-core/src/agents/dsh/`）

| 文件 | MVP 职责 |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `acp-client.ts` | 受控 stdio transport、结构校验、连接 / request timeout、脱敏且有界的 stderr、EOF / exit 收口；stdout 非协议内容立即失败。 |
| `translator.ts` | 仅把已验收的 committed text、permission request、cancel / terminal status 映射为已有 `AgentEvent`；未知 update 不伪造 tool / thinking / usage。 |
| `profile-assembly.ts` | 从随包、版本化模板物化不可变 Cindy-owned profile snapshot；无 user profile、无 live reload、无 system prompt 追加。 |
| `index.ts` | `DshAgent extends BaseAgent`：只消费 Main 预建立的 `DshBridgePort`，在 admission 已证明 committed projection 与 durable receipt ledger 后创建本地文本 session，执行 prompt / cancel / close；将 Cindy 的通用 `allow` / `deny` interaction 决策收窄为 DSH 单次 `allow-once` / `reject-once`，不接受持久 permission update。F5c 只允许同一 Cindy task 的既有 opaque handle 经 Main rehydrated binding 继续，adapter 仍不接收 native session id。不实现 spawn、通用 resume、setModel、setEffort、MCP 或 multimodal，直到对应 gate 通过。 |

`DshAgent` 的 export 本身不等于产品注册：只有 F5a 的 Desktop Main registrar 在受监督 Helper、当前 owner、
唯一 provider、启动时 key 与 handshake 后 revalidation 都成功后，才能动态加入 `Maker` 并通过通用本地
create transaction。F5b 的例外仅是 Main roster 已确认后、本机 New Maker 的受管文本入口及其创建后
同一任务 composer 的文本边界：它固定使用 opaque runtime marker，不提供模型、来源、权限或附件选择，
且 Main 必须再次拒绝不匹配的 marker 或 renderer-selected provider。它不得给 Mobile、scheduler、SSH remote
或任意 generic provider API 直接启动入口。
本机 macOS New Maker 可以在 roster 尚未就绪时保留一个明确标为“未就绪”的 DeepSeek 设置／恢复入口，
但该行不得改写草稿为 DSH，也不得触发 create transaction；它只能调用 Main-owned registration retry，
成功后按 roster 进入上述文本入口，失败则定位到对应 provider 设置。Windows、Linux、SSH remote 与
device-link 目标不显示这个本机入口。
所有进程、runtime id、credential、Home 和持久化仍只允许 Desktop Main 的
`DshControlPlane` / bridge 持有。adapter 只能回传同一 bridge 的 ephemeral capability key，不能伪造另一
Cindy session、scope 或 native id。F5c 仅在 fresh bridge 用同一 scope 的 settled durable binding 和 ACP
`session/list` rehydrate 后，允许该 task 的既有 opaque handle 经一次 cwd admission 调用 native resume；
pending / uncertain receipt、identity mismatch、缺失 binding 或 foreign handle 一律拒绝。history/reconcile、
cross-device resume 与 UI evidence 尚未完成，完整产品能力仍保持 unavailable。

每个 `session/new.cwd` 必须为绝对路径、经现有工作目录授权路径验证。dsh 的 launcher cwd 与
session cwd 分离，前者永远不是用户项目。启动返回的原生 session id 要长度 / 控制字符校验，
但在恢复证据通过前不得写入 Cindy 的 resume identity。

`DshControlPlane` 构造必须由 Main 注入 `assertAuthorizedCwd`；它先拒绝非绝对路径，再对 create
和 resume 的 `cwd` + Cindy session id 调用该策略。F5a 的 create transaction 先用既有 Main validator
realpath 并为该 session 发放一次性 cwd admission，control plane 在 native `session/new` 前消费精确 pair。
不得给 bridge “绝对路径即已授权”的默认实现，也不得由 Renderer、Mobile 或 runtime 自己决定工作目录授权。

Main 关闭 ACP child 的固定顺序是 stdin EOF → 有界 `SIGTERM` → 有界 `SIGKILL` → **有界失败**；即使
runtime 忽略 TERM 或 KILL 后迟迟没有 exit 确认，关闭 promise 也不得无限悬挂，更不得把未确认的
进程写成已回收。前者用一个明确忽略 TERM 的本地子进程夹具自动验证，后者用不发 close 事件的 fake
child 回归测试验证。F0 的 POSIX transport 已用独立进程组覆盖普通 direct-child 之外的后代，并
额外验证“root 先 exit、同组 descendant 仍活着”时继续 TERM/KILL；它**不**覆盖 `setsid` / double-fork
逃逸，故不是产品 containment 证明。Windows 在具备 launch-time、identity-bound 的整树 containment
之前**拒绝启动**；F2 也不得把当前 POSIX process-group 证据当作 Linux/macOS product launch 放行。
Linux runner 仍须以真实 runtime 得到 close smoke，macOS 证据不能替代它；Windows 则在 F2
identity-bound containment 到位后才可首次执行同一类 smoke，之前的 archive-only 证明不得计作 runtime
准入证据。F2 的 `DshHostManager` 已实现 Main-only scope key、managed Home、non-project launcher cwd、
allowlist child env、lazy single-flight handshake、startup/account-switch/quit cleanup 与 capability snapshot；
它**没有默认 spawn**，必须由 macOS launch-time containment adapter 注入 `DshAcpSessionClient`。现有
process-group transport 仍只可作 F0 evidence。用户 existing DSH Home 的 F7 基础已在 2026-09-05 获明确
授权：Main-owned `existing-home-settings.ts` 按 account hash 保存 mode 与随机加密 bookmark reference，bookmark
bytes 单独用 Electron safeStorage 加密；默认读不建目录、不探测 secure storage，reset 只删除 Cindy 自有引用。
原生 picker adapter 只请求一个 `openDirectory` + `securityScopedBookmarks` 结果，绝不返回或持久化 path。F7 当前已接入
本机 macOS General Settings 的 Main-only 三条固定用途 IPC（读状态、显式选择、恢复 Cindy-managed）；Renderer 不传 account、
path 或 bookmark，只能拿到 `default` / `configured` / `unavailable` 投影。每次 picker 等待返回后均复核 Main account generation，
账户变化则拒绝结果；device-link / Mobile allowlist 明确不含这些通道。该 UI 明确说明选择在 Cindy 重启后才生效，且既有 Home 的原生 profile / extension 可能运行；恢复 Cindy-managed Home 同样在重启后生效。
generic `DshHostScopeInput` 已移除并运行期拒绝旧的 `existingDshHome` raw path。macOS sandbox child 不继承 Main 的 dynamic user-selection grant；而 Apple app-scoped bookmark 又绑定创建者
的 code-signing identity，Cindy Main 与独立 `Cindy DSH Supervisor.app` 的 identity 不同。因此不得把 Main 持久化的
app-scoped bookmark 直接交给 Helper。唯一允许的路径分两步：Main 内、同 Cindy identity 的 native bridge 解析
持久 bookmark 并生成一次性、非持久的 implicit URL bookmark；Main 再通过专用 private descriptor 把**后者**只交给
固定 Helper 一次。Helper 解析并对固定 child 的生命周期显式 start/stop，不得把任一 bookmark 或 raw path 放进 argv、
env、普通 IPC、SQLite、诊断、activity、Mobile payload，亦不得接受通用命令。只有该 two-stage handoff 已在 Main 内
完成时 `existing-dsh-home` 才能进入 fixed-Helper 启动路径；其余输入一律拒绝，也绝不读取/合并原生 profile 或 plugin。

**本机试用包的签名边界**：当前 Cindy desktop 的既有 `userData` 位于非 sandbox 的
`~/Library/Application Support/CindyGlobal`。因此 `package:dsh:local-macos` 的 Main 与普通 Cindy
保持同一非 App Sandbox entitlement；将 Main 签为 App Sandbox 会在启动初期拒绝日志和 migration-lock
访问，不能作为 Existing Home 的临时实现。独立 `Cindy DSH Supervisor.app` 仍须保持其窄的
`app-sandbox + network-client` entitlement。本机试用包不宣称 Existing Home 书签链路可用；恢复该能力
必须先设计与既有 profile 兼容的 Main identity／数据位置迁移，并重新完成真实 picker 的 signed-package E2E，
不得用放宽 Helper entitlement 或静默 raw-path fallback 绕过。

该 two-stage primitive 已接入 production bridge：Main 内的签名 N-API resource 只将持久 app-scoped bookmark 转成一次性
implicit bookmark；Main 在启动前读取当前 selection，并只把新的 handoff 交给 fixed Helper。Helper 只从 private fd 3
读取“length + canonical base64 + EOF”，并拒绝路径、环境 `DSH_HOME`、额外字节和非固定 ACP argv。Main resource 及
Helper 均已在本地签名包验证，Helper 权限收敛为 App Sandbox + network-client。真实 picker 的
resolve/transfer/start/stop/reset/restart 仍须由用户按专用 signed-package 手册完成；在该人工证据返回前，F7 不能解除
更宽的 capability gate 或被描述为已验收。

macOS 的 `sandbox-exec` 不能被当作该 adapter：本机无网络实验中，shell 直接启动同一受限 DSH
`--version` 可退出成功，但 Node/Desktop Main `spawn()` 启动同一 profile 与已校验 runtime 会在 ACP 前
`SIGABRT`（attached 与 detached 均然）。该结果不允许用普通 POSIX process group 冒充 containment。
后续的临时签名 App Sandbox 测试证明了另一条受限路径：runtime 和唯一 bootstrap addon cache 均在 bundle
内签名，runtime/sidecar 继承 sandbox 并有 JIT entitlement，supervisor 自身固定 bundle 资源、argv 与环境；
通过 supervisor 在其专属 Helper.app container 中可完成 `--version` 与无凭证 ACP lifecycle，直接启动 runtime
仍预期 `SIGABRT`。F5a 已使用同一固定 Helper 路径完成 Main-only 动态 registration、真实产品 create
transaction 与 Maker shutdown/account-boundary 回收；F5b 只在该 registration 可用时投影一个本机、文本专用
New Maker 入口，并让创建后的同一任务 composer 保持相同边界。F5c 的 signed-Helper E2E 额外证明：关闭第一
个 Main bridge 后，第二个 fresh bridge 可用同一受管 Home 的 settled binding 恢复同一 Cindy task 并完成一轮；
adapter 从不接收 native id。F6-1 进一步将 Main 已确认的 create / close / verified resume 和 fresh-bridge / EOF
状态投影为一个 `cindy-dsh` session root：后两者一律 observe-only，只有 verified resume 可恢复为 running。F6-2 在该 root
下新增 Cindy 自有、仅本机的 plan/todo 子树与主界面 panel；它只允许 read/create-plan/create-todo/complete/cancel 五个
已测试动作，全部经 Main 重验当前 DSH 任务和 binding scope，且不接收/返回 native id、ACP payload、endpoint 或 secret。它
在 binding 非 active、session root 非 running，或当前 Main carrier 已同步撤销写 admission 时把所有本地子对象收窄为 observe-only，并拒绝修改，直到 Main 已验证恢复。carrier EOF 必须先撤销 admission、后异步投影 durable disconnect，不能让 SQLite 延迟窗口接受本地写入。它
的 signed-Helper 本机 E2E 必须从实际绑定任务创建、完成和取消 Cindy plan/todo、验证 SQLite/view 不含 native id，并在 public close 后拒绝全部本地写入；这只证明 Helper→Main contract，不等同浏览器驱动 panel。它不是上游 plan/todo UI，也不形成 approval、terminal、remote、device-link 或完整 Renderer recovery experience。未关闭的缺口继续
限制对应功能，不能外推成完整 DSH。
当前 Helper 已在本次明确授权下获得 `com.apple.security.network.client`，因为 macOS 将连接同机 server
也视为 outgoing client connection。该 entitlement 不提供 destination filter；受限网络 adapter / endpoint
enforcement 已由 Main-owned route capability、精确 origin allowlist、固定无秘密 profile 与 native 环境
allowlist 共同实现。真实签名 App 的严格 loopback prompt E2E 在 canonical-base 修复后通过 exact
`/chat/completions` contract：first prompt 的 text/usage 只有 journal commit 后可见，second prompt 经 public
cancel 结束，两个 durable receipts 都确认，且 safe records 不含 native id 或 fixture key。生产 endpoint 仍须由
Main policy 明确提供，且这不证明 App Sandbox 可过滤其它 destination；本机 loopback evidence 也不开放产品能力。
本次授权曾为**单独签名的 Helper.app**暂加
`com.apple.security.files.user-selected.read-write` 与
`com.apple.security.files.bookmarks.app-scope`。随后核对 Apple 的 identity 约束发现：这两项不能让不同 identity 的
Helper 解析 Cindy Main 创建的 app-scoped bookmark，保留它们反而扩大了 Helper 权限却不能完成 handoff。实现
two-stage implicit-bookmark path 时必须从 Helper 移除这两项，并在 staging/local package 证明最小 entitlement set；
runtime child 仍只使用 sandbox inheritance entitlement，不能扩大自身权限。生产 Main bridge 在启动时读取当前 account selection：受管模式绝不创建书签；已有 Home 模式只在 Main 内把持久书签转换为新 implicit bookmark，再经 fd 3 交给固定 Helper，child env 不得带 `DSH_HOME`。Helper 启动后的每个新操作都会重读并比对选择摘要，选择被替换或 reset 后 fail closed。**F7 仍未完成**：解除该窄执行路径的最终证据必须是已签名本地包、真实 picker fixture、Main→fd 3→Helper 解析/释放及 reset/restart lifecycle 的 E2E；仅 Node fixture、打包 Helper E2E 或签名检查不能替代该证据。实际人工验收只能按
[`dsh-existing-home-packaged-e2e-test-manual.md`](dsh-existing-home-packaged-e2e-test-manual.md)
在临时空目录与隔离 user-data 上执行；不得用真实 DSH Home 或正式 Cindy profile 代替 fixture。
也不得把 `sandbox_init()` 当作 entitlement 之后的二次网络收束：本机 macOS SDK 明确它在进程已经处于
App Sandbox 时被忽略并返回错误，且该 API 已废弃；既有 `sandbox-exec` 直接启动 DSH 的 ACP 前 `SIGABRT`
负证据同样不能被重新包装成可用 adapter。没有可证明的受限网络路径时，保留 no-network Helper 并让 prompt
能力 unavailable，优先于启用无法证明 endpoint 边界的运行时。

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

---

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
|---------------------------------------------------------------------------------------------------------------------|---------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| text prompt / committed final text | 候选 enabled | 不把最终文本伪装成 token delta。 |
| abort | 候选 enabled | `session/cancel` 确认成功且 terminal 收口可测后开放。 |
| 逐工具一次性审批（`ask`） | 候选 enabled | `toolCallId` 关联失败即拒绝；拒绝 / 超时 / 断线 fail closed。见 §3.4 |
| tool 生命周期、thinking、usage | **候选**（F4 局部 translator 已交付，协议见 §1.4-2） | 当前仅有不接产品流的纯函数映射：严格 envelope／id／文本／结构边界、敏感文本／字段值脱敏、未知或不完整 update 不产出半个事件。转正仍须真实 binary fixture 覆盖乱序、重复 terminal、未知字段、断线和持久 sequence 投影。**不得**从 durable log / stderr 补造事件 |
| model / effort 切换 | **候选**（协议已证实，§1.4-1） | `session/set_config_option` 存在。转正条件：真轮次证明 route 生效 + BYOM 解析失败 fail closed |
| image | **候选**（条件性，§1.4-1） | `promptCapabilities.image` 由服务端按 provider/model 动态决定，**必须现读握手结果**，不得静态假定。file / resource link 另算 |
| list / resume / close | **候选**（协议已证实，§1.4-1） | `sessionCapabilities` 声明支持。开放仍须过 §5 的恢复 gate |
| MCP（stdio / Streamable HTTP） | Cindy 侧未就绪（F7 Main-only lease foundation 已验证） | 协议支持（`mcpCapabilities.http`）；固定 endpoint 的 token / URL / lease 边界已由本机测试和 signed-Helper E2E 覆盖，但没有产品 endpoint factory、用户配置、跨端契约或可见能力，故仍为 `not-implemented`。见 §3.4 |
| `session/load`、fork、additional directories、SSE / ACP-transport MCP、modes、commands、plans、terminals、elicitation | **上游不支持**（`sdk-missing`，§1.4-4） | 需推翻上游契约才可能改变 |
| rewind / session tree / compact / export HTML | 上游不支持 | 无对应 ACP 面 |
| same-turn steer | 上游不支持 | 每 session 只允许一个 in-flight prompt |
| `setPermissionModeMidSession` | **上游不支持** | preset 不是 config option，档位只能建会话时固定，见 §3.4 |
| `auto` / `bypassPermissions`、scheduler 无人值守 | 候选，未验证前禁用 | `bypassPermissions` 只能是「每次自动 allow-once」，不是持久授权 |
| OS 级 sandbox 保护 | 候选，**不得对用户宣称** | dsh 自带 sandbox 插件，受管 profile 下的实际生效范围未验证 |

**恢复 gate**：F3 可在 ACP `new` 已确认后持久化不透明 runtime session id，**但它仅是
owner-scoped reconcile key，不是获准自动 resume 的产品身份**。只有在进程 A 创建会话并成功
完成一轮、关闭 / 异常退出、进程 B 用同一受控 home 恢复、再完成一轮且历史、权限、模型、并发
独占、损坏日志和 cleanup 都符合预期后，才可把它升级为对用户开放的 durable resume identity。
失败、缺文件或不确定时新建 Cindy 会话 / 明示不可恢复，绝不把旧 session id 指向新鲜原生会话。

---

## 6. ACP Basic 风险、跨端与发布

| 风险 | 处置 |
|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| alpha / ACP 破坏性变更 | 每次 pin 升级重跑第 2 节 evidence packet 与完整 real-binary integration；握手不兼容即本次不注册。 |
| 运行时供应链 / sidecar 丢失 | source tag→commit→tree/lockfile/build-script + 本地 archive hash + extracted-tree manifest 验证；绝不使用系统 / 用户 runtime fallback。当前证据不作 release provenance 声明。 |
| profile 是可执行配置 | Cindy-owned、不可变、无用户 plugin / patch / live reload；profile / launcher cwd 与工作目录隔离。 |
| 凭证或工作区 `.env` 泄露 | Main 安全 store + 最小 env 白名单 + 非项目 launcher cwd；无 argv / file / log secret；账户边界清理。 |
| 约 70–78 MB 的 runtime payload + per-session 进程 | 前者是单份受管下载 / 磁盘体积，不得误报成每会话重复下载；后者的实际内存和启动成本必须在 process monitor、资源上限、终止确认和启动 / 退出压测中测量。**per-session 是 Cindy 的产品选择，不是协议限制** —— ACP 单连接本就支持多 session 并发（§1.4），选 per-session 是为了对齐 CC / Codex / Pi 的 teardown 与账号边界语义。“单连接多 session”将来是独立生命周期设计，不是优化补丁。 |
| MCP 或权限扩权 | 默认关闭；需要单独 threat review，不能因为上游后来接受字段就自动开放。 |
| 远程 / mobile 不一致 | MVP 明确拒绝 SSH remote；device-link / mobile 走已验证的兼容投影，否则隐藏。任何 wire 改动需要服务端协同。 |
| 区域和端点 | 若 dsh runtime、CDN manifest、provider 默认或 UI 出现 `cn` / `global` 分支，先遵守 [`../product-rules/region-and-editions.md`](../product-rules/region-and-editions.md)：无明确区域的默认是 global，且不能让用户在应用中选择发行版本。 |

---

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

---

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
|-------------------------------|----------------------------------------------------------------|------------------------------------------------------------------------------------|------------------------------------------------------------------|
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
|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
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
- `session/prompt` 的终止 receipt 必须先等待 wire 上更早的 notification queue，再等这些通知形成的
  projection tail 全部持久化并投递，之后才能越过 adapter 边界。`usage_update` 只更新用量快照，
  仅在当前 prompt 尚未终止时可投递 running 状态；它不独立拥有 turn 生命周期。空闲期或终止后的
  迟到用量不得把任务重新置为 running，终态只能由已确认的 prompt receipt 收口。
- 活跃 ACP session 的 prompt 不因 Cindy 一段时间未收到 `session/update` 而结束、关闭 carrier 或
  标为 `uncertain`：前台工具执行和 `session/request_permission` 的一次性决策都可能合法静默。
  无进展阈值只能记录脱敏诊断；只有 native terminal receipt、用户显式取消、carrier EOF/exit 或
  其他已确认的 native 失败才能改变 receipt / binding 生命周期。非 prompt operation timeout 继续
  关闭 carrier 并进入 reconcile，且任何不确定 prompt 一律不重发。
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
|---------------------------|----------------------------------------------------------------------------------------------|
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
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **F0：Cindy Bridge Gate** | 形成 release evidence packet、ACP compatibility fixture 与 Cindy bridge lifecycle contract | 受管 runtime、ACP v1 capability snapshot、Cindy `DshBridgePort` 命令/receipt/operation-timeout/EOF/exit 行为、许可 / notices、平台矩阵 | 同一制品证明 Cindy 通过公开 ACP 可创建、恢复（若 advertise）、follow/update、prompt、cancel、close；非 prompt timeout、carrier EOF/exit 关闭 carrier、标记 reconcile 且绝不重发；活跃 prompt 的静默仅记录诊断并继续等待 native terminal receipt；不支持项诚实 capability-gate，而不是等待上游 Host |
| **F1：身份闭包** | `dsh` 成为第四个 AgentKind，且无 silent fallback | maker-core / Desktop / Mobile / device-link / model catalog / scheduler / search / DB decoder / remote type 的全量 inventory 和 exhaustive tests | 任意 dsh 输入从 DB、IPC、URL、mobile payload 到 UI 均保持 dsh；未知值显式拒绝，不归为 `cc` |
| **F2：受管 runtime 与 Host supervisor** | DSH binary distribution、Host scope registry、健康和有界清理 | `agent-binaries`、`tools/dsh`、Desktop Main `dsh-host/`、safe storage adapter、process monitor | hash / sidecar / platform / account switch / crash / stale endpoint / quit 通过；Renderer 无新增特权 |
| **F3：Cindy bridge 与 binding（局部交付）** | 已交付 Main-only durable owner binding、CAS lifecycle/cursor、live follow 的 display-safe projection journal、no-replay prompt receipt ledger、receipt-guarded restart rehydrate、只订阅 committed-safe events 的 `DshAgent`，以及 Helper.app binding / real-binary follow→SQLite E2E；受监督 bridge 强制组合 binding、receipt、journal 三个 Main-owned store，才提供 adapter admission | append-only migration、Main bridge client、binding store、receipt ledger、worker journal transaction、per-owner projection queue 与 bridge-injected adapter；F5c 仅在 fixed Helper、fresh list、settled ledger 和同一 Cindy opaque handle 都通过时，从 Main 恢复 inactive binding 并 native resume；仍缺 history synchronizer 与完整恢复产品面 | 未达标：多会话真实隔离、history gap 补齐、uncertain receipt 的 verified-history 收口与无 raw-log scraping 均仍为后续 gate |
| **F4：通用 Agent 事件和交互（局部交付）** | 已交付有限 translator、live durable projection、只向 adapter 给 committed-safe `AgentEvent` 的 bridge port，以及 capability-bound、默认拒绝的一次性 permission resolver；未封装 runtime 已实测 generic deny → `reject-once`，签名包仍禁用工具/请求。F5a 只允许本机文本 create/prompt/cancel/close，未形成 tool approval 或高级产品 interaction | maker-core `agents/dsh/translator.ts` / `DshAgent`、Main `DshControlPlane` 的 committed port 与已提交 tool correlation；仍缺完整 capability adapter、持久 usage accounting 与 interaction UI | 未达标：真实 event fixture 覆盖乱序、重复、缺字段、history recovery、cancel / EOF；性能和准确性指标有实测，且任何能力转正均须在此后 |
| **F5：Desktop 核心体验（进行中）** | F5a 已交付 Main registration、通用本地 create transaction、verified cwd admission、owner/provider/key revalidation 与 Maker shutdown teardown。F5b 仅交付 Main roster 确认后的本机 New Maker 受管文本入口、固定 runtime 标记及创建后同一任务的文本 composer 边界。F5c 已交付同一 Cindy task 的 Main-only narrow resume：fresh bridge 只从 settled durable binding rehydrate，opaque handle 与 cwd admission 通过后才 native resume；真实 fixed-Helper 双 bridge E2E 已通过。F5d/F5e 新增每个 live 本机任务的 model / effort 窄配置投影与 UI：Renderer 只有 Main-issued one-session choice capability 与已校验 label，Main 串行化配置、prompt、cancel、close，并在不确定回包时关闭 carrier。它不持久化、不走 device-link、不复用通用 provider/model selector，且尚无真实 provider 的“不同模型实际生效”证据。附件、会话历史同步、tool approval、完整状态与 recovery UI 仍未交付 | maker IPC、preload、renderer session / selector、i18n、Light / Dark | 真实本地 DSH 任务从创建到恢复完成；用户能看懂 capability、执行位置和失败恢复 |
| **F6：Cindy DSH activity 控制面** | plan/todo、commands、terminal、task/job/workflow/schedule activity panels | versioned `cindy-dsh` activity schema、panel reducer、terminal ownership / signal、job lifecycle | F6-0 有闭合 reducer 与 Main-only durable snapshot store（canonical JSON/digest/scope+sequence CAS）；F6-1 已把唯一 Cindy-owned `session` root 接到 acknowledged create/close、verified resume、fresh-bridge/EOF observe-only 生命周期，并由本机 signed-Helper E2E 覆盖；F6-2 已交付只在本机 DSH 任务内可见的 Cindy-owned plan/todo panel 与 read/create-plan/create-todo/complete/cancel 五个闭合 IPC，所有 label 都是 Cindy 本地创建且不进 ACP。signed-Helper E2E 已实际执行 Main activity controller 的 plan/todo 创建/完成/取消、SQLite/view native-id redaction 和 public close 后写入撤销；不是 browser panel E2E。binding 非 active、root 非 running，或当前 Main carrier 已同步撤销 local-write admission 时，Main 向 Renderer 投影所有本地子对象为 observe-only 并拒绝 mutation，直到 verified resume；EOF 撤销先于 durable disconnect 投影。尚未有 native plan/todo、approval、terminal、job/workflow/schedule、remote 或 device-link object/action source，故 F6 未完成。每类实际交付的 Cindy-owned object 才能有 identity、观察、控制、取消和 disconnect 语义；不会伪称为 DSH native object 或混入 Orca |
| **F7：MCP、skills、profiles 与 extensions** | 已交付 Main-only existing-Home protected bookmark store、native macOS settings projection/selection/reset、Helper narrow entitlement、private implicit-bookmark primitive 与 production bridge handoff：重启后的注册路径以当前 account selection 决定模式，已有 Home 不传路径或 `DSH_HOME`，仅经 fd 3 one-shot bookmark 启动；选择变化会拒绝新操作。另已交付无默认 endpoint 的 internal-MCP factory / per-session lease。后者在 native `new` / `resume` 前注册 exact loopback fixture，传递内存 bearer token，并在 close / failure / carrier close 收口 | 真实 user-selected signed-package lifecycle 证据；受审的 production endpoint factory、运行中切换的显式 lifecycle 收口；用户 native MCP、plugin / profile / extension lifecycle | 真实 user-selected fixture 的 signed-package handoff lifecycle；固定 internal MCP 的 signed-package create / resume / tool-discovery / close 证据；用户显式 native 操作可安装、更新、启停、恢复；secret 不泄露，内部 MCP 不越权 |
| **F8：SSH remote** | 远端 DSH Host 和完整远端任务连续性 | remote installer、home、forward、remote file / attachment / MCP / terminal adapters | 远端 create/resume/approval/terminal/reconnect 均在远端执行；本地和远端隔离、无 credential / path 串线 |
| **F9：device-link 与 Mobile** | 被控端投影与移动控制面 | protocol / allowlist、payload validator、Mobile reducers / UI、旧端降级 | 新旧 Desktop / Mobile 交叉矩阵通过；两个控制端并发时一个断线不影响另一个 |
| **F10：Orca 与 DSH 协作边界** | DSH session 可按显式策略参与 Orca，同时保留 native team 区别 | Orca policy、origin / provenance、budget / permission / result handoff | DSH native child 和 Orca worker 从 DB、UI、停止、审计到恢复均不混淆；不支持嵌套时明确拒绝 |
| **F11：发布与回归治理** | 多平台发布、升级、可观测性、文档从“方案”转为“维护不变量” | CI fixtures、release runners、upgrade / rollback、diagnostics、support runbook | §12 的完整验收矩阵、DCO、相关测试和安全 review 全通过，维护者批准后才可移除未准入标记 |

**F5d Main-only configuration safety floor（2026-09-05）**：ACP `session/new`、`session/resume`
与 `session/set_config_option` 的 `configOptions` 现在在 Desktop Main 被严格接收。Cindy 仅认可
`model` 与 `reasoning_effort` 两个 select control，并只接受该**同一 live session**已经广告的、有限的
opaque value；模型分组最多一层，未知／重复／畸形 control 一律不投影。选择回包必须重新确认被选值，
否则 Main 关闭 carrier、把 binding 标记为 `needs_reconcile`，绝不重试或猜测下一个 prompt 的路由。
该 state 的 raw value 不持久化、不进入 `DshBridgePort`、Maker 或 Renderer；上游 label 先由 Main 以
长度／控制字符规则校验，才可进入单独的 display-safe projection，description 和原始 option object 不会进入
产品边界。build.9 的本地 signed-Helper loopback E2E 已经
用 runtime 当前广告的 model opaque value 完成一次 `set_config_option` 回环，并继续通过同会话的
prompt / follow / cancel / close；它只证明受控 carrier 的协议往返，不是不同模型生效、Renderer UI、
持久化或真实生产 provider 的证据。

**F5e 本机任务配置投影（2026-09-05）**：`maker:dsh-runtime-configuration:get/set` 是 trusted
Electron Renderer 的 local-only、schema-validated 窄接口。每次 read 只返回 Main 为该 Cindy task
刚签发的 `dshcfg_*` choice capability、有限 label、control id 与当前 choice；它不接受或返回 raw ACP
value、runtime id、provider、endpoint、Home、profile 或 generic settings mutation。UI 只在本机 DSH
任务的 composer 上显示，使用 Cindy 的 pill/popover 选择惯例而**不**接入会持久化 provider/model 的通用
`ModelSelector`；选项在 DSH 正在处理消息时禁用，Main 也对 prompt/configuration/cancel/close 强制互斥。
失败后 UI 必须保持 unavailable，直到用户显式 refresh 取得新的 Main snapshot。该 UI 表示「后续消息的
候选运行时设置」，不是不同模型已在真实 provider 上生效的声明；没有新的 choice 时不显示面板，remote /
device-link 不得调用该接口。定向 Main/IPC/Renderer contract tests、五 locale glossary gate 和 typecheck
已通过；Light/Dark 仍待实际目检，browser E2E 与真实 provider route 仍未覆盖。

**阶段拆分规则**：F1–F4 可以先形成没有高级面板的 native foundation；F5–F7 完成“本机 Desktop
完整 DSH”；F8–F10 才完成 Cindy 全平台完整接入。任何提前演示必须写清所处阶段，例如“DSH
native Desktop foundation”，不得简称“完整 DSH”。

## 12. 验收、发布与持续兼容

### 12.1 分层验收矩阵

| 层 | 必须证明的事项 |
|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
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
