# DSH 授权后创建失败：原因调查与修复思路

> **实施更新（2026-09-14 21:12）**：用户已要求“修复 重新打包”。已把授权消费器与 task router 改成
> `{ cindySessionId, cwd }` 具名参数，并加入真实模块组合回归和 Main-only 有限阶段日志。
> 267 项定向测试、Desktop typecheck 通过；新 App 正在打包，安装与实际 provider 验收待记录。
> 下文第 1–6 节保留此前只读调查的时间截面，不代表仍未开始实施。

> 调查日期：2026-09-14；时间使用 Asia/Singapore（UTC+8）。
> 本轮范围：只读检查运行进程、安装制品、日志和源码，并做无网络、无真实凭证的内存复现；只更新报告与方案文档，未修改产品代码、配置或安装包，未重启 Cindy。
> 当前分支：`docs/dsh-harness-integration-plan`。工作区已有的大量 DSH 改动保持原样。

## 1. 结论

**已确认一个位于 macOS 目录选择之后、DSH 子进程启动之前的确定性错误：工作目录和任务 ID 的参数顺序接反。**

用户正常确认目录后，Main 保存了该任务的工作区授权。路由器随后领取这份授权时，把任务 ID 当作工作目录传入，绝对路径校验立即失败。因此继续点击授权和重试无法解决这一代码错误；本次失败链路尚未到达 ACP 初始化或 DeepSeek 模型请求。

同时发现三个影响排障与交付的问题：

| 问题 | 已取得的证据 | 影响 |
| --- | --- | --- |
| 参数顺序接反 | 真实两个模块的内存组合复现；新旧 App 的编译代码均有错误接线 | 创建 DSH 任务必然在领取授权时失败 |
| 错误原因被丢弃 | `DshAgent.startSession` 中 `void error`，只记 `create-failed`；Renderer 回退通用 toast | 路径错误、进程错误、ACP 错误显示成同一提示 |
| 替换后旧进程仍运行 | PID 25627 从 19:24:19 持续运行；`lsof` 显示映射的是已移入废纸篓的旧 App | 上次安装没有完成“退出旧进程—启动新进程—核对运行身份”的闭环 |
| 自动测试绕过产品接线 | router 测试用无参数 mock 返回授权；8 项 signed-Helper 测试直接创建下层 bridge | 类型检查与下层 E2E 通过，仍可遗漏首页真实创建链路 |

**新安装包也包含参数顺序错误。** 旧进程仍在运行是额外问题，不能把本次故障简单归结为“用户没有重启”。即使只重启，仍会撞到这一处错误。

## 2. 直接根因与失败链路

### 2.1 三处接口的真实形状

1. `apps/desktop/src/main/dsh-host/session-cwd-admission.ts:55,89` 定义消费接口：

   ```ts
   consumeWorkspaceBookmark(cwd: string, cindySessionId: string)
   ```

2. `apps/desktop/src/main/dsh-host/task-bridge-router.ts:112` 调用注入的回调：

   ```ts
   input.claimWorkspaceBookmark(cindySessionId, cwd)
   ```

3. `apps/desktop/src/main/maker-host/index.ts:2470` 把两个不同参数顺序的接口直接相连：

   ```ts
   claimWorkspaceBookmark: dshSessionCwdAdmission.consumeWorkspaceBookmark
   ```

两个参数都是 `string`，TypeScript 不会根据参数名字区分它们，因而类型检查通过。

实际传参等价于：

```ts
consumeWorkspaceBookmark('某个任务 UUID', '/Users/anthony/works/joyMartix/games/rxjh')
// cwd 收到 UUID；cindySessionId 收到目录。
```

消费函数先执行 `assertCanonicalCwd(cwd)`。UUID 不是绝对路径，于是抛出：

```text
DSH cwd admission requires a canonical absolute directory
```

### 2.2 授权按钮之后实际发生了什么

```text
首页选择 DSH 并发送
  → maker:create-session
  → Main 校验工作目录，打开系统目录选择窗口
  → 用户确认；Main 创建书签并 reserve(sessionId, cwd, bookmark)
  → DshAgent.startSession
  → task router 领取该任务的书签
  → 参数顺序接反，UUID 被当作 cwd，绝对路径校验失败
  → DshAgent 丢弃原始错误，改报通用创建失败
  → Renderer 显示“创建任务失败，请重试”

未到达：startTaskBridge → spawn Supervisor → fd 交接 → ACP → 模型请求
```

授权保存在 `maker-host/index.ts:2290–2311`。router 中领取授权位于 112 行，调用 `startTaskBridge` 位于下一行。这个顺序解释了为何用户明明授权成功，仍然看到失败，也解释了为何这些重试没有提供原生 Supervisor 的错误证据。

这里的“授权成功”仅指 Main 的目录选择、书签转换和保留流程已返回；不意味着下游 sandbox Helper 已接收或使用书签。

### 2.3 无真实凭证的最小复现

本轮直接用 Node 导入当前真实的 `createDshSessionCwdAdmission` 与 `createDshTaskBridgeRouter` 两个 TypeScript 模块。测试使用虚构任务 ID、虚构绝对路径和惰性书签字符串；没有读写实际工作目录，没有启动 DSH，没有访问网络。

执行了两个仅在内存中不同的组合：

| 接线方式 | 返回错误 | `startTaskBridge` 调用次数 |
| --- | --- | --- |
| 当前产品的直接函数赋值 | `DSH cwd admission requires a canonical absolute directory` | **0** |
| 仅在内存中调正参数顺序 | `DIAGNOSTIC_REACHED_HOST_START_NO_PROCESS_SPAWNED`（诊断桩主动终止） | **1** |

这证明本次直接阻塞可以由参数接反独立复现，并证明调正参数后能跨过当前阻塞点；**它没有证明后续真实进程、书签或模型链路已经可用**。

## 3. 运行中的 App 与磁盘新包

进程只读查询结果：

```text
PID 25627
启动时间：2026-09-14 19:24:19
命令显示：/Applications/Cindy.app/Contents/MacOS/Cindy
```

单看命令路径会误以为它正在运行新包。`lsof -a -p 25627 -d txt` 的实际映射文件却是：

```text
/Users/anthony/.Trash/Cindy.app-before-dsh-fd4-launch-fix-20260914/Contents/MacOS/Cindy
```

同一旧目录中还映射了 Electron Framework 与 `cindy-dsh-main-bookmark-bridge.node`。这证明替换 App 目录后旧进程仍然存活。

只读解析两个 `app.asar` 的目录和编译文件，得到：

| 制品 | `app.asar` SHA-256 | 主 bundle |
| --- | --- | --- |
| 当前进程映射的旧包 | `b7675fac2ce05eaa00d3d33f154df2ca47b398624220b739d51a6a71f0e0ebfe` | `bootstrap-electron-DXOIiDbs.js` |
| `/Applications/Cindy.app` 新包 | `ae2217ae66ac33c954478f26138f90b5d7f60017731b8d3ee5792a66413e30d4` | `bootstrap-electron-BvEJB1sK.js` |

两份主 bundle 均保留了：

```text
claimWorkspaceBookmark:dshSessionCwdAdmission.consumeWorkspaceBookmark
```

20:47:56 与 20:48:01 的两次错误日志，其堆栈均指向旧 bundle `DXOIiDbs`。来源为本机 `CindyGlobal/logs/main-2026-09-14.log:2458,2473`；agent 日志也只记录 `create-failed`。

**交付流程应修正：** 上次替换包前没有结束旧进程，替换后也没有核对新进程真正启动。这是安装验证遗漏；下一次应核对 PID、启动时间、实际映射文件和新 bundle 身份，不能只核对磁盘哈希。

## 4. 为什么此前的修复和测试没有解决这次问题

### 4.1 撤回上一轮的 FD 根因判断

此前方案修订 10 将本次 GUI 创建失败归因于 fd 3/4 处理。当前证据证明，这条实际创建路径在 `startTaskBridge` 之前就会失败，故尚未执行该启动路径上的 FD 代码。

因此撤回以下结论：

- “本次创建失败的根因已定位为 FD3”；
- “选择目录后，书签已经交接到了任务 fd 4”；
- “修复 FD 后只差重启实测便可认为当前阻塞消失”。

前次 Node 子进程的描述符观察只证明了那个测试进程的状态，不能直接当作原生 Supervisor 此次失败的证据。此前已加入的 FD 修改暂不在本轮改动或回退；后续应以原生入口的真实描述符与书签交接实测，决定保留、调整还是撤回。

### 4.2 错误被过度概括

`packages/maker-core/src/agents/dsh/index.ts:405–412` 明确丢弃原始异常，仅留下 `create-failed`，再抛出固定错误。`NewMakerDraftRoute.tsx:4514–4518` 对没有专用映射的错误显示通用创建失败。

避免泄露原始 ACP、凭证或书签是正确边界，但应保留由 Cindy 自己生成的有限阶段和安全错误码。建议区分“领取目录授权”“启动运行时”“ACP 初始化”“创建原生任务”等阶段，并保留匿名诊断关联号。不能通过直接打印所有 stderr、配置和 raw exception 来恢复可诊断性。

### 4.3 测试缺的是真实组合

- `task-bridge-router.test.ts:57` 的 `claimWorkspaceBookmark: vi.fn(() => WORKSPACE)` 不校验参数语义，接反也返回成功。
- `session-cwd-admission.test.ts` 单独按正确的 `(cwd, sessionId)` 顺序调用，消费器自身测试自然通过。
- `macos-supervised-runtime.integration.test.ts` 的 8 项测试直接调用 `startMacosSupervisedDshBridge` 等下层入口，没有经过生产 task router + workspace admission 的组合，也没有传递 GUI 的 workspace bookmark。工具用例在 Helper 自己的 container 目录执行。
- 因此签名验证、底层 8/8 和类型检查，不能覆盖这一次产品入口的接线错误。需要补组合测试，不能以重复同一批下层测试替代。

## 5. 下一轮修改思路

本轮先交付本报告；下列为待实施顺序，未改产品代码。

### 第一步：修正接线并让类型系统识别参数含义

最小止血方式是在 Main 组合处显式转换 `(sessionId, cwd) => consumeWorkspaceBookmark(cwd, sessionId)`。正式修复建议把这条 Main 内部消费接口与 router 回调统一成具名对象：

```ts
claimWorkspaceBookmark({ cindySessionId, cwd })
consumeWorkspaceBookmark({ cindySessionId, cwd })
```

范围限定于 `session-cwd-admission.ts`、`task-bridge-router.ts`、`maker-host/index.ts` 与直接测试调用者。保留现有精确目录校验、按任务隔离及一次性消费规则。无需改 DB、DSH 模型配置、已有密钥或放宽系统文件权限。

退出条件：真实 admission 与真实 router 使用生产同款接线，授权后的 create 能到达启动函数；未授权、错目录、错任务、重复领取仍拒绝。create 与 resume 两个入口都经过该路径，均需验证。

### 第二步：补可诊断的错误反馈

在 Main 层生成有限、结构化的失败阶段与错误码，并让 adapter 保留这种安全信息。产品提示能区分配置、目录授权、启动和 ACP 失败，原始路径、书签、密钥和任意 ACP 消息不透传。

涉及范围：DSH Main 组合/router、DSH adapter 的错误转换、现有 IPC 错误合同和 Renderer 映射。实施前按仓库规则核对 Maker、IPC、日志和界面文案规范；复用既有日志/错误设施，不新建一套日志系统。

退出条件：注入各阶段故障时能从安全日志判断失败位置，用户得到对应提示，输入中的测试秘密不会出现在输出中。

### 第三步：核验后续原生链路，再决定 FD 补丁

先完成正确的授权领取，再验证“精确 workspace bookmark → 固定 Helper → ACP 初始化 → session/new”。使用原生 Helper 的入口结果判断 fd 3/4 行为，并覆盖仅工作区书签、仅 existing Home、两者兼有的适用组合。

只有真实证据显示后续书签消费、sandbox 权限或 runtime 环境失败，才对那个具体失败环节设计补丁。原生问题不能从同一个通用 toast 推断；目录外访问拒绝与任务隔离仍需保留。

### 第四步：同一个新 App 完成产品验证

1. 相关组合测试与改动 package 的类型检查通过后打包。
2. 正常退出旧 Cindy，确认进程退出，再替换并启动新包；核对新 PID、启动时间、映射文件、bundle 与签名。
3. 在用户此前授权的 `rxjh` 目录中，从首页选择 DSH、选择精确目录并发送简短测试；取得实际 DSH 回复和结束事件。
4. 继续检查同一任务的下一条消息、停止及授权失败后的重试；不能靠新建另一种 Agent 绕过。
5. 文本链路通过后，按原完整方案的 B01–B18 分项验证文件、搜索、工具审批、附件等能力。

退出条件：记录的是实际产品入口与当前运行包的结果。底层 loopback E2E 与真实 provider 验收分别记录；下游若出现新错误，按新阶段证据继续调查。

## 6. 当前完成边界

已完成：识别并复现确定性接线错误；确认错误信息丢失点；确认旧进程未退出及新旧制品均含问题；明确自动测试缺口；修正旧方案的 FD 根因表述。

未执行：产品代码修复、App 重启/替换、真实 provider 请求、真实 Helper 工作目录读写。这些不属于本轮“先调查、给分析报告”的执行结果。

原完整能力范围仍见 [DSH Runtime 与工具能力完整修复方案](dsh-runtime-product-wiring-plan.md)。本报告对当前创建失败的结论优先于该方案修订 10 的历史推断。

## 7. 本次修复与验收记录

### 7.1 本次实现

- `DshWorkspaceBookmarkClaim` 统一消费器和 router 的 Main-only 输入，消除两个 `string` 参数顺序接反的结构性风险。生产注册直接赋值不再需要人工记住顺序。
- 保留精确目录、任务归属、一次性消费和失败后重新授权规则；未放宽 Helper entitlement，未修改密钥、provider、DB schema 或 system prompt。
- 真实 admission + router 组合覆盖 create/resume 正常启动、缺授权、撤销、错任务、错目录、消费后重试、host/native 失败和清理。仅最下层 host 是进程内 fake，不再 mock 授权成功。
- Main 通过既有 logger 记录 `workspace-admission` / `host-start` / `native-create` / `native-resume`，只含 Cindy task 关联号与固定阶段；任意底层 exception、path、bookmark 不进入该日志。日志函数异常也不能阻止 host 清理。
- 修正此前 Renderer DSH 排除分支中多余的 `persistedAgentKind !== 'dsh'` 比较，使类型检查通过；没有改变界面、非 DSH 行为或工作目录授权。

### 7.2 验证

| 层 | 本次结果 |
| --- | --- |
| DSH host 定向回归 | 104 passed；9 个显式 runtime integration case 未在 unit 环境执行 |
| 控制面、stdio、新建任务及 composer 回归 | 163 passed；1 个平台专属 case skipped |
| Desktop 类型检查 | `pnpm --filter desktop typecheck`，exit 0 |
| 文档合同 | `pnpm check:dev-docs`，9 passed |
| 差异空白检查 | `git diff --check` 通过 |
| 四个授权/router 文件 ESLint | 未通过：3 处存量 control-character 校验 regex 与 1 处存量 unused type import；不是新增逻辑告警，不以关闭 lint rule 伪造通过 |
| 新签名 App / installed App / live provider | 待本次打包完成后补充，不能由上述 unit 结果替代 |

### 7.3 范围与剩余工作

本轮优先修复确定性的创建阻塞，并加入 Main 可用的安全阶段诊断。第 5 节第二步的多语言 UI 错误细分、匿名诊断号和更细 ACP 初始化分类尚未实施；UI 仍可能显示通用失败提示，但 Main 不再只剩 `create-failed`。

历史 FD 编码补丁本轮未新增或放宽；后续实机发现的书签 `stale` 判定问题见 §7.4。
完整方案 B01–B18、Existing Home 三进程组合、跨端与工具全量验收仍是独立项目，不因本次修复全部转正。

### 7.4 第二处故障：一次性 implicit bookmark 的 stale 提示被当成授权失败

第一版修复包已于 21:15 启动为新 PID 47315，实际映射 `/Applications/Cindy.app`，bundle
`bootstrap-electron-zAlnxrWv.js`，ASAR SHA-256
`ac489f4d2f15970eb54836e0f40c24971ec35cebe65ab98d4dcd5c9df1a73dbf`。
21:15:49 的新请求不再停在 `workspace-admission`，而是 `host-start`。

无凭证、无 provider 请求的真实签名 Helper 探针复现了第二处故障：

1. Main N-API 为临时空目录生成书签后，Helper 通过 fd4 接收，抵达预期的“未配置环境”门。
2. 对用户已授权的 `rxjh` 做相同操作，Helper 返回固定错误
   `the private DSH workspace descriptor is invalid`（exit 68）。不读取或写入项目文件。
3. 同样 `app-sandbox + network-client` 的最小签名原生诊断程序输出：

   ```text
   resolved=1 stale=1 file=1 started=1 errorCode=0
   realpath=1 errno=0
   directory=1 errno=0
   ```

因此失败不是没有系统授权，也不是目录不可达，而是 `macos-dsh-implicit-bookmark.m` 将
`stale` 与 URL 无效、scope 无效混为同一拒绝条件。
[Apple 的 bookmark resolution 文档](https://developer.apple.com/documentation/foundation/url/init(resolvingbookmarkdata:options:relativeto:bookmarkdataisstale:)-3ic6f)
说明该标记用于提示以解析结果更新 bookmark 数据。当前 fd4/fd3 handoff 是 Main 新生成、一次消费且不持久化的 implicit bookmark，没有可重用的存量副本。

修复只从 Helper 的拒绝条件中移除这个 advisory flag；仍强制成功解析 file URL、
`startAccessingSecurityScopedResource`、真实目录校验与生命周期结束的 `stopAccessing`。
Main 持久 app-scoped bookmark 的 stale 策略、精确用户目录选择、一次性授权与 Helper entitlement 保持不变。
修复后的**实际产品原生函数**在相同诊断 Helper 中返回 `productAccepted=1`，而上述系统检查仍全部成功。

新增签名 App E2E：真实 Main N-API → 真 admission → 真 router → fd4 → fixed Helper → create/close →
fresh bookmark → resume/close。它只用 `os.tmpdir()` 内新建目录与内存 DB，不借用用户项目、账号或密钥。
原生测试 14/14、授权定向回归 18/18、第二次 Desktop typecheck 均通过；第二版修复包正在重建。

### 7.5 后续 GUI 阻塞的逐项修复（22:55 更新）

真实 GUI 重试继续暴露了三处彼此独立、都发生在模型请求之前的产品入口缺口；不能把它们归因为
用户没有授权或 DSH host 未注册。

| GUI 错误 | 确认根因 | 修复与边界 |
| --- | --- | --- |
| `SQLITE_CONSTRAINT_FOREIGNKEY`（创建任务失败） | `DshControlPlane` 在 `Maker.startSession` 内写 binding，但 Cindy `sessions` 父行仍按旧流程在其后创建 | DSH 专用生命周期钩子先写 `starting` 父行，native session 成功后原子提交为 `ready`；失败时回滚，无法删除则隔离为 `needs_reconcile`。普通任务路径不变，列表不显示未就绪/待核对记录。 |
| `queued.createOpts.agentKind invalid` | 共享的本地输入队列白名单和快照恢复只列 Claude Code / Codex / Pi | 精确加入 `dsh`；Device Link 入口仍明确拒绝 DSH，未扩大远端运行权限。 |
| `DSH turn-change capture is unavailable until the managed DSH host is registered` | 通用“可逆文件变更审查”没有 DSH provider 实现，却被无条件当作发送消息前置条件；报错文本误把能力缺失说成 host 未注册 | DSH 在该**可选**审查钩子直接返回，消息照常交给其 Main-owned ACP bridge；每次 DSH 工具调用的 Main 审批、受管 workspace 和本地限定不变。该变更并没有虚构 DSH 的通用变更回放能力。 |

对应的回归覆盖包括：父行先行提交/回滚/隔离、迁移回放、DSH 队列持久化与 Device Link 拒绝、
不把 DSH 内部 runtime marker 交给通用模型目录校验、以及 DSH 不可用的变更捕获不再阻塞本地 prompt。

新的本机签名包已在固定 build.11 输入上完成：`codesign --verify --deep --strict` 通过；
`app.asar` SHA-256 为
`246f6793bfc1efeab81c16431034575b2ae9336c16cfb944f91afaef797713b8`，Supervisor 为
`ffaaaee508b696f92a91563587111c014e644f616679abba3adafc5c14e6dcb7`。包内 signed-Helper
DSH E2E 为 **9/9**，其中含注册后的 Maker DSH task 创建、发送、取消、关闭、续接和一次工具审批。
这仍不是用户配置 provider 的真实文本响应证明；安装、启动并由真实 DSH 任务得到首条及续接回复后，
才能关闭 A 类运行时验收。
