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
| Agent identity 已有四个保留值 | `packages/maker-core/src/types/common.ts` 定义 `AgentKind` 为 claude-code、codex、pi、dsh；`apps/desktop/src/shared/agentKindConversion.ts` 对已存在的 dsh 严格 round-trip | F1 已完成本机 Desktop 身份闭合；未知显式值失败，不得回退。受管会话与 runtime 注册仍留给 F2/F3。 |
| Agent adapter 是显式 export | `packages/maker-core/src/agents/index.ts` 只 export ClaudeCodeAgent、CodexAgent、PiAgent，刻意不注册 DSH adapter | F1 的 dsh 不能被 Maker 当作 Claude Code 或任一已注册 agent 运行；F3 才能经受限 Host-injected port 添加 DshAgent。 |
| 通用事件已可保留 dsh source | `packages/maker-core/src/types/events.ts` 已加入 dsh source，但没有 DSH raw event 投影 | F4 仍必须以有限、版本化的 generic activity 契约扩展，不能放任 raw DSH JSON。 |
| Desktop 的 native binary 管理已经存在 | apps/desktop/src/main/agent-binaries/index.ts | F2 在该边界增加 optional dsh asset；Renderer 不获得 binary path 或下载权。 |
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

F2 may later create tools/dsh/latest.json and tools/dsh/update.mjs plus Desktop Main dsh-host modules, but those
distribution/update paths are deferred in the current local-only scope. If reauthorized, the asset descriptor is
optional and directory-based, with installSubdir dsh. The updater must:

1. receive only a user-authorized, integrity-verified archive built from a reviewed source tag→commit→tree pin
   rather than discover a mutable “latest” release; release provenance has its own future gate;
2. download into a staging directory, validate archive hash before extraction, reject traversal, symlink,
   special-file, unexpected top-level file and missing-sidecar cases;
3. validate executable mode and the full extracted-tree manifest before producing the Cindy archive;
4. validate the archive hash and the extracted-tree manifest again at install time;
5. register no DSH asset on unsupported platforms and never call PATH, npm, pnpm, pip, curl or a system Node
   fallback.

The supervisor launch boundary accepts no caller-provided executable, sidecar, command, argument or ambient
environment. It resolves the selected executable and every required sidecar with `realpath`, proves each remains
inside the just-verified installation root, then requires a regular executable with the recorded digest/mode.
The launcher constructs the fixed command and an allowlisted environment itself; this check happens again after
staging-to-live promotion, before every product spawn.

DshHostManager owns a scope key of account scope, runtime release, execution location and Home mode. It creates
a non-project launcher cwd and one explicit DSH_HOME. cindy-managed roots live below Electron userData; staging
and run material use task-specific temp directories. existing-dsh-home is an explicit non-secret override only.
A scope starts lazily, performs a version/ACP-capability handshake before it is visible, has health probing and
uses quiesce -> flush -> close -> TERM -> bounded KILL. A failure disables only that DSH scope.

Main obtains credentials from the existing secure store, passes only named secrets through a whitelist child
environment, redacts bounded stderr, and removes temporary materials after failure, cancellation, account switch
and quit. Neither argv, DB, profile, diagnostics, IPC nor Mobile payload contains a secret.

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

F5 adds DSH to the existing session chooser, create/resume flow, capability-gated composer, model/effort
controls, attachments, session history, approval and recovery states. New preload channels are schema-validated
and action-specific; they do not expose generic invoke, endpoint, Home path or command execution. All user text
uses the glossary and five locales; styles use semantic tokens for both themes.

F6 adds Cindy-owned structured activity panels for plan/todo, command/elicitation, terminal, task/job/workflow/schedule.
Terminal objects are owner-scoped and use explicit attach/input/signal/close actions; a terminal is not tool
output. Each supported object must have observed identity, allowed actions, cancel/disconnect behavior and
recovery limitation. `cindy-dsh` activity never writes Orca tables or becomes an Orca worker; it is never
labelled as a DSH-native UI object.

F7 gives the user a mode selector for cindy-managed versus existing-dsh-home and native settings/projection for
MCP, skills, profiles, plugins and extensions. Cindy-internal MCP is a separate source with Main-created
allowlisted transport, per-session token, lease and cleanup generation. User-native configuration preserves
DSH native semantics; Cindy may explain consequences and offer recovery, but may not make explicit native
installation/update/self-repair impossible.

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
| Desktop Main | narrow DshHostManager, DshBridgePort implementation, projection service | Renderer cannot request arbitrary endpoint/path/command. |
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
| F0 | docs/dsh-release-evidence/, verifier, bounded ACP client and Desktop Main unregistered bridge core with test fixtures; no production registration. |
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
