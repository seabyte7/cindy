# DSH Cindy 控制面接入 Technical Spec

Status: confirmed
Requirements: docs/issues/dsh-native-integration/dsh-native-integration-requirements.md
Artifact: docs/issues/dsh-native-integration/dsh-native-integration-technical-spec.md
Source of truth: docs/dev-rules/dsh-harness.md

## Summary

本规格把 DSH 接成独立的 Cindy-owned harness vertical slice，而不是在 Claude、Codex 或 Pi adapter
上加分支。完整路径以 Desktop Main 的 `DshControlPlane` 为唯一产品会话控制面：它拥有受限连接、
持久 binding、最小投影和多端路由；受管 runtime 通过公开 ACP v1 执行命令。Cindy 不等待或依赖
上游另行提供 Native Host controller，也不读取 runtime 私有状态来代替协议。

F0 先产出同一 release 的制品、ACP capability 和 Cindy bridge 真实 lifecycle 证据。没有通过 F0，
不创建生产 DshHostManager、DshAgent、binding、UI 或 remote/Mobile 接口；但“没有上游 Host API”
不构成 F0 失败。

## Scope Adjustment — Local Fork-Only Development (2026-09-03)

This specification's active implementation boundary is local `darwin-arm64` Desktop only. F0 uses a locally
verified source tuple, local archive/tree integrity and real-binary ACP/Desktop Main E2E. It must not trigger a
remote runner, GitHub Actions, artifact upload, attestation, release/distribution, non-macOS build or upstream
write. F8–F11, SSH, Mobile and release paths below are retained as deferred architecture only; they are not an
acceptance target or implementation authorization until the user explicitly reopens them. Any push is only to the
user's `origin` fork.

## Repository Evidence

| 事实 | 当前证据 | 对设计的影响 |
|---|---|---|
| Agent identity 已有四个保留值 | `packages/maker-core/src/types/common.ts` 定义 `AgentKind` 为 claude-code、codex、pi、dsh；`apps/desktop/src/shared/agentKindConversion.ts` 对已存在的 dsh 严格 round-trip | F1 已完成本机 Desktop 身份闭合；未知显式值失败，不得回退。F5a 仅为本机、当前 owner 动态注册受管会话；remote/Mobile 仍未授权。 |
| Agent adapter 是显式 export | `packages/maker-core/src/agents/index.ts` export ClaudeCodeAgent、CodexAgent、PiAgent 与 DshAgent；Desktop Main 的 F5a registrar 只在 fixed Helper、唯一 provider、binding/receipt/journal 和启动后 revalidation 都通过时动态注册 `dsh` | DSH adapter 只能经受限、Main-injected bridge 使用，且须 committed projection / durable receipt admission；adapter contract 只含 Cindy session、scope 与 Main-generated ephemeral capability key，native session id 不可跨入 maker-core；dsh 不能被当作 Claude Code 或任一 fallback agent 运行。Renderer selector/UI 仍未交付。 |
| 通用事件已可保留 dsh source | `packages/maker-core/src/types/events.ts` 已加入 dsh source，但没有 DSH raw event 投影 | F4 仍必须以有限、版本化的 generic activity 契约扩展，不能放任 raw DSH JSON。 |
| Desktop 的 native binary 管理已经存在 | apps/desktop/src/main/agent-binaries/index.ts；`tools/dsh/macos-supervised-source-release.json`、`apps/desktop/native/dsh/`、`dsh-host/macos-supervised-runtime.ts` 与 `scripts/package-dsh-local-macos.mjs` | build.4 已在 Cindy 自己的本地 `darwin-arm64` App bundle 证明 supervisor/runtime、固定 Helper.app Main factory、exact loopback provider prompt/cancel、committed projection 和 durable receipts。build.9 已产出受控 archive/manifest，当前 Cindy App 也已重打包、验签并通过 7/7 loopback packaged-App E2E；dynamic-native 工具与真实 user-selected Home 验收仍未完成，能力地板不解除。两者都是 ad-hoc 本地证据，不是正常 release/distribution；Renderer 永不获得 binary path 或下载权。 |
| Pi 已验证目录型 runtime 更新模式 | tools/pi/latest.json 与 tools/pi/update.mjs 包含平台 pin、digest、整目录 manifest 和 sidecar 检查 | tools/dsh 必须使用更严格的 fixed-source-to-controlled-archive、tree manifest 与 sidecar 校验，不能把 Pi 的平台集直接照搬。 |
| Desktop 与跨端存在历史三值闭合点 | `apps/desktop` 已完成其 local identity、IPC 和 renderer 路径审计；`apps/mobile` 与 device-link 没有改动 | F1 当前只证明本机 Desktop；Mobile/device-link 的 append-only 契约与旧端降级仍是 F9 的受控工作，不能由 Desktop 类型变更替代。 |
| migration 已有历史链 | apps/desktop/drizzle/meta/_journal.json、apps/desktop/drizzle/scripts/ | DSH 只能新增 append-only migration 和回放测试，不能改写历史 migration。 |
| SSH installer 已是独立 package | packages/maker-remote-ssh/src/bootstrap/installer.ts | F8 用独立远端 installer/forward slice，禁止本机 runtime 代替远端执行。 |

上述是本仓当前源码事实；DSH upstream API、wheel 内容和支持平台不是本仓事实，必须由 F0 的
release evidence packet 每次重新证明。

## Current Architecture

Cindy 的 agent 抽象位于 maker-core，Desktop Main 持有进程、数据库、IPC 和权限边界，
preload 向 Renderer 公开最小化的 maker API。Mobile 经 device-link 与受控 Desktop 通信。
因此 DSH 不能被 renderer import 或由 mobile 直接连接；它必须遵守以下方向：

    Renderer / Mobile
             |
       preload / device-link
             |
    Desktop Main: DshControlPlane + projection store
             |
       injected Cindy bridge port
             |
    maker-core DshAgent and event translator
             |
    managed local or remote DSH ACP scope

maker-core 不 import Electron、safeStorage、app paths、child_process 或 SSH；Desktop Main 不重写
DSH agent loop；Cindy control plane 不把 ACP transport、scope correlation state、secret、profile contents 或
arbitrary event payload 广播到 UI。

## Proposed Design

### 1. F0 release evidence packet and gate

F0 adds a version-controlled but secret-free evidence schema and fixtures. One packet identifies a single
runtime tuple:

- upstream release/tag and license/notices provenance;
- fixed upstream tag→commit→tree, upstream lockfile, Cindy pkg-toolchain lock/integrity and build-script digests, pinned Node/pnpm and frozen install command; where an upstream build parser blocks a security-required exact target, a Cindy adaptation must be patch-SHA-bound and per-file preimage/postimage-bound, be rechecked after dependency install, and touch no undeclared file;
- local builder record plus the controlled archive's filename, size and SHA-256; this is development evidence,
  not CI provenance or a release claim;
- extracted executable, required sidecars and canonical tree-manifest hash;
- supported platform tuple and unsupported-platform rationale;
- executable version output, ACP protocol/capability snapshot and handshake transcript;
- create, prompt, follow/history, cancel, close, resume and abnormal-exit observations;
- redacted positive and negative fixtures.

The F0 test harness starts only the pinned local macOS executable with an empty Cindy-managed DSH_HOME and a
non-project launcher cwd. POSIX evidence uses a dedicated process group and confirms cleanup after a root-first
ordinary descendant exit. It does not claim whole-tree containment or support for another OS. It must prove the
published ACP protocol can negotiate capability and that a Cindy-owned bridge
can complete create/list/resume (when advertised)/follow/prompt/cancel/close with scope/session ownership,
Main-injected workdir authorization, command receipts, ordered follow delivery, bounded EOF/exit behavior and honest reconciliation. F0's EOF/exit
behavior is fail-closed `needs-reconcile`, never prompt replay; durable recovery is F3. A private file format,
undocumented endpoint or source-only class does not satisfy the gate. F0 emits one machine-readable gate result
and a human review record; no code path may turn an absent gate into an available dsh registration.

### 2. Identity and capability contracts

F1 adds dsh atomically to shared type domains only after an inventory names every closed union, serializer,
validator, display mapper, database decoder, IPC handler, scheduler/search/filter, remote API and Mobile reducer.
The delivery must include an inventory test or checked manifest so a new three-value hard-coded union cannot be
silently missed.

Dsh capabilities use the existing CapabilityStatus distinction:

- sdk-missing: F0 proves the pinned runtime protocol does not supply the capability;
- not-implemented: runtime supports it or Cindy can own it, but Cindy has not completed its safety/UX contract;
- platform-limited: the selected release/profile/platform does not permit it;
- supported: both F0 evidence and the affected Cindy implementation are tested.

No consumer may infer support from AgentKind alone. The Desktop Main injects a per-host immutable
CapabilitySnapshot; Renderer and Mobile receive a display-safe projection, never controller details.

### 3. Managed runtime, Home and Host scope

F2 now provides `tools/dsh/latest.json`, an offline-only `tools/dsh/update.mjs`, Desktop Main `dsh-host`
admission/scope modules, plus the separate local `macos-supervised-source-release.json` and native macOS
supervisor source. They are local development inputs, not a distribution/update system: the F0 importer requires
explicit local archive and bundle-manifest paths, has no fetch/CDN/URL/default output path, and cannot register
DSH. The build.4 supervisor passed its credential-free lifecycle and the strict loopback provider `create → prompt
→ committed projection → cancel → close` path in Cindy's own locally ad-hoc-signed `darwin-arm64` App bundle.
`package:dsh:local-macos` accepts only explicit local archive/manifest inputs, excludes remote-agent bundles and iOS
preparation, signs ordinary Electron code inside-out without replacing the nested DSH Helper entitlement, then runs
the packaged-app E2E. Main canonicalizes the adapter base before injection so the sealed adapter reaches its fixed
`/chat/completions` operation. Normal packaging, release signing/notarization and distribution remain DSH-free and
out of scope.
The local importer must:

1. receive only a user-authorized, integrity-verified archive built from a reviewed **already-local** source
   tag→commit→tree pin rather than discover a mutable “latest” release; missing local evidence fails closed and
   must not fetch/clone/contact a source remote; release provenance has its own future gate;
2. stage only that supplied local archive, validate archive hash before extraction, reject traversal, symlink,
   special-file, unexpected top-level file and missing-sidecar cases;
3. validate executable mode and the full extracted-tree manifest before producing the Cindy archive;
4. validate the archive hash and the extracted-tree manifest again at install time;
5. register no DSH asset on unsupported platforms and never call PATH, npm, pnpm, pip, curl or a system Node
   fallback.

The build.4 path is deliberately not an alternate F0 importer: it requires a runtime/sidecar bundle and bootstrap
addon cache signed as resources inside a separate `Contents/Helpers/Cindy DSH Supervisor.app`, with a native helper
that derives those paths internally and fixes its ACP argv. Its staged descriptor is identity-only and must match the
actual parent/Helper Info.plists; Main validates it plus the regular/non-symlink runtime/sidecar/addon topology,
then launches the fixed Helper supervisor—not descriptor-selected child code. The managed scope is placed below the
Helper sandbox container, not Cindy `userData`. Its capability floor leaves `attachment-local`, `subprocess`, `sandbox`, `bash-sandbox`, `permission`,
`tool-bash` and `tool-fs-search` unavailable rather than relying on mutable dynamic-native extraction. The
temporary App passed no-credential `initialize → new → close → list → resume → close`; that earlier fixture alone
did not prove a Cindy package. The later packaged-Cindy E2E proves only the named local lifecycle and strict
loopback prompt/cancel sequence; neither fixture proves a production endpoint, permission, dynamic-native tool,
general release or product registration beyond its separately gated local F5a path.

Build.9 extends the local source/staging closure: its five reviewed adaptations stage the minimal
`darwin-arm64` `@yao-pkg/pkg` cache as a signed Helper resource and patch the SEA prelude to fail closed rather than
extract into Home. Verified local Node and pnpm inputs produced the controlled build.9 archive/manifest, and the
current `darwin-arm64` Cindy App was rebuilt, signed and passed its 7/7 loopback packaged-App suite. No
dynamic-native tool test or actual user-selected Home signed-package acceptance exists, so the existing capability
floor remains in force.

For cindy-managed scope, `dsh-agent-home`, its hashed scope, `process-home`, and `dsh-home` are each direct real
directories; a pre-existing symlink is a hard error rather than a recursive-create path. Immediately before the
native supervisor is spawned, Main resolves every Home/launcher/temp directory and proves its canonical path remains
below the Helper container. Lexical prefix checks are not a containment control.

The supervisor launch boundary accepts no caller-provided executable, sidecar, command, argument or ambient
environment. It resolves the selected executable and every required sidecar with `realpath`, proves each remains
inside the just-verified installation root, then requires a regular executable with the recorded digest/mode.
The launcher constructs the fixed command and an allowlisted environment itself; this check happens again after
staging-to-live promotion, before every product spawn.

DshHostManager owns a scope key of account scope, runtime release, execution location and Home mode. It creates
a non-project launcher cwd and one explicit DSH_HOME for cindy-managed mode. F0 admission roots live below Electron
userData; the F2 supervised factory instead places cindy-managed roots below its verified Helper-app container; staging
and run material use task-specific temp directories. The F7 existing-dsh-home path has no `dshHome` property at all:
it retains only Helper-owned process/launcher paths and requires Main to supply an opaque private handoff. A scope
starts lazily and performs a version/ACP-capability handshake before it is
visible. It currently requires an injected launch-time containment-proven client; it must not fall back to the F0
process-group transport. After that adapter is evidenced it uses quiesce -> flush -> close -> TERM -> bounded KILL.
A failure disables only that DSH scope.

Main obtains credentials from the existing secure store, passes only named secrets through a whitelist child
environment, redacts bounded stderr, and removes temporary materials after failure, cancellation, account switch
and quit. Neither argv, DB, profile, diagnostics, IPC nor Mobile payload contains a secret.

For the authorized macOS network slice, `com.apple.security.network.client` belongs to the separately signed
Helper.app only. App Sandbox does not filter destinations, so no route may originate from Renderer, an ambient
environment variable, a user profile or DSH Home. Main constructs an opaque route capability: production input is
the exact HTTPS origin of one Main-revalidated current-account `runtimes.dsh` record (zero or multiple matching
records are unavailable), with no default endpoint; the test-only variant is literal
`http://127.0.0.1:<port>`. Before spawn, Main atomically replaces the managed ACP Home-level patch at
`$DSH_HOME/cordis.patch.yml` with a fixed source that contains only `CINDY_DSH_PROVIDER_BASE_URL` and
`CINDY_DSH_PROVIDER_API_KEY` names. This layer is used because the public `acp` profile initializes its own template
directory on first use. The Main capability canonicalizes away a terminal `/` because the selected DeepSeek adapter
appends `/chat/completions` itself. It writes neither the endpoint
nor key to disk, reads the one secure-store key only after route admission, and the native supervisor rejects a
missing/one-sided provider pair and strips every non-contract environment variable. The staging hook inspects the
resulting Helper code signature for both App Sandbox and network-client entitlements. A signed-Helper prompt E2E
is still a separate acceptance requirement; static/unit proof does not promote DSH to available.

### 4. Cindy bridge, session binding and projection

F3 introduces a maker-core port, not an Electron dependency. Proposed types are:

    DshBridgePort
      getHandshake(scope): DshHandshake
      createSession(input): DshCreateReceipt
      resumeSession(binding): DshResumeReceipt
      send(session, requestId, input): DshSendReceipt
      cancel(session, requestId): DshCancelReceipt
      close(session): void
      follow(session, afterSequence): AsyncIterable<DshBridgeEnvelope>
      listHistory(session, cursor): DshHistoryPage
      resolveInteraction(session, decision): void

Every command carries scope identity, opaque runtime session identity, request correlation and negotiated ACP
capabilities. Desktop Main implements the port over its owned stdio transport or SSH forward; no endpoint is
exposed to renderer code. Any internal bridge capability token is memory-only and each incoming envelope is
checked for protocol version, scope, runtime session id, monotonic sequence, request correlation and schema
before core consumes it.

A new append-only DSH binding table has one unique Cindy session id and stores only:

- opaque runtime session id;
- host scope id;
- runtime version and ACP capability fingerprint;
- Home mode;
- last projected bridge sequence;
- lifecycle state and timestamps.

It must not store an endpoint, token, credential, raw profile or durable DSH log. The migration adds uniqueness
and scope/session lookup indexes. Receipt persistence first records the Cindy request id; on timeout or carrier
loss, a reconcile reads receipt/history before any retry. Projection follows first, pages history only through
the published transport when available, deduplicates by bridge sequence and marks needs-reconcile if continuity
cannot be proven.

### 5. Event and interaction translation

F4 defines a discriminated DshBridgeEnvelope schema with a version and bounded payload for text, thought,
tool lifecycle, usage, interaction, session lifecycle and `cindy-dsh` activity reference. Unknown enum/field/event
outcomes are deterministic: preserve an internal diagnostic marker, stop unsafe control actions, and expose a
user-readable unsupported/reconcile state. They never become done, text, tool_result or another provider.

The translator emits existing AgentEvent types where semantics are exact. Cindy-owned state is carried by a new
finite `cindy-dsh` activity snapshot/reference contract with origin `cindy-dsh`, object id, parent id, status,
display-safe summary, sequence and supported actions. The reducer rejects illegal state transitions and stale
sequences. It never serializes an arbitrary DSH object, including raw ACP error `data`, stderr or stack material,
to Renderer; Main maps failures through a bounded, display-safe error code/message projection.

Tool approval uses the ACP toolCallId as a one-shot correlation key. Main must receive the matching tool metadata
before it can render an approval. Missing, stale, duplicated or cross-session ids, timeout and disconnect all
produce reject/expire; allow-once is never persisted or labelled as allow-always.

### 6. UI, Cindy activity and extension boundaries

F5a has admitted only the Main registration and fresh local create transaction: it revalidates the current owner,
one closed-shape provider configuration and launch-time API key before/after the Helper handshake, binds a canonical
local cwd to the exact Cindy session, and rejects later create/prompt operations if that provider snapshot changes.
F5b currently adds only a Main-roster-confirmed, local New Maker entry and preserves the same text-only boundary in
the resulting task composer. It uses a fixed opaque runtime marker and does not expose a provider, permission or
attachment choice; Main rejects a forged marker or any renderer-selected provider. F5d/F5e add a separate live
model/effort choice projection: Main validates the ACP select snapshot, issues per-task opaque choice capabilities,
and accepts them only through named local IPC. The renderer never receives an ACP value, runtime id, provider route
or persistent model preference; it hides the controls when no current live choice is admitted, disables them during a
message, and requires an explicit refresh after rejection. Main serializes configuration with prompt/cancel/close and
closes the carrier on an unacknowledged configuration response. This is not a claim that a different model has been
proven effective at a real provider, nor that generic session choice, attachments, history, approval, status or
recovery UI exists. F5c additionally
allows only the same Cindy task to continue after a fresh local bridge has rehydrated a same-scope, settled binding
against ACP `session/list`: the adapter presents its existing opaque task handle, while Main resolves the native id and
revalidates the cwd. It is not history synchronization or a general recovery UI. Any later
F5 IPC/preload channel must remain schema-validated and action-specific; it must not expose generic invoke, endpoint,
Home path or command execution. All delivered user text uses the glossary and five locales; styles use semantic
tokens for both themes.

The F6 target is to add Cindy-owned structured activity panels for plan/todo, command/elicitation, terminal,
task/job/workflow/schedule.
Terminal objects are owner-scoped and use explicit attach/input/signal/close actions; a terminal is not tool
output. Each supported object must have observed identity, allowed actions, cancel/disconnect behavior and
recovery limitation. `cindy-dsh` activity never writes Orca tables or becomes an Orca worker; it is never
labelled as a DSH-native UI object.

Current local delivery includes F6-1 session lifecycle and F6-2 Cindy-owned local plan/todo: a closed activity reducer plus a Main-only
durable snapshot store, with canonical JSON, digest, scope/session ownership, snapshot sequence and object
revision checks. Main creates one Cindy-owned session root after a durable ACP create receipt, projects
acknowledged close and verified resume, and forces observe-only on fresh-bridge restoration or carrier EOF. F6-2
exposes only a display-safe local plan/todo panel and five named, trusted-renderer local IPC operations
(read/create-plan/create-todo/complete/cancel); it neither receives nor returns ACP/native state. It does not
enable terminal, job, workflow, schedule, approval, attachment, remote or cross-device controls. If the session
root is disconnected, the durable binding is inactive, or current Main has revoked its synchronous local write
admission, its view is observe-only and all local plan/todo mutation is rejected until a verified resume. Until a
Cindy-owned action is backed by a tested Main contract, it
remains absent rather than being displayed as a disabled-looking but unverified control.
The local signed-Helper E2E drives this Main contract against a real bound session: create/complete/cancel plan and todo,
SQLite/view redaction of the runtime id, then bridge close and rejected writes. It proves the Helper-to-Main
activity path, not browser automation of the panel. An isolated local Desktop run has confirmed a CDP renderer path,
but it cannot turn the HTTP loopback fixture into a product session: registration correctly requires a persisted
Main-owned HTTPS provider. F6 must not weaken that policy, add an insecure TLS exception or expose a Renderer
provider bypass just to manufacture browser evidence. Browser-driven evidence remains a future reviewed harness
requirement, not an achieved F6 claim.

The F7 target gives the user a mode selector for cindy-managed versus existing-dsh-home and native settings/projection for
MCP, skills, profiles, plugins and extensions. Cindy-internal MCP is a separate source with Main-created
allowlisted transport, per-session token, lease and cleanup generation. User-native configuration preserves
DSH native semantics; Cindy may explain consequences and offer recovery, but may not make explicit native
installation/update/self-repair impossible.

#### F7 authorization and containment contract — narrow production handoff, final acceptance still pending

The user explicitly approved the macOS user-selected-directory and persistent security-scoped-bookmark foundation
on 2026-09-05. The narrow `existing-dsh-home` registration route now resolves the selection only in Cindy Main,
converts it to a fresh Helper-only implicit bookmark, and starts the fixed ACP profile with no `DSH_HOME` environment
entry. This approval does not authorize an arbitrary Renderer path, a generic command, native installation/update,
or unknown native extension/profile mutation. `existing-home-settings.ts` owns a per-account protected
override: the ordinary JSON index contains only account hash, mode and random encrypted bookmark reference, while
the opaque bookmark bytes live in a separate Electron-safeStorage-encrypted file. Default reads neither create that
store nor probe secure storage. A Main-only picker adapter requests exactly one `openDirectory` plus
`securityScopedBookmarks` result and never returns or persists its path. Renderer, ACP payloads and local activity
data exchange only a display-safe Home origin/mode projection. They never carry a raw Home path, a bookmark, a
profile, an extension manifest, a secret or a command. The generic `DshHostScopeInput` has also removed the legacy
`existingDshHome` path field and rejects that property at runtime, so a future Helper handoff cannot be bypassed by
an untyped Main caller.

The persistent override records the selected mode plus an opaque, protected bookmark reference. It must not put a
raw external pathname into ordinary SQLite/configuration, diagnostics, IPC, Mobile payloads or DSH activity
snapshots. The record is an explicit user override, not a copied default. Selection and reset are intentionally
restart-effective: they do not tear down unrelated live Maker tasks in place. A bridge captures the selection only
during fresh registration; before every new DSH operation it re-reads the protected selection and compares a
Main-memory-only digest, failing closed when it was replaced or reset. Restart then releases the old Helper process
through normal Maker shutdown before registration observes the new selection. Reset removes only Cindy-owned
reference/materials; it never copies, deletes, migrates or rewrites the selected native Home, profile, plugin,
skill or credential. A stale, revoked, unresolved or account-mismatched bookmark fails closed to an actionable
unavailable/reselect state; it never falls back to `HOME`, a Renderer string or a neighboring managed scope.

The separately signed Helper retains App Sandbox and must remain unable to accept a caller-controlled executable,
argument list or generic shell command. A sandbox child does not inherit Main's dynamic picker grant. In addition,
Apple app-scoped bookmarks are bound to the creator's code-signing identity: the Cindy Main App and the
`Cindy DSH Supervisor.app` deliberately have distinct identities, so the Helper must **not** receive or resolve the
persisted app-scoped bookmark. The future launch path has two closed stages instead: a Main-process native bridge
under Cindy's identity resolves the persistent bookmark and produces a fresh non-persistent implicit URL bookmark;
Main transfers only that bounded opaque value once through a dedicated private descriptor. The Helper resolves the
implicit bookmark, explicitly balances access for the fixed child lifetime, and releases it on every exit/failure
path. Neither stage may use argv, environment, ordinary IPC or raw-path persistence for this authority. The Helper's
entitlement set must be minimal for this receiving role; Cindy Main owns the user-selected and app-scoped bookmark
rights. Its current fixed `--profile acp` admission is not an extension-management API. Profile/skill/plugin discovery
and install/update/enable/disable/self-repair may appear only where a real DSH runtime operation or a separately
implemented Cindy-owned operation has a closed input schema, user initiation/confirmation, bounded redacted result
and interrupted-operation recovery. Unknown or unverified native capability stays unavailable; it must not be
emulated by a fabricated API or a silent permanent disable.

The primitive implementation is deliberately lower than Renderer/IPC: the separately signed Main
resource `cindy-dsh-main-bookmark-bridge.node` has exactly one export, persistent→implicit conversion; the Helper
receives its result only as a four-byte big-endian length, canonical ASCII base64 bytes and EOF on fd 3. It rejects
a missing, oversized, malformed or trailing descriptor, refuses an existing-Home descriptor for any argv other than
the fixed ACP profile, and refuses `DSH_HOME` in that mode. The resolved directory exists only in Helper memory for
the child lifetime and is released after bounded child cleanup. A local macOS General Settings card now exposes only
the display-safe projection and three fixed-purpose Main IPC calls (read, explicit native selection, reset to
Cindy-managed). Its trusted sender passes no account id, pathname or bookmark; the picker result is rejected when the
captured Main account generation changes, and device-link/Mobile cannot route these calls. Fresh bridge registration
now calls this primitive only after provider/owner admission; cindy-managed launches reject an implicit bookmark and
existing-Home launches reject a missing one. The generic `DshHostManager` remains cindy-managed-only so no untyped
caller can bypass the production macOS bridge. The final permission claim remains blocked on a real user-selection
signed-package acceptance, and the remaining F7 native-operation gates remain unavailable.

The internal-MCP factory is Main-only and separate from user-native MCP configuration. The delivered
`internal-mcp-lease.ts` factory accepts only static Main endpoint definitions and has no Electron, IPC, persistence,
configuration or default production endpoint dependency. It rejects root path ownership and accepts only either an
exact `127.0.0.1` / `[::1]` HTTP endpoint with a port and a non-root session-instance path prefix, or a static
HTTPS origin with that endpoint's non-root prefix. It rejects `localhost`, unported HTTP, credentials, query,
fragment, path escape and HTTPS origin drift. Each acquire reserves one `(cindySessionId, sessionInstanceId)`, creates
a fresh 32-byte memory-only bearer token for each registered endpoint, passes it only as the exact ACP authorization
header, and rolls registrations back in reverse order if any later registration fails. The caller cannot choose a
URL, header, token, command or account identity.

`DshControlPlane` acquires this lease before its native `session/new` or `session/resume` request, fixes those
declarations to that request, and releases it after session close, failed create/resume, or carrier shutdown. Carrier
EOF/exit invokes factory-wide revocation before durable cleanup; stale/repeated releases cannot close a newer lease.
The signed local `darwin-arm64` package E2E verifies a fixed Main-injected loopback MCP server's real authenticated
`initialize` and `tools/list` exchange through the signed Helper, then closes the binding and proves the endpoint is
gone. It resumes that same Cindy binding with a fresh session-instance lease, observes a second authenticated
`initialize` and `tools/list`, then closes again with no endpoint remaining. Separate factory tests prove token
construction, endpoint-policy rejection, rollback and stale-release behavior.
This does **not** create a product endpoint registry, a user-native MCP editor, a renderer-visible configuration, or
an account-switch/reset wiring; a future such owner must call `revokeAll()` before its own cleanup. Tokens, headers,
URLs and native configuration do not reach Renderer, Mobile, ordinary persistence or diagnostics. F7 remains local:
it does not forward an internal MCP credential or Home access over SSH/device-link; F8/F9 need separate contracts.

### 7. Remote, Mobile and Orca

F8 runs the Cindy DSH scope, DSH_HOME and runtime entirely on the remote SSH host. The local Main only owns authenticated
forwarding and projection. Remote file, attachment, terminal, MCP and sandbox decisions are remote-semantic.
Reconnect repairs one scope; it must not delete/restart local or unrelated remote scopes.

F9 extends device-link append-only with display-safe dsh identity, capability and action payloads. The controlled
Desktop remains the command authority. Version skew gets a declared state: hidden unsupported entry, read-only
projection, or “continue on desktop”; it never creates a fresh agent. Tests include old/new Desktop × old/new
Mobile and two concurrent control peers.

F10 is a separate optional interop design. It adds an explicit provenance boundary before DSH participates in
Orca. The data model must distinguish `cindy-dsh` child/task/job from Orca worker at DB, UI, stop, permission,
budget, result and recovery layers. Without this contract, the Orca entry remains unavailable for DSH.

## API / Interface Changes

| Boundary | Additive contract | Rejection rule |
|---|---|---|
| maker-core identity | AgentKind dsh and DshAgent injection interface | Unknown input fails; no cc fallback. |
| core events | versioned `cindy-dsh` activity and DshBridgeEnvelope translator | Raw runtime JSON cannot cross package/UI boundary. |
| capabilities | immutable host-derived DshCapabilitySnapshot | Stale/unknown snapshot makes action unavailable. |
| Desktop Main | narrow DshHostManager, DshBridgePort implementation, projection service, and one-account DSH provider resolver | Renderer cannot request arbitrary endpoint/path/command; Main admits exactly one persisted HTTPS `runtimes.dsh` configuration and reads only its independent launch-time key. |
| database | dsh_session_bindings append-only table and migration | duplicate binding, scope mismatch or bad sequence aborts projection. |
| IPC/preload | named, schema-validated DSH session/activity/interaction operations | sender, session ownership and action capability are revalidated in Main. |
| device-link | append-only dsh payload/reducer version | older peer gets explicit compatibility result, no unsafe field coercion. |
| SSH | remote DSH install/probe/forward lifecycle | remote path/credential never falls back to local state. |

## Data Model / Migration Changes

F3 creates the binding table and no destructive schema change. Its logical fields are cindy_session_id,
native_session_id, host_scope_id, runtime_version, controller_api_version, home_mode,
last_projected_sequence, lifecycle_state, created_at and updated_at. The actual naming, SQL types, schema
declaration, migration number and snapshots must follow database-and-migrations.md and the current Drizzle
journal at delivery time.

Foreign-key/action behavior must preserve a DSH session through renderer disconnect, while explicit deletion
executes a native delete only if the gated controller release supports it. Deleting a Cindy task cannot silently
reuse its native id. Migration replay covers legacy cc/codex/pi records, a new dsh record, uniqueness collision,
corrupt binding and an interrupted upgrade.

## Error Handling and Compatibility

- Asset integrity, unsupported platform, handshake/version mismatch, Home initialization, host timeout or crash:
  mark only the affected DSH scope unavailable and keep all existing agents usable.
- Controller disconnect or uncertain send: mark needs-reconcile, follow/history/reconcile first, never resend a
  potentially side-effecting prompt.
- Unknown event/action/API version: fail closed, retain bounded diagnostics and show an actionable unsupported
  or recovery message.
- Permission correlation failure: reject once and clear the pending approval.
- Runtime upgrade: compare evidence/API/capability diff, preserve binding/Home/profile/plugin state or block the
  upgrade with a reversible recovery path.
- DSH unavailable on an old Desktop/Mobile/remote runtime: use explicit platform-limited/not-implemented
  state, not a substituted provider.
- Existing Claude/Codex/Pi rows, IPC and UI must pass regression suites unchanged.

## Files and Subsystems

| Stage | Primary additions or edits |
|---|---|
| F0–F5c | docs/dsh-release-evidence/, verifier, bounded ACP client, Main bridge/binding/projection, current-owner dynamic registration through the generic local create transaction, the narrow Main-roster-confirmed local New Maker text entry, and same-task local cross-process resume only after fresh-list + settled-ledger rehydrate; no remote, Mobile, history synchronization or recovery UI. |
| F1 | packages/maker-core/src/types/, packages/maker-shared/src/, apps/desktop/src/shared/, Desktop Main/preload/renderer unions, packages/device-link, apps/mobile and exhaustive inventory tests. |
| F2 | tools/dsh/, apps/desktop/src/main/agent-binaries/, apps/desktop/src/main/dsh-host/, process monitor and credential adapters. |
| F3–F4 | packages/maker-core/src/agents/dsh/, packages/maker-core/src/types/, Desktop dsh-host bridge/projection, localDb schema/migration/tests. |
| F5–F7 | Desktop maker IPC/preload, renderer session/activity/settings surfaces, i18n, design tokens and internal MCP lifecycle. |
| F8–F11 | Deferred: remote SSH, device-link/Mobile, Orca and release/governance paths require a new user authorization before any implementation or build. |

Names above are planned ownership paths, not permission to alter adjacent modules without their own applicable
rules and focused issue scope.

## Risks

| Risk | Control |
|---|---|
| F0 incorrectly assumes source-tag capability equals shipped runtime capability | One local source-build tuple ties fixed source objects, frozen build inputs, local archive/binary version and real controller fixtures together; it is not release provenance. |
| native event data leaks secrets or gains Renderer privileges | Main-only bridge, schema projection, token-less IPC and redaction tests. |
| DSH id or event sequence crosses account/session/scope | binding uniqueness, scope checks, correlation, monotonic cursor and multi-session tests. |
| Alpha runtime upgrade breaks existing data or plugins | version negotiation, capability diff, compatibility gate and reversible upgrade path. |
| remote path/credential unintentionally runs locally | remote-owned installer/Home/forward plus location assertions and failure-radius tests. |
| `cindy-dsh` activity is confused with Orca | distinct origin and schema; F10 cannot start until proven in all consumer boundaries. |
| “safe” profile silently prevents explicit DSH operation | cindy-managed defaults are safe, but explicit user profile/plugin operations retain recoverable DSH paths. |

## Human Decisions Required

No new product choice is required before F0. The release-evidence reviewer decides only factual admission:

- Cindy Bridge Gate passes: authorize F1–F11 according to the dependency graph.
- Cindy Bridge Gate fails or is incomplete: keep DSH unavailable, retain the evidence, and repair the runtime /
  bridge compatibility. The absence of a separate upstream Host API is not a failure reason.

Every implementation issue must read the specialized rules it touches before changing code. Any proposal to alter
system prompt, protocol service contract, user data compatibility, plugin approval/persistence or Mobile runtime
fingerprint requires the relevant additional confirmation defined by those rules.
