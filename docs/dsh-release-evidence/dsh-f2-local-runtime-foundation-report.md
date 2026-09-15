# DSH F2 Local Runtime Foundation Report

Result: **LOCAL-PARTIAL — the current build.9 source tuple, signed-Helper lifecycle, Cindy's own locally packaged `darwin-arm64` App, Main-owned provider route and real loopback prompt/cancel evidence pass locally. F5a dynamically registers the local DSH agent only after current-owner/provider/key revalidation and a verified Helper handshake. F5b adds only a Main-roster-gated, text-only local New Maker entry and preserves that boundary in the resulting task composer; recovery, remote and Mobile remain unavailable. The build.9 sealed `@yao-pkg/pkg` cache chain has a release-bound local archive/manifest and 7/7 packaged-App loopback E2E, but no dynamic-native tool or user-visible capability acceptance.**

Date: 2026-09-03, updated 2026-09-05
Requirements: [`dsh-native-integration-requirements.md`](../issues/dsh-native-integration/dsh-native-integration-requirements.md)
Specification: [`dsh-native-integration-technical-spec.md`](../issues/dsh-native-integration/dsh-native-integration-technical-spec.md)
Plan: [`dsh-native-integration-development-plan.md`](../issues/dsh-native-integration/dsh-native-integration-development-plan.md)

## Build.9 current local rebuild and package (2026-09-05)

- `cindy-dsh-0.1.2-alpha.3-build.9-macos-supervised` declares six source adaptations and an archive-bound,
  Helper-signed `@yao-pkg/pkg` native-cache tree. Its source patch selects only the required `darwin-arm64`
  `sharp`, `koffi` and `node-pty` native entries from a freshly deployed closure; it never reads or copies a
  user Home cache.
- Local archive-shape, staging and native-supervisor environment tests passed, as did a fresh detached source-tree
  adaptation apply/verify check. The staged cache is a signed Helper resource and the patched prelude fails closed
  rather than extracting to a writable cache.
- The exact release-pinned Node and pnpm input archives were supplied from local verified inputs. A fresh local
  source checkout was rebuilt with the release-bound wrapper; because its private pnpm store began empty, the locked
  dependency fetch downloaded packages into that temporary store. It made no upstream source `git fetch`, remote
  build, CI run or Git remote write. The resulting archive SHA-256 is
  `19d70a9f5346e99fd21680d176c3a4639eb04951fb58e22da8bf8c1a38e99db1`; the manifest SHA-256 is
  `4166814bf9f1281ab4677549ee853476994f1c31605a74e35b20ebddd2dfa92e`.
- The local package command rebuilt and signed Cindy's `darwin-arm64` App, staged the fixed Helper, and passed its
  loopback packaged-App suite 7/7. This is not a dynamic-native tool run, user-visible capability acceptance or a
  release claim, and it does not release the capability floor.
- `build:dsh:local-macos` is the single reproducible local build entrypoint. It preflights the source tuple,
  toolchain digest, Node SHA-256 and pnpm SRI before applying adaptations; it builds through a temporary HOME/cache
  and wrapper-only `PATH`, then packages and re-verifies the local archive. Its build.9 result remains local-only and
  requires the same verified input set for any future rebuild.

## Delivered and verified

- [`tools/dsh/latest.json`](../../tools/dsh/latest.json) is a local-only `darwin-arm64` pin for the exact F0
  source-built archive. It fixes archive name, byte length and SHA-256 plus all executable/sidecar tree entries;
  it contains no URL and no runtime bytes.
- [`tools/dsh/update.mjs`](../../tools/dsh/update.mjs) accepted a current F0 bundle manifest and explicitly supplied
  local archive only after `verifyReleaseBundle`; it copied neither source checkout nor a user-installed DSH binary.
  A stale F0 manifest that still declared non-macOS targets was rejected before import.
- [`local-runtime.ts`](../../apps/desktop/src/main/dsh-host/local-runtime.ts) verifies the pin before extraction,
  checks the promoted tree again, and rechecks realpath, file type, mode and SHA-256 before every future launch.
  Unit tests cover unsupported platform, mismatched bundle, archive tree mismatch and post-install symlink mutation.
- The opt-in local integration test installed the fresh F0 archive to a unique temporary user-data-shaped root,
  then passed `--version` and Desktop Main ACP `initialize → create → close` using the installed executable.
- [`scope.ts`](../../apps/desktop/src/main/dsh-host/scope.ts) and
  [`host-manager.ts`](../../apps/desktop/src/main/dsh-host/host-manager.ts) passed unit tests for hashed account
  scopes, managed Home, non-project launcher cwd, allowlisted memory-only child environment, single-flight start,
  failed-start cleanup and account-switch teardown. Managed scope components are created one direct real directory
  at a time, so a pre-existing `dsh-agent-home` symlink is rejected rather than followed. Existing DSH Home remains
  non-secret metadata only and cannot execute before F7.
- [`macos-supervised-source-release.json`](../../tools/dsh/macos-supervised-source-release.json) defines the
  local-only `darwin-arm64` build.9 source release. Its six reviewed adaptations pin the Node target, prevent an
  implicit pnpm install during runtime-closure validation, seal the staged bootstrap and pkg native caches, bind the
  deploy policy to the verified lockfile, and impose an ACP-MVP capability floor. The capability-floor adaptation
  digest is `25b4a62d85f2bcbd042420a3097ce96e4345eab587b80301ab4e6a5070380865`. Build.4 and older artifacts are
  historical evidence only; they are not admissible build.9 package inputs.
- Source-input verification is offline by construction: the local checkout must already contain the pinned
  HEAD/tree/tag, and a missing tag fails closed instead of running `git fetch` or contacting an upstream remote.
- The capability floor disables `attachment-local`, `subprocess`, `sandbox`, `bash-sandbox`, `permission`,
  `tool-bash` and `tool-fs-search`. It is a deliberate MVP restriction: `sharp` and `koffi` otherwise extract
  dynamic native modules into a mutable SEA cache, while `node-pty` is absent from the closed runtime graph.
  These capabilities were neither enabled nor claimed.
- [`macos-dsh-sandbox-supervisor.c`](../../apps/desktop/native/dsh/macos-dsh-sandbox-supervisor.c) accepts only
  `--version` or `--profile acp`, derives runtime and native-cache paths from its own signed App bundle, applies a
  strict environment allowlist, injects the sealed-cache marker, and performs bounded process-group cleanup.
  A fresh ad-hoc signed local test App signed the runtime/sidecars with sandbox-inherit plus JIT entitlement and the
  bootstrap addon cache with runtime signing; `codesign --verify --deep --strict` passed.
- In the earlier signed test App's own container, the supervisor passed `--version` and the no-credential public ACP
  lifecycle `initialize → new → idle cancel notification → close → list → resume → close`. The lifecycle smoke does
  not send a model prompt, credential, network request, or privileged tool request.
- [`stage-dsh-macos-supervised-runtime.mjs`](../../apps/desktop/scripts/stage-dsh-macos-supervised-runtime.mjs)
  is an opt-in local Forge post-package hook: it accepts only the exact checked-in build.9 release plus an explicit
  local archive/manifest pair, then stages a separately signed `Cindy DSH Supervisor.app` under the parent app's
  `Contents/Helpers`. Runtime, sidecars and sealed addon cache live inside that Helper.app's `Contents/Resources`;
  this avoids a parent-app re-sign overwriting the runtime's sandbox-inherit entitlement. A fresh nested-helper
  probe retained that entitlement after the parent App was signed, passed `codesign --verify --deep --strict`, and
  passed the same ACP smoke using the Helper.app's own sandbox container.
- [`package-dsh-local-macos.mjs`](../../apps/desktop/scripts/package-dsh-local-macos.mjs) is the local-only
  `darwin-arm64` Cindy package-evidence command. It requires an explicit direct local build.9 archive/manifest pair,
  uses no runtime download, excludes remote-agent bundles and iOS preparation, and fails if local ripgrep is absent,
  stale, symlinked or an LFS pointer. It stages the separately signed Helper into Cindy's real `Cindy.app`, re-signs
  ordinary Electron Mach-O code inside-out without modifying `Contents/Helpers/Cindy DSH Supervisor.app`, verifies
  the completed App signature and Helper entitlements, then runs the real packaged-app E2E.
- [`macos-supervised-runtime.ts`](../../apps/desktop/src/main/dsh-host/macos-supervised-runtime.ts) is the F2
  Main-only composition for that packaged Helper.app. It accepts only `darwin-arm64`, fixed `Contents/Helpers/Cindy
  DSH Supervisor.app` paths and a signed helper descriptor that matches both actual bundle identifiers. It rechecks
  runtime/sidecar/addon source/cache topology, starts only the fixed native supervisor (never the runtime path),
  binds request release identity to the verified runtime and creates cindy-managed Home/launcher paths inside the
  Helper.app container rather than Cindy parent `userData`. Before spawn it resolves each scope/Home/launcher/temp
  directory again and rejects any lexical Helper-container path that a symlink redirects outside. The packaged parent
  is App Sandbox signed with the user-selected-directory and app-scoped-bookmark entitlements; the nested Helper has
  only the narrower App Sandbox and network-client entitlements, so persistent selection authority remains in Main.
- The opt-in factory E2E used the fresh local signed test App—not a PATH or F0 importer—to execute
  `DshHostManager → DshAcpClient → fixed Helper.app supervisor → ACP initialize`, then tear down. It asserted the
  hashed scope's `process-home` and `dsh-home` existed below the Helper.app container and cleaned only that random
  test scope.
- The authorized network foundation is now intentionally split: only the Helper.app carries
  `com.apple.security.network.client`; [`provider-route.ts`](../../apps/desktop/src/main/dsh-host/provider-route.ts)
  admits a Main-created exact HTTPS origin or literal IPv4 loopback E2E route, with no default external endpoint;
  [`scope.ts`](../../apps/desktop/src/main/dsh-host/scope.ts) supplies endpoint/key only as the two fixed child
  variables after route admission. The ACP profile is atomically rewritten from a fixed, secret-free source and
  the native supervisor discards all other ambient `CINDY_DSH_*` values. Staging verifies the *signed* Helper
  contains both required entitlements. The Main route removes a terminal `/` before injection because the selected
  DeepSeek adapter appends `/chat/completions`; this keeps root-origin input identical to the source-runtime control
  path. This is a code/test result, not a destination restriction supplied by macOS App Sandbox.
- The strict signed-Helper prompt fixture is deliberately narrower than a generic OpenAI-compatible mock: it accepts
  only `POST /chat/completions`, an exact fixture Bearer token and bounded JSON shape. The first signed-Helper run exposed
  that Main's URL serialization retained a root terminal slash while the selected adapter appends its own leading
  operation slash. Main now canonicalizes away that terminal slash. The same real user-container signed-Helper E2E
  then passed: it accepted two exact loopback completions, committed the first turn's text and usage projections,
  cancelled the second turn through public ACP, acknowledged both durable receipts, and found no runtime id or fake
  key in the safe projection/persistence boundary. The fixture was not widened.

## Commands and results

- `pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/local-runtime.test.ts src/main/dsh-host/__tests__/scope-and-host-manager.test.ts`: 14 passed.
- `pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/scope-and-host-manager.test.ts src/main/dsh-host/__tests__/macos-supervised-runtime.test.ts`: 13 passed, including pre-existing and post-scope symlink-escape rejection.
- `CINDY_DSH_F2_E2E_ARCHIVE=<local-f0-archive> CINDY_DSH_F2_E2E_MANIFEST=<local-f0-manifest> pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/local-runtime.integration.test.ts`: 1 passed.
- `node tools/dsh/update.mjs --bundle-manifest <local-f0-manifest> --archive <local-f0-archive> --output-dir <fresh-local-directory>`: PASS.
- `node scripts/dsh-source-build-release.mjs verify-adaptations --release tools/dsh/macos-supervised-source-release.json --repo-root . --source-root <fresh-exact-source>`: PASS (6 adaptations).
- 2026-09-05 fresh build.9 source build: `pnpm build:dsh:local-macos -- --release <checked-in-release> --repo-root <repo> --source-root <fresh-local-checkout> --node-archive <verified-local-node-archive> --pnpm-tarball <verified-local-pnpm-tarball> --output-dir <fresh-local-output>`: PASS. Source tuple and release-bound toolchain were checked before adaptation; the clean private pnpm store downloaded the locked dependency set, then runtime closure reported 4 agent presets and 126 workspace packages. This is local compilation evidence, not an offline-build claim.
- `node scripts/dsh-macos-supervised-runtime-smoke.mjs --release tools/dsh/macos-supervised-source-release.json --target darwin-arm64 --supervisor <signed-test-app-supervisor> --container-root <that-app-container>`: PASS for `initialize → new → idle-cancel-notify → close → list → resume → close`.
- `CINDY_DSH_E2E_APP=<signed-test-app> CINDY_DSH_E2E_HOME=<local-user-home> CINDY_DSH_E2E_RELEASE_ID=cindy-dsh-0.1.2-alpha.3-build.4-macos-supervised CINDY_DSH_E2E_PROMPT=1 pnpm --filter desktop exec vitest run src/main/dsh-host/__tests__/macos-supervised-runtime.integration.test.ts`: PASS — 3/3 against a real macOS user-container signed Helper.app: lifecycle, F3 durable create/close binding, and the strict loopback `create → prompt → committed text/usage projection → prompt → cancel → close` receipt path.
- `pnpm --filter desktop package:dsh:local-macos --archive <local-build.9.tar.gz> --manifest <local-build.9.json> --region global`:
  PASS — real local Cindy `darwin-arm64` App package completed, staged exact build.9 Helper/runtime paths, preserved
  the separately signed Helper entitlements after Electron's inside-out re-sign, passed independent
  `codesign --verify --deep --strict` checks for Cindy, Helper and the Main bookmark bridge, and ran the signed-Helper
  suite against the produced `Cindy.app`: **7/7 passed** (lifecycle, durable binding, internal MCP lease,
  Cindy-owned activity mutations, same-task fresh-bridge continuation, prompt/cancel/close, and committed follow
  projection). The command ended with `DSH_LOCAL_MACOS_PACKAGE_VERDICT=ready`.
- A no-network macOS Seatbelt shell-descendant fixture passed: a background child could write only its dedicated
  temporary directory and could not write its sibling path. This demonstrates inheritance only, not DSH compatibility.
- Final local audit regression: `node --test scripts/__tests__/dsh-native-host-gate.test.mjs scripts/__tests__/dsh-pnpm-build-wrapper.test.mjs scripts/__tests__/dsh-source-build-release.test.mjs`: 34 passed, including a source checkout with no `origin` whose missing local tag fails closed.
- Final Desktop regression: the scoped DSH host, ACP transport and control-plane suite reported 43 passed and 6
  intentionally opt-in tests skipped; the actual signed-Helper factory lifecycle was then run with its local inputs
  and passed (1/1). `pnpm --filter desktop run --if-present typecheck`, `pnpm check:dev-docs`, and `git diff --check`
  also passed.
- The final local security diff audit was sealed with no surviving reportable finding before the later provider-route
  hardening. The terminal-slash canonicalization was then covered by unit tests and the strict real signed-Helper
  E2E above. It includes the repaired
  pre-existing managed-scope symlink escape and the offline source-input enforcement; its audit artifacts remain
  local session evidence and are not repository deliverables.
- 2026-09-04 local regression: `pnpm --filter desktop run --if-present typecheck`; focused route/scope/Helper
  composition tests (21 passed, 3 opt-in signed-Helper E2E tests skipped); the DSH storage/control-plane and
  translator suite (85 passed, 6 intentionally skipped); and
  `node --test scripts/__tests__/dsh-native-host-gate.test.mjs` (14 passed) all passed. The current source-runtime
  ACP control-plane E2E then passed all 5 cases, including the capability-floor assertion that an escalated tool
  produces no public `session/request_permission` and no fixture write.

## Not proved and therefore unavailable

- The DSH Settings/configuration boundary now accepts only one closed `runtimes.dsh` shape (`HTTPS baseUrl`, empty
  `models`, API-key auth and no headers/model-routing fields). It stores an independently scoped
  `provider_key_<providerId>_dsh` key, rejects a changed endpoint without a replacement key, and makes zero,
  multiple, malformed or keyless DSH configurations unavailable in Main. The resolver returns only display-safe
  provider metadata plus a Main-only launch-time secret loader; it neither starts a Helper nor accesses an external
  endpoint. Generic connection-test/model-fetch IPC deliberately rejects `dsh`.
- The historical F2 factory-only boundary is no longer the current F5a state: Desktop Main now registers the
  fixed-Helper bridge only after it has resolved exactly one valid DSH provider, loaded the separately scoped secret
  in Main, verified the packaged Helper topology, and reserved the exact local Cindy session/CWD admission. Failed
  Helper discovery, missing local macOS arm64 resources, stale owner/provider state, or a registration race leave
  DSH unavailable rather than falling back to a user-data, PATH, or source-runtime launch. F5b adds no generic
  provider selector: only the locally registered roster may expose a managed-runtime marker in New Maker, and the
  Main IPC parser rejects a renderer-selected provider or any other model value. Remote, Mobile, attachment,
  history/recovery and cross-device capability remain unavailable.
- The completed local Cindy package is an ad-hoc `darwin-arm64` evidence artifact only. The dedicated command
  intentionally excludes remote-agent bundles and iOS preparation; normal package/release flows have no DSH
  resources. Developer ID signing, notarization, installers, distribution, upload/attestation and every other
  platform remain unproved and unauthorized. Any later release claim needs fresh signed-Helper verification of that
  exact artifact while retaining the Helper-container `DSH_HOME`/`TMPDIR` boundary; substituting Cindy `userData`
  would be rejected by the helper sandbox.
- The no-network macOS Seatbelt experiment remains a negative result. Shell → `sandbox-exec` → installed DSH
  `--version` exited successfully, but Node/Desktop Main `spawn()` of the same binary/profile exited `SIGABRT`
  before ACP initialize (with and without a detached process group). This is why F0 user-data import stays
  admission-only. The later signed-App supervisor passes only the restricted no-credential lifecycle; it is not
  evidence for dynamic native tools, permissions, complete descendant cleanup, durable recovery or production
  compatibility. The controlled provider route is unit-tested and the signed-Helper prompt/network E2E now
  passes the fixed loopback contract. This proves only the named local contained sequence, not a production endpoint,
  generic egress restriction enforced by macOS, dynamic native tools, complete descendant cleanup, durable recovery,
  Renderer selection, or a general-release acceptance result.
- No remote runner, GitHub Actions, artifact upload, release, Linux, Windows, Intel macOS, SSH, Mobile or upstream
  operation was run or claimed. The current fresh build did download its lockfile-pinned dependency set into a
  temporary private store; it did not fetch DSH source, download a runtime release, or write any Git remote.
