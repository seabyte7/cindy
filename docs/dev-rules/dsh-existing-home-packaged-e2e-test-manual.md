# DSH Existing Home：本机 signed-package 手工 E2E 测试手册

> 范围：只验证 macOS `darwin-arm64` 本地打包 `Cindy.app` 的 Existing DSH Home
> 目录授权链。它不会登录、发送 prompt、访问网络或启用产品 DSH；也不能单独宣布 F7
> 已完成。该手册不适用于正式发布包、远程环境、Mobile 或其他平台。

## 目标与通过条件

本测试把一次选择和后续启动刻意拆进两个独立 Cindy 进程，证明下列窄链路：

1. 用户在第一个进程中显式选择一个目录，Main 保存受保护的选择；
2. 第二个进程在**不再显示 Finder**的情况下读取该持久选择；
3. 同一 Cindy Main identity 将持久 app-scoped bookmark 转为一次性 implicit bookmark；
4. bookmark 仅由 private fd 3 交给固定 DSH Supervisor，child environment 没有 `DSH_HOME`；
5. Helper 完成无凭证 ACP initialize/close 后，Main 清除这次测试选择；第三个进程再次要求
   用户选择，以证明 reset 生效。

这是唯一能覆盖 reset/restart lifecycle 的手工路径；旧的单进程 `full` 模式只能作为第三步的
回归检查，不能取代前两步。

三次运行都在**同一个隔离 user-data** 下完成，且每次的最小 verdict 必须严格匹配对应形状：

```json
{"kind":"dsh-existing-home-packaged-e2e","ok":true,"phases":["picker","protected-selection"]}
```

```json
{"kind":"dsh-existing-home-packaged-e2e","ok":true,"phases":["main-implicit","helper-acp","reset"]}
```

```json
{"kind":"dsh-existing-home-packaged-e2e","ok":true,"phases":["picker","protected-selection","main-implicit","helper-acp","reset"]}
```

任何 `ok: false`、缺少 verdict、第二步弹出 Finder、弹出正常 Cindy 主窗口、要求登录、外网访问、
出现目录路径或 bookmark 内容，均为失败；不要以“选择器能打开”代替完整通过。

## 安全边界

- 仅在本机 Terminal 执行，使用刚由本地 `package:dsh:local-macos` 生成的
  `apps/desktop/out/Cindy-darwin-arm64/Cindy.app`。**不要**使用 `/Applications/Cindy.app`。
- 只选择本步骤创建的空临时目录，**不要选择真实 DSH Home、`$HOME`、Documents、Desktop、仓库、
  iCloud Drive 或包含任何凭证的目录**。
- `--user-data-dir` 也必须指向本步骤创建的临时目录。它将隔离 Cindy 数据、钥匙串引用和 verdict，
  不会读取或修改正式 Cindy profile。
- 不要从 Finder/Dock 双击该临时 App；测试完成后它设计为立即退出。若 Finder 随后提示
  “Cindy.app is not open anymore”，仅表示这个临时 E2E 进程已经按设计退出，不代表
  `/Applications/Cindy.app` 被关闭或损坏。
- 不要贴出 Terminal 的完整日志、原始 error、目录路径或任何 bookmark。回传 `ok` 与 phase
  即可。

## 前置检查

在仓库根目录执行。以下命令只读取本地签名和包路径：

```sh
APP="$PWD/apps/desktop/out/Cindy-darwin-arm64/Cindy.app"
test -x "$APP/Contents/MacOS/Cindy" || { echo '未找到本地测试包'; exit 1; }
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP" 2>&1 | grep -E \
  'app-sandbox|files.user-selected.read-write|files.bookmarks.app-scope'
```

预期：前两条签名命令成功，最后一条能看到且只需关注 Main `Cindy.app` 的三项声明：
`app-sandbox`、`files.user-selected.read-write`、`files.bookmarks.app-scope`。
不要把这些权限加给 `Cindy DSH Supervisor.app`；Supervisor 的断言恰好要求它不具备后两项。

## 先准备一个隔离测试根目录

仍在仓库根目录执行。此命令只会创建唯一的临时根目录；请保留这个 Terminal 和 `TEST_ROOT`
到整个流程结束。它不触碰任何已有目录。

```sh
APP="$PWD/apps/desktop/out/Cindy-darwin-arm64/Cindy.app"
TEST_ROOT="$(mktemp -d /private/tmp/cindy-dsh-existing-home-manual.XXXXXX)"
mkdir "$TEST_ROOT/selected-empty-home" "$TEST_ROOT/user-data"
printf 'Temporary test root: %s\n' "$TEST_ROOT"
```

为避免回显原始 JSON，先定义下面的脱敏检查函数。它只输出 PASS 或 FAIL：

```sh
check_result() {
  node - "$TEST_ROOT/user-data/dsh-existing-home-packaged-e2e-result.json" "$1" <<'NODE'
const fs = require('fs');
const resultPath = process.argv[2];
const expected = JSON.parse(process.argv[3]);
const actual = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const mode = fs.statSync(resultPath).mode & 0o777;
if (mode !== 0o600 || actual.kind !== 'dsh-existing-home-packaged-e2e' || actual.ok !== true ||
    JSON.stringify(actual.phases) !== JSON.stringify(expected)) process.exit(1);
console.log('PASS: existing-Home packaged E2E');
NODE
}
```

## 第一步：只选择并持久化（第一个进程）

运行：

```sh
CINDY_DSH_EXISTING_HOME_PACKAGED_E2E=1 \
  "$APP/Contents/MacOS/Cindy" \
  --user-data-dir="$TEST_ROOT/user-data" \
  --dsh-existing-home-packaged-e2e=select
```

在出现的原生 Finder 选择器中：

1. 确认标题为 `Choose existing DSH Home`，按钮为 `Use this DSH Home`。
2. 只进入并选中刚创建的 `selected-empty-home`。
3. 点击 `Use this DSH Home`，随后等待进程自行退出；不要反复点击 Dock 或 Finder 中的 App。
4. 退出后执行：

```sh
check_result '["picker","protected-selection"]'
```

此步通过只证明 Main 已保存受保护的选择；它**不得**声称已经启动 Helper 或 reset。

## 第二步：重启读取、handoff 与 reset（第二个进程）

仍使用同一个 `TEST_ROOT`，运行：

```sh
CINDY_DSH_EXISTING_HOME_PACKAGED_E2E=1 \
  "$APP/Contents/MacOS/Cindy" \
  --user-data-dir="$TEST_ROOT/user-data" \
  --dsh-existing-home-packaged-e2e=resume-reset
```

正确行为是：**不显示 Finder**、不显示正常 Cindy 主窗口、不要求登录，进程自行退出。随后执行：

```sh
check_result '["main-implicit","helper-acp","reset"]'
```

这一步才证明新进程读取持久选择后，完成 Main→fd 3→固定 Helper 的无凭证 ACP initialize/close，并
清除该选择。若它弹出 Finder，或 `main-implicit` 之前失败，立即停止；不得改用真实目录、raw path、
持久 bookmark 或 `DSH_HOME` 作为 workaround。

## 第三步：确认 reset 后不能静默复用（第三个进程）

仍使用同一个 `TEST_ROOT`，运行完整回归模式：

```sh
CINDY_DSH_EXISTING_HOME_PACKAGED_E2E=1 \
  "$APP/Contents/MacOS/Cindy" \
  --user-data-dir="$TEST_ROOT/user-data" \
  --dsh-existing-home-packaged-e2e=full
```

此时必须**再次显示**相同的 Finder 目录选择器；这证明第二步的 reset 没有遗留可自动重用的选择。
再次只选择 `selected-empty-home`，等待进程退出，然后执行：

```sh
check_result '["picker","protected-selection","main-implicit","helper-acp","reset"]'
```

三步均显示 `PASS: existing-Home packaged E2E` 才算通过。请只回传三条 PASS 文本；不要发送
`$TEST_ROOT`、原始 JSON、日志或截图中可见路径。

若 app 直接退出或验证失败，可只读取脱敏字段：

```sh
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log({ kind: r.kind, ok: r.ok, failedPhase: r.failedPhase });
' "$TEST_ROOT/user-data/dsh-existing-home-packaged-e2e-result.json"
```

允许回传的失败 phase 只有：`picker`、`protected-selection`、`main-implicit`、`helper-acp` 或
`reset`。不存在 verdict 也算失败，但无需读取或上传日志。

## 重点观察清单

| 观察点 | 正确行为 | 失败信号 |
| --- | --- | --- |
| 选择持久化 | 第一步有且只有一个真实 directory picker；结果只含两个选择 phase | 自动选择路径、要求选择真实 Home、路径写入结果 |
| 重启读取 | 第二步是新进程、同一临时 user-data，且绝不显示 Finder | 再次要求选择，或普通 Cindy UI 出现 |
| Main 权限 | Main 包含三项 bookmark 相关 entitlement | 缺任一项、或把 bookmark 权限加给 Supervisor |
| Helper 最小权限 | Supervisor 只保留 App Sandbox + network-client；不能有 user-selected / app-scope bookmark | Supervisor 出现文件选择或 bookmark entitlement |
| 传递通道 | 第二步结果无 path/bookmark；child env 无 `DSH_HOME` | 路径、bookmark、argv、环境变量或日志泄露 |
| ACP 行为 | 只 initialize/close，无登录、prompt、模型、插件或网络配置 | 主窗口、认证、prompt、外网或 profile 合并 |
| reset 收口 | 第三步重新显示 Finder，随后完整模式再清除选择 | 第三步静默复用首次目录，或 reset phase 失败 |
| 隔离 | 正式 Cindy 保持运行且 profile 无变化 | `/Applications/Cindy.app` 被退出、正式数据被改动 |

## 结果解释与后续处置

- **三步均通过**：仅为 F7 existing-Home 的 signed-package picker / restart / Main / fd 3 /
  Helper / reset 证据。仍需按 `docs/dev-rules/dsh-harness.md` 的其余 F7 门槛审计，不能把它
  描述为完整 DSH 发布或跨端支持。
- **`picker` 或 `protected-selection` 失败**：停止；不要尝试真实目录或放宽 Main 的保护机制。
- **`main-implicit` 或 `helper-acp` 失败**：停止；不要将 raw path、持久 bookmark 或 `DSH_HOME`
  作为 workaround 传给 Helper。
- **`reset` 失败**：停止；不要删除或手工修改 Cindy 正式数据。仅保留临时根目录并回传 phase。

测试完成、且你确认不再需要该临时证据后，可手动把打印出的单个 `/private/tmp/cindy-dsh-existing-home-manual.*`
目录移入废纸篓。不要执行宽泛的递归删除命令。
