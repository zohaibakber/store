# Known departures

Places where the repo does not yet meet the target. They are here so nobody copies them, and so a change that passes through one knows what to move it to.

- Entries come from a source survey on 2026-10-03. None was reproduced at runtime, so read the code before acting on one.
- Fix a departure when your task already changes that code. Otherwise leave it and say you saw it.
- Delete an entry in the change that fixes it. Add one when you find a new departure.

## Runtimes and edges

- **Nested runtime in the replica worker.** `apps/desktop/electron/replica-worker-handlers.ts` opens the replica through the Promise facade in `packages/client-db/src/replica/` (which owns a second `ManagedRuntime`), re-enters with `Effect.runPromise` in callbacks, and flattens the engine's typed errors into `ReplicaWorkerFailure { message }`. Target: compose the existing sync layers under the `RpcServer` layer, yield `ReplicaStore`, `SyncScheduler` and `SyncEngine` in the handlers, and expose health as `SubscriptionRef.changes`. The Promise facade stays for hosts that are not Effect.
- **`Effect.run*` on the default runtime inside adapters.** `packages/client-db/src/replica/{collection-sync,publisher,lifetime,notice-coalescing}.ts`, `packages/inventory-react/src/{lifetime,open}.ts`, `apps/web/src/session/workspace-session.ts`, `apps/desktop/electron/{replica-ipc,updater,replica-sessions}.ts`. Target: the adapter's one runtime, `FiberMap.runtimePromise` or `FiberSet.makeRuntime` for callback entry, `Stream.callback` for subscriptions.
- **Several independent runtimes in the renderer.** The auth host, each opened replica, and two `Atom.runtime`s over the same storage share no services, logger or tracer. Target: one host layer, with atoms sharing its built context.
- **`Effect.runFork` and `Effect.runPromise` in React code.** `apps/web/src/components/insights/restock-page.tsx`, `apps/web/src/lib/inventory/preload.ts`, `packages/client-db/src/catalog-commands.ts`. Target: an atom or the host facade.

## Services and layers

- **Tags without layers in `apps/server`.** `InventoryCommands`, `InventorySnapshots`, `InventoryImports`, `InventoryDevices` and `LiveFanout` are built by free `makeX(db)` functions and wrapped in `Layer.succeed` in `apps/server/src/http/app.ts`. Target: each service owns a layer that yields its database dependency; the Alchemy init effect bridges the built handle once.
- **Four layer spellings and two interface suffixes.** `X.layer`, `xLayer`, `layerX`, `XLive`; `XApi` and `XContract`. Target: the naming table in [services and layers](SERVICES_LAYERS.md), with the interface inline.
- **Unnamed service methods.** `packages/workspace` (`SessionHttp`), `packages/inventory-react` and most of `apps/desktop` use `Effect.gen` where `Effect.fn("Service.method")` belongs, so their traces have no spans.

## Errors

- **Validation by `throw new Error(message)`.** `packages/client-db/src/{catalog,purchasing,invoice}-projection.ts`, `packages/contracts/src/catalog/rules.ts`, `packages/contracts/src/store/invoice-allocation.ts`, wrapped in `catalog-commands.ts` by `Effect.try` with `catch: (cause) => cause`. User-facing refusals travel as `unknown`. Target: pure code returns `Result` with one tagged refusal, lifted by `Effect.fromResult`.
- **Plain `Error` in `E`.** `apps/desktop/electron/{replica-sessions,auth-ipc,auth}.ts`.
- **`Effect.orDie` on every replica read.** `packages/client-db/src/replica/sql-client-session.ts`. A storage failure reaches the UI as a defect. Target: `ReplicaStorageError` in `E`.
- **Absorbing `default:` branches.** `apps/server/src/http/sync-errors.ts`, and `protocolDisposition` in `packages/sync/src/transport.ts`, where every protocol code without its own rule becomes a `protocol` suspension. A new case is silently treated as the generic one.
- **Mixed construction and tags.** `X.make({...})` beside `new X({...})`; dotted tags in `apps/auth` and `packages/workspace` beside class-name tags elsewhere. Dotted tags that cross the wire are contracts.
- **Failures dropped without a log.** A failed replica open becomes `undefined` in `replica-worker-handlers.ts`.

## Hand-rolled

- **Reply correlation `Map`.** `apps/desktop/electron/replica-pending.ts`. Target: `Rpc`, or a `Deferred` registry in a `Ref`.
- **Mutable `Map` and `let` state beside Effect primitives.** `packages/client-db/src/replica/collection-sync.ts`, `apps/desktop/electron/{replica-sessions,replica-ownership,replica-backup}.ts`, `packages/inventory-react/src/{lifetime,preferences}.ts`, `apps/web/src/web/app-host.ts`.
- **The `crypto` global in Effect code.** `apps/server/src/inventory/postgres.ts`, `packages/sync/src/engine.ts` (`makeClaimId`), `apps/desktop/electron/{replica-sessions,replica-pending,replica-worker-handlers,replica-backup}.ts`, `packages/client-db/src/replica/node-sqlite.ts`, `apps/web/src/lib/first-party-auth.ts`, `packages/auth/src/jwt.ts`. Target: `Crypto.Crypto`, whose layer is `packages/auth/src/web-crypto.ts`.
- **`Date.now()` and `setTimeout`.** `packages/inventory-react/src/{atoms,live-collection}.ts` and UI code in `apps/web`.
- **A hand-written cross-tab storage atom** beside `Atom.kvs` in `apps/web/src/lib/preferences.ts`. The installed `Atom.kvs` and `KeyValueStore.layerStorage` do not subscribe to storage events; preserve cross-tab adoption and reading current storage before applying an update. `Atom.kvs` alone is not a replacement.
- **Mobile database lock registry.** `apps/mobile/src/inventory/host.ts` keeps a module-level map of semaphores, one per replica database, and runs them on the default runtime. The map holds one entry per signed-in organization and user, so it is small. `RcMap` needs a scope and a runtime the mobile host does not have, and would add more code than the six lines it replaces; move the locks into a layer when the mobile host gets its own `ManagedRuntime`. `PartitionedSemaphore` is not equivalent: its permit pool is shared across keys.

## Tests

- **Only `packages/sync` uses `@effect/vitest`.** Every other package wraps `Effect.runPromise` in a local `run` helper and uses real time. Target: `it.effect`, `layer(...)`, `TestClock`.
- **No reusable test layers.** Doubles are ad hoc objects in each harness.

## Needs the user's decision

These are architecture choices, not refactors. Raise them; do not start them inside another task.

- **Electron main as one layer graph.** `apps/desktop/electron/main.ts` is an async bootstrap with module-level handles and a broker per concern. The target shape is Electron APIs wrapped as services and one program under `NodeRuntime.runMain`. It changes startup order, so cold start must be measured before and after.
- **`DateTime` on the wire.** Timestamps are epoch-millisecond numbers end to end. Changing that is a protocol change.
- **`effect/eventlog`** overlaps with the custom sync engine. Evaluating it is a research task.
