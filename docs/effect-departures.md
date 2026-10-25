# Known departures

Places where the repo does not yet meet the target set by the [Effect skill](../.agents/skills/effect/SKILL.md). They are here so nobody copies them, and so a change that passes through one knows what to move it to.

- Entries come from a source survey on 2026-10-03. None was reproduced at runtime, so read the code before acting on one.
- Fix a departure when your task already changes that code. Otherwise leave it and say you saw it.
- Delete an entry in the change that fixes it. Add one when you find a new departure.

## Runtimes and edges

- **What the writer still does outside its layer graph.** The session is built after boot, in a scope `ReleaseForRestore` can close, so the per-port `InventoryStore` server receives it, with the session's one `CommandAdmission`, through `Layer.succeedContext(session)`, and `ReleaseForRestore` takes that admission's exclusive turn. The live socket's `accessToken` option is a Promise callback, so the worker re-enters with `Effect.runPromise(http.liveAccessToken(options))`. Engine errors still collapse to `ReplicaWorkerFailure { message }` on the main-facing `ReplicaWorkerRpcs`; the renderer-facing `InventoryStore` carries the typed `CommandFailure`. Target: `OwnedLiveHost.accessToken` takes an `Effect`; `ReplicaWorkerRpcs` errors become a tagged union.
- **Renderer RPC clients outlive their atom runtime by 10 s.** `outlivingItsRuntime` in `packages/inventory-react/src/services.ts` builds each `RpcClient` in a scope it closes on a detached, delayed fiber. Measured on effect 4.0.0: when the ports atom changes, `Atom.runtime` disposes the old layer scope before dependants detach, and the `RpcClient` scope finalizer interrupts every in-flight entry synchronously. Without the linger a mounted read shows `Failure(interrupt)` twice before the rebuilt runtime answers, and an in-flight command reports an interrupt where `generationMoved` should report `ReplicaUnavailable { reason: "restarting" }`. With it the read goes `waiting` to `Success`. The cost is one read re-sent on the dead port. Target: drop it when `Atom.runtime` detaches dependants before closing the previous scope, or when `AtomRpc` exposes a client lifetime.
- **`Effect.run*` on the default runtime inside adapters.** `packages/inventory-react/src/workspace.ts`, `apps/desktop/src/session/workspace-session.ts`, `apps/desktop/electron/{replica-ipc,updater,workspace-sessions}.ts`. Target: the adapter's one runtime, `FiberMap.runtimePromise` or `FiberSet.makeRuntime` for callback entry, `Stream.callback` for subscriptions.
- **Several independent runtimes in the renderer.** The auth host, the three `AtomRpc` clients (`Reads`, `Store`, `Insights`, which share `Atom.context()` and its memo map) and two preference `Atom.runtime`s over the same storage share no services, logger or tracer. Target: one host layer, with atoms sharing its built context.
- **`Effect.runFork` and `Effect.runPromise` in React code.** `apps/desktop/src/components/insights/restock-page.tsx`, `apps/desktop/src/lib/inventory/preload.ts`, and the `InventoryActions` Promise methods in `packages/inventory-react/src/workspace.ts` (one `runPromiseExit` per command, because forms and route loaders await them). Target: an atom or the host facade.

## Services and layers

- **Tags without layers in `apps/server`.** `InventoryCommands`, `InventorySnapshots`, `InventoryImports`, `InventoryDevices` and `LiveFanout` are built by free `makeX(authorities)` functions over the `OrgAuthority` namespace and wrapped in `Layer.succeed` in `apps/server/src/http/app.ts`. The authority itself (`apps/server/src/authority/facade.ts`) is a factory over a `SqlClient`, not a service. Target: each service owns a layer that yields its dependency; the Alchemy init effect bridges the built handle once.
- **Four layer spellings and two interface suffixes.** `X.layer`, `xLayer`, `layerX`, `XLive`; `XApi` and `XContract`. Target: the naming table in [services and layers](../.agents/skills/effect/references/SERVICES_LAYERS.md), with the interface inline.
- **Unnamed service methods.** `packages/workspace` (`SessionHttp`), `packages/inventory-react` and most of `apps/desktop` use `Effect.gen` where `Effect.fn("Service.method")` belongs, so their traces have no spans.

## Errors

- **Plain `Error` in `E`.** `apps/desktop/electron/{workspace-sessions,auth-ipc,auth}.ts`.
- **Absorbing `default:` branches.** `apps/server/src/http/sync-errors.ts`, and `protocolDisposition` in `packages/sync/src/transport.ts`, where every protocol code without its own rule becomes a `protocol` suspension. A new case is silently treated as the generic one.
- **Mixed construction and tags.** `X.make({...})` beside `new X({...})`; dotted tags in `packages/workspace` beside class-name tags elsewhere. Dotted tags that cross the wire are contracts.

## Hand-rolled

- **Additional source-confirmed replacements from five parallel reviewers.** The [hand-written code audit](effect-handrolled-audit-2026-10-04.md) records the installed Effect 4 API evidence and behavior to preserve. Source audit: 2026-10-04; no application failure reproduced.
- **SQLite initialization before cleanup registration.** `packages/client-db/src/analytics/{database,source}.ts` and `replica/node-backup.ts` configure newly opened handles before returning them to a resource bracket. Target: acquire the handle alone, then initialize with its finalizer registered. Close failed recovery attempts before file removal. The backup partial-file UUID at `node-backup.ts:232` is another global-crypto site.
- **Manual report and numeric validation.** `packages/db/scripts/check-schema-drift.mjs` uses JSON.parse and structural checks; target: a reusable Schema.fromJsonString decoder, preserving tolerant hints and diagnostics. `packages/client-db/src/{purchasing-projection,catalog-projection}.ts` and `packages/contracts/src/store/invoice-allocation.ts` repeat safe-integer bounds; target: Schema.Natural and the existing PositiveInt with unchanged refusals. Catalog-read chunking can use Array.chunksOf, and partition digest grouping can use Array.groupBy without changing hash bytes.
- **Callback fiber tracking.** `apps/desktop/electron/message-port-main-runner.ts` captures context, forks, observes and tracks every handler fiber manually. Target: `FiberSet.makeRuntime`, retaining per-handler logging and failure isolation, the Electron adapter and its protocol.
- **Manufactured timeout Options.** `apps/desktop/electron/{replica-ownership,analytics-supervisor,replica-supervisor,workspace-sessions}.ts` turn selected `timeoutOption` results directly into failures or fallbacks. Target: `Effect.timeoutOrElse`. Keep real presence/absence results and the detached scope-closing fiber.
- **Filesystem Promise wrappers.** `apps/desktop/electron/{replica-restore-files,replica-publish-files,workspace-sessions}.ts` adapt Node filesystem Promises repeatedly. Target: `FileSystem` with `NodeFileSystem.layer`, preserving domain error translation, regular-file checks and restore rollback. The publishing marker requires a flushed write before rename; `writeFileString` alone is not equivalent.
- **PKCE bytes and Base64URL conversion.** `apps/desktop/electron/auth.ts` wraps Node randomness, Buffer encoding and hashing in `Effect.sync`. Target: `Crypto.Crypto` plus `Base64Url.encode`, hashing the encoded verifier text, retaining `Redacted` and translating platform failures.
- **IPv6 expansion for auth rate-limit keys.** `apps/auth/src/service.ts` manually expands compressed addresses. Target: `NetAddress.ipv6FromString` and `ipv6ToSegments`, preserving the existing /64 bucket text, IPv4 bypass and an explicit invalid-input policy.
- **CSV concurrency hidden in a Promise.** `packages/services/src/invoice-extraction/service.ts` wraps `Promise.all` and an async map in one `tryPromise`. Target: `Effect.forEach` with per-file `tryPromise`, preserving order, concurrency, non-CSV nulls and the parser's error translation.
- **Small reusable helpers.** `packages/services/src/model-normalize.ts` and `invoice-extraction/line.ts` duplicate `Predicate` guards; `insights/analysis.ts` duplicates `Array.groupBy`; `packages/sync/src/replica/{footprint,commit-hub}.ts` duplicate primitive `Array.dedupe`; `replica/digest.ts` wraps reusable generators with spans instead of named `Effect.fn`. Global-search `dedupeWith` is optional because it trades linear Set operations for quadratic comparisons.

- **Two model-generation integrations.** Global search uses `LanguageModel.generateObject`, while invoice extraction uses `GenerateModelJson` and a second Workers AI wrapper. Reuse the existing provider adapter after adding per-operation token budgets and preserving tolerant extraction/JSON-recovery behavior. Document conversion remains separate.
- **Mutable `Map` and `let` state beside Effect primitives.** `apps/desktop/electron/{workspace-sessions,replica-ownership,replica-backup}.ts`, the access-token listener set in `apps/desktop/electron/auth.ts`, `packages/inventory-react/src/{workspace,preferences}.ts`, `apps/desktop/src/session/workspace-session.ts`.
- **The `crypto` global in Effect code.** `packages/sync/src/engine.ts` (`makeClaimId`), `apps/desktop/electron/{workspace-sessions,replica-backup}.ts`, `packages/client-db/src/replica/node-sqlite.ts`, `packages/auth/src/jwt.ts`. Target: `Crypto.Crypto`, whose layer is `packages/auth/src/web-crypto.ts`.
- **`Date.now()` and `setTimeout`.** `packages/inventory-react/src/atoms.ts` and UI code in `apps/desktop`.
- **A hand-written cross-tab storage atom** beside `Atom.kvs` in `apps/desktop/src/lib/preferences.ts`. The installed `Atom.kvs` and `KeyValueStore.layerStorage` do not subscribe to storage events; preserve cross-tab adoption and reading current storage before applying an update. `Atom.kvs` alone is not a replacement.

## Tests

- **Only `packages/sync` uses `@effect/vitest`.** Every other package wraps `Effect.runPromise` in a local `run` helper and uses real time. Target: `it.effect`, `layer(...)`, `TestClock`.
- **No reusable test layers.** Doubles are ad hoc objects in each harness.

## Needs the user's decision

These are architecture choices, not refactors. Raise them; do not start them inside another task.

- **Electron main as one layer graph.** `apps/desktop/electron/main.ts` is an async bootstrap with module-level handles and a broker per concern. The target shape is Electron APIs wrapped as services and one program under `NodeRuntime.runMain`. It changes startup order, so cold start must be measured before and after.
- **`DateTime` on the wire.** Timestamps are epoch-millisecond numbers end to end. Changing that is a protocol change.
- **`effect/eventlog`: evaluated 2026-10-04, rejected.** An event log replicates accepted entries; it has no way for the authority to refuse a command, and stock refusal with a receipt is the sync contract. Do not reopen without a new fact.
- **`@alchemy.run/domain`: evaluated 2026-10-24, rejected as the host.** Its commands, refusals, decide/evolve split and views are the model. Its Durable Object event log would replace the replica and the receipt. The same ideas are pure `Result` decisions in `@store/contracts`, recorded in [the domain ADR](adr/0001-domain-decisions-stay-in-effect.md). Do not reopen without a new fact about refusals and receipts.
- **`Workflow`/`Activity` and `PersistedQueue`: evaluated 2026-10-04, rejected.** The 2026-10-04 [repo audit](effect-audit-2026-10-04.md) mapped `Workflow`/`Activity` on `Cluster.SingleRunner` to catalog publishing. On a single runner it adds a runner, storage tables and replay rules to a flow whose steps are already idempotent and resumable from the staged file, so it is a net addition. `PersistedQueue` for scan drafts duplicates `draft.json`. The IndexedDB query executor the audit listed was deleted with the browser replica.
