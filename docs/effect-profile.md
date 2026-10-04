# Effect profile: Store

The local facts the [Effect skill](../.agents/skills/effect/SKILL.md) asks a repo for. The skill is the target; this file says where the target lands here. Where the two differ, this file wins.

## Facts

- **Versions.** `effect@4.0.0` and `alchemy@2.0.0-beta.80`, pinned in the `pnpm-workspace.yaml` catalog.
- **Service ids** are `@store/<package>/<Name>`.
- **IDs** are branded strings from `packages/contracts/src/ids.ts`.
- **Timestamps** on the wire and in storage stay epoch milliseconds.
- **Comments.** Code carries none; the `// SAFETY:` line above a cast is the one exception.
- **`Crypto.Crypto`** is provided by `packages/auth/src/web-crypto.ts`.
- **Typed infrastructure failures.** Storage and network failures stay in `E`: the UI shows offline, retries, or asks the user to free space.
- **Process boundaries** are the "Sync engine boundaries" section of `AGENTS.md`.
- **Tests.** The policy is the "Tests" section of `AGENTS.md`. Postgres tests use the harness in `apps/server/test`; convergence of two replicas is the invariant worth a committed test.

## Edges

The target is one layer graph per process, launched once. This is where each edge is today.

| Host                                                | Edge                                                                                                                                                                                                                              | Read                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Desktop worker threads (replica, reader, analytics) | `RpcServer.layer(...)` chain, `Layer.launch`, `NodeRuntime.runMain`                                                                                                                                                               | `apps/desktop/electron/replica-worker.ts`                                               |
| Electron main                                       | a broker per concern: one `ManagedRuntime` behind a Promise facade                                                                                                                                                                | `apps/desktop/electron/auth.ts` (`makeAuthBroker`)                                      |
| Electron IPC handlers                               | `Effect.runPromise` per `ipcMain.handle` call (a departure; open, close, backup and publish only)                                                                                                                                 | `apps/desktop/electron/replica-ipc.ts`                                                  |
| Renderer to workers                                 | `AtomRpc` clients over forwarded `MessagePort`s; each worker serves one `RpcServer` per port                                                                                                                                      | `packages/inventory-react/src/services.ts`, `apps/desktop/electron/renderer-servers.ts` |
| Web host                                            | one `ManagedRuntime`, every `AppHost` method is `runtime.runPromise(Service.use(...))`                                                                                                                                            | `apps/web/src/web/app-host.ts`                                                          |
| Mobile host                                         | one `ManagedRuntime` per host that owns the database locks; each session's SQLite layers are built into the workspace scope under that context, and native callbacks enter through a session-scoped `FiberSet.makeRuntimePromise` | `apps/mobile/src/inventory/host.ts`                                                     |
| Cloudflare Workers (`apps/server`, `apps/auth`)     | Alchemy calls the returned `HttpEffect`; app code never calls `run*`                                                                                                                                                              | `apps/server/src/http/app.ts`, `apps/server/src/runtime/isolate.ts`                     |
| React                                               | atoms from `effect/reactivity/Atom` through `@effect/atom-react`                                                                                                                                                                  | `packages/inventory-react/src/atoms.ts`                                                 |

Desktop budget: nothing on the path to first paint waits for auth or the network, and a query result that drives the UI is paged, because the app runs on low-end machines. Measure cold start and command latency before and after a change to an entry point or a layer graph.

## Contracts

- `packages/contracts/src`: wire contracts shared by every process. `ids.ts` holds branded IDs, `sync/` the sync protocol and API (`sync/api.ts` is the `HttpApi`), `http-errors.ts` the wire errors.
- `packages/auth/src/model.ts` and `http-api.ts`: the auth wire model and API.
- IPC and RPC schemas sit beside their protocol: `apps/desktop/electron/replica-rpc.ts`, `ipc-channels.ts`.

## Persistence

- `SqlClient` drivers: `@effect/sql-sqlite-node` on desktop, `@effect/sql-d1` in the auth Worker, `@effect/sql-pg` in server tests, with Drizzle's Effect drivers on top where the schema is Drizzle's.
- The sync engine's guarantees: a command's `operationId` is its idempotency key, a command whose response was lost is resolved by asking for its receipt, and the persisted command queue is the durable work a worker resumes.

## Exemplars

The files nearest the target. Read one for the idea it is listed for; where it differs from the skill, the skill wins.

| Idea                                                                          | Read                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Domain module                                                                 | `packages/contracts/src/catalog/rules.ts`                                                                     |
| Application service with many dependencies and yieldable errors               | `apps/auth/src/login.ts`                                                                                      |
| Small complete service that yields `Crypto.Crypto`                            | `apps/auth/src/crypto.ts`                                                                                     |
| Outbound adapter: typed HTTP client behind a service, pure failure classifier | `packages/sync/src/transport.ts`                                                                              |
| Composition root; `Layer.build` once, handed on with `Layer.succeedContext`   | `apps/auth/infra.ts`                                                                                          |
| `mergeAll` plus `provideMerge` used deliberately                              | `apps/auth/src/service.ts`                                                                                    |
| Lazy sub-layer kept off first paint                                           | `apps/desktop/electron/auth.ts`                                                                               |
| Per-session sub-graph built with `Layer.build`                                | `apps/desktop/electron/worker-process.ts`                                                                     |
| State machine, restart and retry                                              | `apps/desktop/electron/replica-supervisor.ts`                                                                 |
| `Rpc` contract shared by main and worker                                      | `apps/desktop/electron/replica-rpc.ts`                                                                        |
| Pure refusal returned as `Result`                                             | `apps/desktop/electron/replica-admission.ts`, `decideCatalogRow` in `packages/sync/src/replica/projection.ts` |
| Closed-reason refusal, `REFUSALS` table, exhaustive wire mapping              | `apps/auth/src/failures.ts`                                                                                   |
| Last-resort handler                                                           | `recoverUnexpected` in `apps/server/src/http/app.ts`                                                          |
| Layer graph built once per isolate                                            | `buildOncePerIsolate` in `apps/server/src/runtime/isolate.ts`                                                 |
| `waitUntil` passed in as an effect-returning function                         | `apps/server/src/global-search/cache.ts`                                                                      |
| Value cached across requests in a `Ref`                                       | `apps/auth/src/google.ts`                                                                                     |

## Departures

[Known departures](effect-departures.md) lists the code that does not meet the target yet, and the architecture choices already made or waiting on the user. Read it before copying a pattern from an existing file.
