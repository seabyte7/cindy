# DSH F6 local activity slice — local evidence

Status: **local session-lifecycle and Cindy-owned plan/todo slice delivered; F6 control plane is not complete.**

## Delivered boundary

- `packages/maker-core/src/agents/dsh/activity.ts` defines the closed, versioned `cindy-dsh` activity object and
  reducer. Every object carries an opaque Cindy activity id, Cindy task id, Main-owned scope id, optional
  parent id, finite status, stable display code, allowed named actions and per-object revision.
- The reducer rejects unknown contract fields, invalid ownership trees, stale snapshot sequence, stale object
  revision, illegal transitions and actions not currently admitted. Disconnected and terminal objects are
  observe-only; reconnect is an explicit mutation and never infers a native outcome.
- `apps/desktop/src/main/localDb/dshActivitySnapshots.ts` persists only a canonical, validated snapshot for an
  existing DSH binding. It checks the SHA-256 digest, exact scope/task ownership, stored sequence and JSON shape;
  mutation writes use a scope-and-sequence compare-and-set.
- Migration `0103_stiff_captain_america` adds `dsh_activity_snapshots`. It is additive, references the existing
  DSH binding, and leaves Claude/Codex/Pi and Orca tables untouched.
- `DshControlPlane` projects only already-known lifecycle facts into the one `session` root: acknowledged public
  ACP create, close and verified resume, plus fresh-bridge restoration and carrier EOF. Restoration and EOF make
  the root `disconnected` and observe-only; only a verified resume reconnects it. Before an EOF's binding/activity
  SQLite writes are awaited, Main synchronously revokes the per-scope local activity write admission. Thus a
  stale `active` binding/root view cannot admit a plan/todo mutation during that projection interval. A projection
  failure tears down the carrier and leaves the durable binding to reconcile.
- Production composition in `maker-host/index.ts` supplies this store from the same owner-scoped local DB client
  as binding, prompt-receipt and projection-journal stores. F6-2 adds only the narrow, display-safe IPC/preload
  capability documented below; no bridge or store capability reaches the renderer.
- F6-2 adds a strictly local plan/todo layer. `DshActivityControlService` accepts only five named operations:
  read, create a local plan, create a local todo under that plan, complete, and cancel. It first proves that the
  current owner-local session is an active `dsh` task with an active binding, a `running` session root and an
  explicit current-Main write admission, uses the binding's private scope internally, and never accepts a
  renderer-supplied reducer mutation, ACP object, runtime id, command, prompt, terminal data, provider route, or
  host scope.
- A plan/todo label is a bounded, Cindy-authored local label. It is optional in the v1 object schema solely to
  keep already-persisted F6-1 session roots readable; it is never populated from an ACP update. The Main handler
  permits only `complete` and `cancel` on a local plan/todo that currently advertises that named action. A plan
  cannot be closed while it has a nonterminal todo, so an active child is never silently orphaned. When the session
  root is disconnected, the durable binding is inactive, or Main has synchronously revoked current-carrier write
  admission, every local child is projected with `observe` only and every local mutation is rejected until Main
  has verified a resume.
- `maker:dsh-activity:read`, `maker:dsh-plan:create`, `maker:dsh-todo:create`,
  `maker:dsh-activity:complete`, and `maker:dsh-activity:cancel` are trusted-renderer, local-only IPC channels.
  Their payloads are closed schemas and return a display-safe projection without host scope, Cindy task id,
  runtime id, ACP update, endpoint, profile, or credential. They are not device-link channels.
- `DshActivityPanel` renders this local plan/todo projection in the existing DSH task composer stack. It uses
  semantic tokens, five locales, accessible controls, loading/retry state and no native-DSH branding claim. The
  panel explicitly says its data is saved by Cindy locally and is not sent to the DSH runtime. A disconnected task
  displays an explicit read-only recovery boundary rather than stale create/complete/cancel controls. A rejected
  mutation, an in-flight mutation, or an explicit refresh in progress similarly removes every write control from
  the cached projection; only a successful explicit Main read restores them. This prevents retries from treating a
  stale Renderer snapshot as a new admission.

## Deliberately not delivered

Only the Cindy-owned session root and locally-authored plan/todo objects are shipped. There is no native
plan/todo source or action, approval UI, command/elicitation/job/workflow/schedule creator, terminal
attach/input/signal/close route, device-link/Mobile route, remote host route, or Orca integration. The current
macOS-local ACP evidence does not admit those native APIs; the local plan/todo slice makes no such claim.
Consequently F6 cannot be described as a complete activity-control feature and it does not place any object in
Orca storage or UI.

## Local verification

- `pnpm --filter @cindy/maker-core exec vitest run src/agents/dsh/activity.test.ts` — PASS, 19 tests: every
  defined object kind, valid terminal states, parent/scope ownership, bounded local labels, stale
  sequence/revision, action admission, disconnect/reconnect and unknown-field rejection.
- `pnpm --filter desktop exec vitest run src/main/localDb/__tests__/dshActivitySnapshots.test.ts` — PASS, 7
  tests: closed/canonical persistence, scope isolation, stale writes, read-only disconnect, action admission and
  corrupt snapshot rejection.
- `pnpm --filter desktop db:check` — PASS.
- `pnpm --filter desktop exec vitest run src/main/localDb/__tests__/migrationReplay.test.ts` — PASS, 6 tests.
- `pnpm --filter desktop exec vitest run src/main/maker-host/__tests__/dshActivityControl.integration.test.ts src/main/maker-host/__tests__/dshActivityControl.test.ts src/main/maker-ipc/__tests__/dshActivityHandlers.test.ts src/renderer/features/cc-agent/__tests__/DshActivityPanel.test.tsx` — PASS,
  16 tests: the local controller enforces active DSH/binding/session-root/current-Main-admission/parent-child
  boundaries, freezes every local child during disconnect, rejects immediately after synchronous carrier admission
  revocation, prevents plan closure with open todos, redacts internal owner fields, rejects generic/raw IPC input,
  and renders/calls only narrow local UI operations. The panel additionally fails closed for rejected, concurrent,
  and revalidation-in-flight mutations. The integration case uses SQLite and a fresh controller to
  prove restart-safe persistence without exposing the native binding in either the persisted activity snapshot or
  its renderer-safe projection.
- `pnpm --filter desktop exec vitest run src/main/maker-host/__tests__/dshControlPlane.test.ts src/main/maker-host/__tests__/dshSessionActivity.test.ts` — PASS, 46 tests: only acknowledged lifecycle facts reach the
  Main-only coordinator, carrier EOF synchronously revokes local write admission before the durable disconnect
  projection, EOF becomes observe-only, and a persistence failure fails closed.
- `pnpm --filter desktop run --if-present typecheck` — PASS.
- A post-F6-2 local `darwin-arm64` Cindy.app was produced from the fixed archive, then passed
  `codesign --verify --deep --strict`; its fixed Helper.app has both required `app-sandbox` and
  `network-client` entitlements.
- The package script's signed-Helper E2E command, rerun directly against that app with its local loopback fixture,
  passed 6 tests: ACP startup/teardown, create/close activity persistence, same-task fresh-bridge resume, Maker
  cancel/close, committed follow projection, and a real Helper-backed F6 plan/todo round trip. The F6 case creates
  a bound DSH task, creates, completes and cancels Cindy-local plan/todo trees through the production activity controller,
  verifies its SQLite view never contains the native runtime id, and proves bridge close makes every local action
  read-only. It deliberately exercises Main's activity control rather than a browser-driven panel; the panel's
  narrow-IPC behavior remains covered by its component contract test. This is local macOS evidence only, not
  release/distribution evidence.
- A fresh isolated local Desktop instance proved that the dev CDP renderer channel itself is available and that the
  local task UI can be reached without a cloud login. It did **not** produce a DSH-panel E2E: product registration
  correctly admits only a persisted Main-owned HTTPS DSH provider, whereas the hermetic fixture is literal HTTP
  loopback and is admitted only through test injection. No dev-only provider bypass, insecure TLS exception or
  renderer configuration escape was added merely to make a browser test pass. Browser-driven DSH-panel evidence is
  therefore still absent; it needs a separately reviewed test harness that preserves the production route policy.

The broad maker-core typecheck remains blocked by unrelated existing test-source errors outside the DSH activity
files. No commit has been made, so the repository's pre-commit related-test/DCO gates have not been claimed.
