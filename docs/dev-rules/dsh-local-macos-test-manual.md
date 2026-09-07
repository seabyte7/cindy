# DSH 本机 macOS 测试手册

> **适用范围**：本手册只覆盖 Cindy fork 内、`darwin-arm64`、本机 Desktop 的 DSH 开发
> 证据。它不授权远程构建、GitHub Actions、发布、其他平台、Mobile、SSH、device-link，或向
> `upstream` 写入任何内容。能力状态与安全红线以
> [`dsh-harness.md`](dsh-harness.md) 为准；本手册只说明“怎么测”和“测到什么算通过”。

## 先读结论

当前可以验证的是受控 runtime、Main/Helper bridge、Cindy-owned text task、局部 activity 和
Existing Home 的窄授权链，以及每个 live 本机任务的安全 model/effort 投影。它们不是“完整 DSH 已可
发布”的同义词：不同模型在真实 provider 上的实际生效、附件、完整历史同步、tool approval UI、浏览器
驱动的 DSH panel E2E、原生 profile/skill/plugin 生命周期，以及 F8--F11 都仍未验收。

特别是：产品 registrar 只接受 Main 重新校验过的 HTTPS provider；自动化 fixture 只允许测试注入的
`http://127.0.0.1:<port>`。不得为了 UI 测试加入 TLS 例外、Renderer endpoint bypass 或 production
fallback。没有一组真实而隔离的 provider 配置时，普通产品 DSH UI 不应被强行手测为“可用”。

## 安全前提

- 在仓库根目录执行，macOS 必须是 `darwin-arm64`。不要改用其他平台、远程 runner 或正式发布包。
- 所有 E2E fixture 必须使用临时目录、假 key 和 loopback；不得放入真实 API key、真实 DSH Home、
  `$HOME`、Documents、Desktop、仓库目录或正式 Cindy user-data。
- `apps/desktop/out/Cindy-darwin-arm64/Cindy.app` 是本地证据包，不能替代 `/Applications/Cindy.app`。
  Package 测试进程自行退出时 Finder 的 “not open anymore” 提示是预期现象，不代表正式 App 损坏。
- 运行命令不会请求或隐含 Git push。提交前门禁另见
  [`development-workflow.md`](development-workflow.md)；本手册不是提交、推送或上游操作授权。

## 推荐验证路径

按下面顺序运行。每层只证明表中写明的范围；前一层绿灯不能替代后一层。

| 层级 | 入口与方法 | 通过条件 | 不能据此宣称 |
| --- | --- | --- | --- |
| 文档与 diff | `pnpm check:dev-docs`、`git diff --check` | 文档索引、链接与 Markdown 约束通过，无空白错误 | 运行时、签名或 UI 已验证 |
| 类型与相关单测 | `pnpm --filter desktop run --if-present typecheck`；提交前再跑 `pnpm test:unit:related` | Desktop 类型收敛；受影响单测通过 | 本机二进制、Helper 或用户授权链 |
| F0--F4 runtime/bridge | 下方「自动化 A」 | 固定 runtime、route、binding、receipt、投影和 fail-closed 边界通过 | 完整 Desktop 体验或外部 provider 已访问 |
| F5--F6 产品薄层 | 下方「自动化 B」 | local text task、局部 resume、Cindy-owned plan/todo，以及 live model/effort 的 Main-only choice projection 通过 | 不同模型真实生效、附件、approval UI、浏览器 panel E2E |
| 打包 App | 下方「自动化 C」 | 签名的本地 Cindy.app 和固定 Helper 的 loopback E2E 通过 | 发布、安装器、跨平台或真实用户 endpoint |
| Existing Home | [`dsh-existing-home-packaged-e2e-test-manual.md`](dsh-existing-home-packaged-e2e-test-manual.md) | 三个独立进程的 picker → restart handoff/reset → picker-after-reset 都 PASS | F7 完整、原生扩展可用或真实 Home 已获授权 |

## 自动化 A：runtime、route 与 bridge 边界

以下命令从仓库根目录执行；它们不需要真实 provider 或真实 DSH Home。先跑 maker-core 的纯 adapter
与 translator，再跑 Desktop 的 Main/Helper 边界。

```sh
pnpm --filter @cindy/maker-core exec vitest run \
  src/agents/dsh/acp-client.test.ts \
  src/agents/dsh/activity.test.ts \
  src/agents/dsh/index.test.ts \
  src/agents/dsh/translator.test.ts
```

```sh
pnpm --filter desktop exec vitest run \
  src/main/dsh-host/__tests__/local-runtime.test.ts \
  src/main/dsh-host/__tests__/local-runtime.integration.test.ts \
  src/main/dsh-host/__tests__/macos-supervised-runtime.test.ts \
  src/main/dsh-host/__tests__/macos-supervised-runtime.integration.test.ts \
  src/main/dsh-host/__tests__/scope-and-host-manager.test.ts \
  src/main/dsh-host/__tests__/provider-config.test.ts \
  src/main/dsh-host/__tests__/provider-route.test.ts \
  src/main/dsh-host/__tests__/agent-registration.test.ts \
  src/main/dsh-host/__tests__/macos-supervised-bridge.test.ts \
  src/main/maker-host/__tests__/dshAcpStdioTransport.test.ts \
  src/main/maker-host/__tests__/dshControlPlane.test.ts \
  src/main/maker-host/__tests__/dshControlPlane.integration.test.ts \
  src/main/maker-host/__tests__/dshFollowProjection.test.ts
```

重点确认：

- route 只能由 Main admission 创建；生产 endpoint 是批准的精确 HTTPS origin，测试 endpoint 只能是
  带端口的 literal `127.0.0.1`；profile、DB、IPC、argv 与日志均不得出现 endpoint/key。
- runtime/sidecar、archive/tree manifest、fixed Helper、cwd 和 child env 任一不一致时必须 fail closed，
  不能回落到 PATH、系统 Node、用户 `dsh` 或网络下载。
- bridge 只保留 Cindy opaque handle、owner、receipt 与安全投影；native session id、raw ACP envelope、
  stderr/stack 不能跨越 Main→Renderer/Maker 边界。
- timeout、EOF、exit、重复/乱序事件和未决 prompt 必须关闭 carrier 或进入 reconcile，绝不能自动重放。

## 自动化 B：F5 文本薄层、配置投影与 F6 Cindy-owned activity

这些测试验证当前已实现的最窄任务面。它们不等价于浏览器 UI 自动化，且不能把 Cindy local
plan/todo 描述成 DSH native plan/todo。

```sh
pnpm --filter desktop exec vitest run \
  src/main/maker-ipc/__tests__/sessionRequest.test.ts \
  src/main/maker-ipc/__tests__/sessionCreateHandler.test.ts \
  src/main/localDb/__tests__/dshSessionBindings.test.ts \
  src/main/localDb/__tests__/dshPromptReceipts.test.ts \
  src/main/localDb/__tests__/dshProjectionJournal.test.ts \
  src/main/localDb/__tests__/dshActivitySnapshots.test.ts \
  src/main/localDb/worker/opHandlers/__tests__/dshProjectionTx.test.ts \
  src/main/maker-host/__tests__/dshSessionActivity.test.ts \
  src/main/maker-host/__tests__/dshActivityControl.test.ts \
  src/main/maker-host/__tests__/dshActivityControl.integration.test.ts \
  src/main/maker-ipc/__tests__/dshActivityHandlers.test.ts \
  src/main/maker-host/__tests__/dshControlPlane.test.ts \
  src/main/maker-ipc/__tests__/dshRuntimeConfigurationIpc.test.ts \
  src/renderer/features/cc-agent/__tests__/DshRuntimeConfigurationPanel.test.tsx \
  src/renderer/features/cc-agent/__tests__/DshActivityPanel.test.tsx \
  src/renderer/__tests__/agentSelect.test.tsx \
  src/renderer/__tests__/dshSessionComposerBoundary.test.ts
```

重点确认：

- 当前 F5 允许 local text `create/prompt/cancel/close`、受条件限制的同 Cindy task resume，以及只对
  **后续消息**生效的 live model/effort choice projection。后者只能传 Main-issued `dshcfg_*` capability，
  不持久化、不走 generic provider selector、在 in-flight prompt 时必须拒绝；不能把 loopback 回环当作
  不同模型在真实 provider 已生效。附件、完整 history、tool approval 与 recovery UI 仍未交付。
- New Maker 的 DSH 入口只接受固定 `DSH_MANAGED_RUNTIME_MODEL_ID`，没有 Renderer-selected provider；未
  注册、SSH 或 device-link 目标必须不显示/不创建 DSH。Composer 的文件、图片和文件夹入口与发送前检查
  都必须拒绝附件，不能因某个入口遗漏而把附件排队。
- F6 的写操作只在当前 owner 的 active local DSH task、active binding 和 `running` root 上存在；close、
  EOF、账户/selection 变化后必须只读并拒绝新写入。
- durable SQLite view 和 IPC projection 不得泄露 native runtime id；Cindy-owned label 不从 ACP 填充。
- 浏览器驱动的 panel E2E 目前是**未覆盖项**，不是允许放宽 provider route 的理由。

## 自动化 C：本地 source build 与 signed-package

仅在已经具备受审本地 source checkout、Node SEA archive 与 pnpm tarball 的前提下，才允许重新 source build。
构建工具接受的参数是精确的 flag/value 对；输出目录必须是一个新的临时目录：

```sh
pnpm build:dsh:local-macos -- \
  --release "$PWD/tools/dsh/macos-supervised-source-release.json" \
  --repo-root "$PWD" \
  --source-root /absolute/path/to/disposable/deepseek-harness-checkout \
  --node-archive /absolute/path/to/node-darwin-arm64.tar.gz \
  --pnpm-tarball /absolute/path/to/pnpm.tgz \
  --output-dir /private/tmp/cindy-dsh-build-output
```

将上一步 **同一输出目录** 中的 archive 与 manifest 原样交给 packaging，不要复制、改名、软链或替换它们：

```sh
pnpm --filter desktop package:dsh:local-macos \
  --archive /absolute/path/to/local-runtime.tar.gz \
  --manifest /absolute/path/to/local-runtime.json \
  --region global
```

预期末行是 `DSH_LOCAL_MACOS_PACKAGE_VERDICT=ready`，并给出本地
`apps/desktop/out/Cindy-darwin-arm64/Cindy.app` 路径。该命令会重新验证输入，完成本地签名并运行
固定 Helper 的 loopback E2E；其中 F7 fixture 必须完成 `create → initialize/tools/list → close → 同一
Cindy task resume → 再次 initialize/tools/list → close`，并在两次 close 后都确认没有存活 endpoint。它不得
生成 installer、上传 artifact、访问远程 runner 或构建非 ARM macOS。

再做最小签名确认：

```sh
APP="$PWD/apps/desktop/out/Cindy-darwin-arm64/Cindy.app"
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP" 2>&1 | grep -E \
  'allow-jit|allow-unsigned-executable-memory|disable-library-validation|audio-input|automation.apple-events'
codesign -d --entitlements :- "$APP/Contents/Helpers/Cindy DSH Supervisor.app" 2>&1 | grep -E \
  'app-sandbox|network.client'
```

本机试用包的 Main `Cindy.app` 与普通 Cindy 保持同一套**非 App Sandbox** desktop entitlement，
这样才能兼容既有 `~/Library/Application Support/CindyGlobal` profile。固定
`Cindy DSH Supervisor.app` 才必须拥有 `app-sandbox + network-client`，且不得获得 Main 的
user-selected-directory 或 app-scope bookmark 权限。若 Main 出现 `app-sandbox`、
`files.user-selected.read-write` 或 `files.bookmarks.app-scope`，应停止：该包会在创建日志和
迁移锁之前失去既有 profile 访问权。Existing Home 的受保护书签链路不属于这个本机试用包的
验收能力，不能通过给 Helper 增加权限来绕过。

## 手工 D：F5/F6 本地产品验收（可选的真实 provider 路径）

这一节是给人工操作 Cindy 界面用的，不是构建步骤。它会向**你自己明确选择的** HTTPS DSH
provider 发送两到三条无敏感文本，可能产生 API 费用；没有独立开发 key、测试账号或明确的 endpoint
授权时，跳过本节并在报告中记为「未运行」，不要借用其他 runtime 的 key，也不要临时改成 HTTP。

本节与上面的 loopback fixture 是两类证据：fixture 验证 Main/Helper 包边界；这里验证已打包
app 的产品入口、文本任务和局部 UI。两者都通过，也仍不能证明模型实际切换、完整历史、附件、
tool approval、浏览器 panel E2E 或 F8--F11。

### D0：准备隔离的本机测试资料

以下命令只创建一个空的本地工作目录和隔离的 Cindy profile。若你需要使用常用 profile，可以不用
`--user-data-dir`，但不得在该 profile 内修改或删除已有 DSH / provider 配置；有多个 DSH runtime
配置时请改用隔离 profile，因为当前产品 gate 只接受**恰好一个**已验证的 DSH 配置。

```sh
APP="$PWD/apps/desktop/out/Cindy-darwin-arm64/Cindy.app"
TEST_ROOT="$(mktemp -d /private/tmp/cindy-dsh-product-manual.XXXXXX)"
mkdir "$TEST_ROOT/workspace" "$TEST_ROOT/user-data"
codesign --verify --deep --strict "$APP"
"$APP/Contents/MacOS/Cindy" --user-data-dir="$TEST_ROOT/user-data"
```

预期是正常 Cindy 窗口持续打开。**不要**设置
`CINDY_DSH_EXISTING_HOME_PACKAGED_E2E=1`，也不要传 `--dsh-existing-home-packaged-e2e=…`：那是会
自行退出的窄链路测试，不是产品启动方式。若 macOS Gatekeeper 阻止打开，停止并只报告
`Gatekeeper blocked local package`；不要移除 quarantine、关闭系统安全功能或从未签名副本继续测试。

### D1：配置唯一的 DSH provider（只在已授权时）

确认该隔离 profile 已登录到可用于本地测试的 Cindy 账号；DSH registration 是 Main 按当前账号读取
配置的。若正常产品启动要求登录，请仅使用测试账号；没有这类账号就跳过本节，不要把正式账号的
provider 配置复制进隔离 profile。然后打开 **设置 → Providers（供应商）→ 添加供应商 → 自定义端点**。
选择 API-key 鉴权，在表单上方的 **DeepSeek Harness** 卡片中填写：

1. 一个仅用于测试的显示名称；
2. 你的 DSH HTTPS endpoint（无用户名、密码、query 或 fragment）；
3. 该 endpoint 专用的开发 API key。

只填写 DSH 卡片即可；不要为了让表单看起来完整而给 Claude Code、Codex 或 Pi 填模型、请求路径、
headers 或它们的凭证。保存后完整退出并从同一个 `$APP` 重开 Cindy，使 Main 以新配置重新注册
受监督 DSH runtime。

通过条件：DSH endpoint 和 key 可保存，但 task 界面和设置列表不会展示 key；再次编辑同一 endpoint
时，留空 key 表示保留 Main 本机已有 key，而不是把它读回 Renderer。以下任一情况停止本节：endpoint
不是 HTTPS、要求为 DSH 填模型列表/自定义请求路径、允许复用其他 runtime 的 key，或存在两个 DSH
runtime 配置。不要把 endpoint、key、测试账号、Provider 截图或完整日志发回。

### D2：创建本地 text-only DSH task

1. 保持本地模式；不要选择 SSH、device-link、Mobile 或远程项目。
2. 新建任务，选择本机 **DSH** agent，并把工作目录选为刚创建的空
   `$TEST_ROOT/workspace`，不要选择仓库、`$HOME` 或真实项目。
3. 确认创建页显示「受管 DSH 运行时」说明；它不应显示通用模型/供应商选择器、收藏模型或其他
   agent 的 provider 设置。
4. 发送仅包含下列内容的第一条文本：

   ```text
   Reply exactly: DSH_MANUAL_FIRST_OK
   ```

通过条件：任务在本机创建，收到包含 `DSH_MANUAL_FIRST_OK` 的正常文本回应，且 composer 保持
「受管 DSH 运行时」而不是回退到 Claude/Codex/Pi 路径。拖入或选择一个文件时，应提示当前 DSH
只支持文本，且不能把文件内容、路径或附件排入队列。

若 DSH 不出现在 agent 选择器、无法创建本地 task、需要选择 Renderer 控制的 provider，或文本被其他
agent 处理，记录 D2 失败；不要改选其他 agent 来制造通过。

### D3：live 配置、局部 activity 与双主题目检

在第一条 prompt 已结束、composer 不显示运行中状态时，检查 task composer 上方的两个 Cindy 面板：

- **运行时设置**：若 runtime 声明了安全的 `模型` 或 `推理强度` choices，选择一个当前未选的可见
  choice，再发送：

  ```text
  Reply exactly: DSH_MANUAL_SECOND_OK
  ```

  通过条件是第二条得到正常回应，选择只影响该 task 的**后续**消息，离开 task 后不会出现在另一个
  task；界面中不能出现 endpoint、key、native session id、raw ACP value 或通用 ModelSelector。此测试
  不能证明真实 provider 已按所选模型执行。若 runtime 没有声明这类安全 choice，面板会隐藏；记录为
  `D3 runtime choice: N/A (runtime did not advertise a safe control)`，不是失败，更不能伪造 choice。

- **本地计划与待办**：仅当面板显示可编辑状态时，添加计划 `Manual F6 plan`，再添加待办
  `Manual F6 todo`，先完成待办、再完成计划。两项应仅在 Cindy 本地面板中出现，不应作为发送给
  DSH 的 prompt 或 native plan/todo。如果面板显示「DSH 已断开连接。Main 验证任务已恢复后，才能继续
  编辑本地计划。」，保持只读，记录为 `D3 activity: N/A (not live)`；绝不能靠刷新、重试或修改数据库
  强行写入。

随后在**同一个 task** 分别切换 Light 和 Dark 主题，检查运行时设置与本地计划面板的文字、边框、
当前 choice 的勾选、禁用态和键盘 focus ring 都可辨认、无截断/重叠。若可编辑，使用 Tab 与
Enter/Space 打开并选择一次 runtime choice；不需要借助开发者工具或 Renderer 注入。

### D4：可选的同任务重启恢复检查

这一步只验证当前 F5c 的窄恢复条件，不是 history replay 或跨设备支持。不要改变 endpoint、key、
账号、Existing Home 设置或工作目录；正常退出**这个本地测试 app**，从同一 `$APP` 重开，并回到刚才
的 task。随后发送：

```text
Reply exactly: DSH_MANUAL_RESUME_OK
```

若 Main 验证持久 binding、同一 owner、同一受管 Home 和 settled receipt，task 可以恢复并收到该标记。
若恢复条件不成立，正确安全行为是 task/本地 activity 只读或不可继续；记录为 `D4: N/A (resume not
admitted)`，不要把 native id、raw history、DSH_HOME、PATH runtime 或不同 provider 配置作为 workaround。
只有把一个**不满足 admission 的** task 静默恢复、或在断开态仍接受本地 activity 写入，才是安全失败。

### 本节回传格式

不要回传 endpoint、key、目录、截图、原始日志或完整回复。只需复制这个脱敏结果模板并填状态：

```text
范围：local darwin-arm64 signed package
D0 package launch/signature：PASS | FAIL
D1 one HTTPS DSH provider：PASS | FAIL | 未运行
D2 local text task：PASS | FAIL | 未运行
D3 runtime choice：PASS | N/A | FAIL | 未运行
D3 Cindy-local activity：PASS | N/A | FAIL | 未运行
D3 Light/Dark + keyboard：PASS | FAIL | 未运行
D4 same-task restart resume：PASS | N/A | FAIL | 未运行
明确未覆盖：真实模型切换证明、browser panel E2E、附件、approval、完整 history、F8-F11、远程/Mobile/其他平台
```

## Existing Home 的手工 E2E

这一步需要你亲自操作原生 Finder，不能由自动化或普通单进程 smoke 替代。按专门手册执行：

[`dsh-existing-home-packaged-e2e-test-manual.md`](dsh-existing-home-packaged-e2e-test-manual.md)

它使用一个空的临时目录和隔离 `--user-data-dir`，分三次启动同一个本地包：

1. Finder 显式选择临时空目录，只验证 protected selection；
2. 新进程不再出现 Finder，验证 Main resolve → fd 3 → Helper ACP initialize/close → reset；
3. 第三进程必须再次出现 Finder，证明 reset 后未静默复用选择。

只回传三条 `PASS: existing-Home packaged E2E`。若失败，只回传允许的 phase
（`picker`、`protected-selection`、`main-implicit`、`helper-acp`、`reset`）；不要发送路径、原始 JSON、
bookmark、完整日志或截图中的敏感目录。

## 出现失败时怎么判断

| 现象 | 正确处置 | 不能做的事 |
| --- | --- | --- |
| 类型或定向单测失败 | 固定到失败文件/断言，修复后重跑同组与 typecheck | 跳过、删除或弱化测试 |
| `test:unit:related` 等待/锁端口 | 保留锁持有者信息，等同仓重型测试结束后重跑 | `--no-lock`、杀掉不属于本任务的进程、把未运行写成通过 |
| package 输入不被接受 | 重新确认 archive/manifest 是同次 source build 的常规文件 | 用软链、替换文件、PATH runtime 或网络下载绕过校验 |
| Existing Home 第二步又弹 Finder | 停止并仅回传 phase；保持临时证据 | 改用真实 Home、传 raw path/bookmark、设置 `DSH_HOME` |
| 需要证明浏览器 panel | 记录为未覆盖，另行设计保持生产 route policy 的审核过 harness | 加 HTTP/TLS 例外、Renderer provider 输入或测试后门 |

## 测试报告格式

报告必须把证据分层，而不是笼统写“DSH 已测试”：

```text
范围：local darwin-arm64 only
文档/diff：PASS | FAIL | 未运行
类型/相关单测：PASS | FAIL | 未运行（写明锁等待等原因）
F0-F4 定向自动化：PASS | FAIL
F5-F6 定向自动化：PASS | FAIL
本地 signed-package loopback E2E：PASS | FAIL | 未运行
Existing Home 三进程手工 E2E：PASS | FAIL | 未运行
明确未覆盖：browser panel E2E、真实生产 provider、F8-F11、其他平台/远程/Mobile
```

只有全部适用层为 PASS 时，才能称为“当前本机证据通过”；仍必须保留最后一行未覆盖项，且不能把它
写成 release、production 或 complete-DSH 结论。
