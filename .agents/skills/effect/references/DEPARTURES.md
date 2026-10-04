# Known departures

Places where the repo does not yet meet the target. They are here so nobody copies them, and so a change that passes through one knows what to move it to.

- Entries come from a source survey on 2026-10-03. None was reproduced at runtime, so read the code before acting on one.
- Fix a departure when your task already changes that code. Otherwise leave it and say you saw it.
- Delete an entry in the change that fixes it. Add one when you find a new departure.

## Runtimes and edges

- **Scan jobs owned by React and a module runtime.** `apps/mobile/src/scan/drafts.tsx` creates a module-level `ManagedRuntime`, keeps the parse queue and worker lifetime in React, and publishes draft edits before detached persistence finishes. Persistence failures are logged and ignored. Target: a scoped scan-job service owns state and persistence; React observes it. `PersistedQueue` was evaluated on 2026-10-04 and rejected: it would duplicate `draft.json`, which already is the durable acceptance boundary. Source audit: 2026-10-04; no runtime failure reproduced.

- **What the writer still does outside its layer graph.** The session is built after boot, in a scope `ReleaseForRestore` can close, so the per-port `InventoryStore` server receives it, with the session's one `CommandAdmission`, through `Layer.succeedContext(session)`, and `ReleaseForRestore` takes that admission's exclusive turn. The live socket's `accessToken` option is a Promise callback, so the worker re-enters with `Effect.runPromise(http.liveAccessToken(options))`. Engine errors still collapse to `ReplicaWorkerFailure { message }` on the main-facing `ReplicaWorkerRpcs`; the renderer-facing `InventoryStore` carries the typed `CommandFailure`. Target: `OwnedLiveHost.accessToken` takes an `Effect`; `ReplicaWorkerRpcs` errors become a tagged union.
- **The mobile host runtime is never disposed.** `createMobileInventoryHost` in `apps/mobile/src/inventory/host.ts` makes one `ManagedRuntime` that owns the database locks and is the context every session and its callback runtime runs in. The host is created in a `useMemo` at the app-root provider and lives as long as the JS process; React has no disposal point that survives a StrictMode remount, so the runtime is not disposed. Each session's resources are scoped to the workspace that opened it, not to this runtime. Target: dispose it when the provider gets a lifetime owner outside React.
- **Renderer RPC clients outlive their atom runtime by 10 s.** `outlivingItsRuntime` in `packages/inventory-react/src/services.ts` builds each `RpcClient` in a scope it closes on a detached, delayed fiber. Measured on effect 4.0.0: when the ports atom changes, `Atom.runtime` disposes the old layer scope before dependants detach, and the `RpcClient` scope finalizer interrupts every in-flight entry synchronously. Without the linger a mounted read shows `Failure(interrupt)` twice before the rebuilt runtime answers, and an in-flight command reports an interrupt where `generationMoved` should report `ReplicaUnavailable { reason: "restarting" }`. With it the read goes `waiting` to `Success`. The cost is one read re-sent on the dead port. Target: drop it when `Atom.runtime` detaches dependants before closing the previous scope, or when `AtomRpc` exposes a client lifetime.
- **`Effect.run*` on the default runtime inside adapters.** `packages/inventory-react/src/workspace.ts`, `apps/web/src/session/workspace-session.ts`, `apps/desktop/electron/{replica-ipc,updater,workspace-sessions}.ts`. Target: the adapter's one runtime, `FiberMap.runtimePromise` or `FiberSet.makeRuntime` for callback entry, `Stream.callback` for subscriptions.
- **Several independent runtimes in the renderer.** The auth host, the three `AtomRpc` clients (`Reads`, `Store`, `Insights`, which share `Atom.context()` and its memo map) and two preference `Atom.runtime`s over the same storage share no services, logger or tracer. Target: one host layer, with atoms sharing its built context.
- **`Effect.runFork` and `Effect.runPromise` in React code.** `apps/web/src/components/insights/restock-page.tsx`, `apps/web/src/lib/inventory/preload.ts`, and the `InventoryActions` Promise methods in `packages/inventory-react/src/workspace.ts` (one `runPromiseExit` per command, because forms and route loaders await them). Target: an atom or the host facade.

## Services and layers

- **Tags without layers in `apps/server`.** `InventoryCommands`, `InventorySnapshots`, `InventoryImports`, `InventoryDevices` and `LiveFanout` are built by free `makeX(db)` functions and wrapped in `Layer.succeed` in `apps/server/src/http/app.ts`. Target: each service owns a layer that yields its database dependency; the Alchemy init effect bridges the built handle once.
- **Four layer spellings and two interface suffixes.** `X.layer`, `xLayer`, `layerX`, `XLive`; `XApi` and `XContract`. Target: the naming table in [services and layers](SERVICES_LAYERS.md), with the interface inline.
- **Unnamed service methods.** `packages/workspace` (`SessionHttp`), `packages/inventory-react` and most of `apps/desktop` use `Effect.gen` where `Effect.fn("Service.method")` belongs, so their traces have no spans.

## Errors

- **Plain `Error` in `E`.** `apps/desktop/electron/{workspace-sessions,auth-ipc,auth}.ts`.
- **Absorbing `default:` branches.** `apps/server/src/http/sync-errors.ts`, and `protocolDisposition` in `packages/sync/src/transport.ts`, where every protocol code without its own rule becomes a `protocol` suspension. A new case is silently treated as the generic one.
- **Mixed construction and tags.** `X.make({...})` beside `new X({...})`; dotted tags in `apps/auth` and `packages/workspace` beside class-name tags elsewhere. Dotted tags that cross the wire are contracts.

## Hand-rolled

- **Two model-generation integrations.** Global search uses `LanguageModel.generateObject`, while scans and invoice extraction use `GenerateModelJson` and a second Workers AI wrapper. Reuse the existing provider adapter after adding per-operation token budgets and preserving tolerant extraction/JSON-recovery behavior. Document conversion remains separate.
- **Mutable `Map` and `let` state beside Effect primitives.** `apps/desktop/electron/{workspace-sessions,replica-ownership,replica-backup}.ts`, the access-token listener set in `apps/desktop/electron/auth.ts`, `packages/inventory-react/src/{workspace,preferences}.ts`, `apps/web/src/web/app-host.ts`.
- **The `crypto` global in Effect code.** `apps/server/src/inventory/postgres.ts`, `packages/sync/src/engine.ts` (`makeClaimId`), `apps/desktop/electron/{workspace-sessions,replica-backup}.ts`, `packages/client-db/src/replica/node-sqlite.ts`, `apps/web/src/lib/first-party-auth.ts`, `packages/auth/src/jwt.ts`. Target: `Crypto.Crypto`, whose layer is `packages/auth/src/web-crypto.ts`.
- **`Date.now()` and `setTimeout`.** `packages/inventory-react/src/atoms.ts` and UI code in `apps/web`.
- **A hand-written cross-tab storage atom** beside `Atom.kvs` in `apps/web/src/lib/preferences.ts`. The installed `Atom.kvs` and `KeyValueStore.layerStorage` do not subscribe to storage events; preserve cross-tab adoption and reading current storage before applying an update. `Atom.kvs` alone is not a replacement.

## Tests

- **Only `packages/sync` uses `@effect/vitest`.** Every other package wraps `Effect.runPromise` in a local `run` helper and uses real time. Target: `it.effect`, `layer(...)`, `TestClock`.
- **No reusable test layers.** Doubles are ad hoc objects in each harness.

## Needs the user's decision

These are architecture choices, not refactors. Raise them; do not start them inside another task.

- **Electron main as one layer graph.** `apps/desktop/electron/main.ts` is an async bootstrap with module-level handles and a broker per concern. The target shape is Electron APIs wrapped as services and one program under `NodeRuntime.runMain`. It changes startup order, so cold start must be measured before and after.
- **`DateTime` on the wire.** Timestamps are epoch-millisecond numbers end to end. Changing that is a protocol change.
- **`effect/eventlog`: evaluated 2026-10-04, rejected.** An event log replicates accepted entries; it has no way for the authority to refuse a command, and stock refusal with a receipt is the sync contract. Do not reopen without a new fact.
- **`Workflow`/`Activity` and `PersistedQueue`: evaluated 2026-10-04, rejected.** The 2026-10-04 [repo audit](../../../../docs/effect-audit-2026-10-04.md) mapped `Workflow`/`Activity` on `Cluster.SingleRunner` to catalog publishing. On a single runner it adds a runner, storage tables and replay rules to a flow whose steps are already idempotent and resumable from the staged file, so it is a net addition. `PersistedQueue` for scan drafts duplicates `draft.json`. The IndexedDB query executor the audit listed was deleted with the browser replica.
