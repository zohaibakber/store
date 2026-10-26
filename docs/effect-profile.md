# Effect profile: Store

The local facts the [Effect skill](../.agents/skills/effect/SKILL.md) asks a repo for. The skill is the target; this file says where the target lands here. Where the two differ, this file wins.

## Facts

- **Versions.** `effect@4.0.6` and `alchemy@2.0.0-beta.83`, pinned in the `pnpm-workspace.yaml` catalog.
- **Service ids** are `@store/<package>/<Name>`.
- **IDs** are branded strings from `packages/contracts/src/ids.ts`.
- **Timestamps** on the wire and in storage stay epoch milliseconds.
- **Money** is a branded natural number of minor units (`Money` in `packages/contracts/src/store/pricing.ts:7`; `moneyFromRupees` and `moneyToRupees` convert). Command input prices such as an invoice line's `salePrice` (`packages/contracts/src/store/schema.ts:157`) and analytics cost aggregates (`unitCost`, `packages/contracts/src/sync/replica-analytics.ts:99`) stay `number`; the refusal boundary produces `Money`.
- **Comments.** Code carries none; the `// SAFETY:` line above a cast is the one exception.
- **`Crypto.Crypto`** is provided by `packages/auth/src/web-crypto.ts` in the auth and server code and by `NodeCrypto.layer` (`@effect/platform-node/NodeCrypto`) in the desktop. The replica worker edge provides it once (`apps/desktop/electron/replica-worker.ts:18`) and hands it to the session, so sync claim ids come from `Crypto.Crypto` (`packages/sync/src/engine.ts:131`); the staff gate (`packages/client-db/src/staff/node.ts:120`) takes `Crypto.Crypto` from the same edge.
- **Typed infrastructure failures.** Storage and network failures stay in `E`: the UI shows offline, retries, or asks the user to free space.
- **Process boundaries** are the "Sync engine boundaries" section of `AGENTS.md`.
- **Tests.** The policy is the "Tests" section of `AGENTS.md`. Every `*.test.ts(x)` file imports `@effect/vitest`. Shared doubles are `Layer.mock(SyncTransport, ...)` values: `UnreachableTransport` (`packages/client-db/test/lib/transports.ts`) and `stubTransport` (`packages/sync/test/lib/engine-fixture.ts`), plus `freshSyncEngine` (`apps/server/test/lib/sync-engine.ts`). Turn timeouts of `CommandAdmission` are pinned with `TestClock` (`packages/client-db/test/admission.test.ts`), and the licence test steps `TestClock` with a filesystem round trip between steps so the forked recheck runs (`apps/desktop/test/electron/licence-service.test.ts`, see [departures](effect-departures.md)). Authority tests run the `OrgAuthority` facade on node SQLite through `apps/server/test/authority/harness.ts`; convergence of two replicas is the invariant worth a committed test.
- **Lint.** The `anti-slop` oxlint plugin (`tools/oxlint/anti-slop`, wired in `vite.config.ts`) encodes the repeated rules. `no-date-now-in-effect`, `no-global-crypto`, `no-node-fs-in-effect` and `no-plain-error-in-effect` apply only to files with a value import of `effect` or `@effect/*`; a type-only import does not count (`importsEffect` in `tools/oxlint/anti-slop/shared/effect-source.ts`). The other Effect rules match `Effect.*` and `Schema.*` calls by name. `no-host-policy-call-in-component` bans `access.workspace`, `access.workspaces`, `access.admit` and `access.inventoryScope` (receivers `access`, `hostAccess`) in the body of a function named like a component or hook, because those calls read the device workspace record and the React Compiler (`react({ compiler: true })`, `apps/desktop/vite.app.ts:47`) memoizes render-time calls, so the result went stale (bug-2). `no-registry-context` bans importing `RegistryContext`; it is off only for `packages/inventory-react/src`, whose `AtomRegistryProvider` (`provider.tsx`) is the one place the app gets the registry provider. The repo has no rule fixture tests; rules were checked with throwaway fixtures.

## Edges

The target is one layer graph per process, launched once. This is where each edge is today.

| Host                                                | Edge                                                                                                                                                                                                                                                                                                   | Read                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Desktop worker threads (replica, reader, analytics) | `RpcServer.layer(...)` chain, `Layer.launch`, `NodeRuntime.runMain`                                                                                                                                                                                                                                    | `apps/desktop/electron/replica-worker.ts`                                                                       |
| Electron main                                       | one `ManagedRuntime` over `MainLive` behind `run`/`dispose`; the session HTTP and auth client (`auth.ts`) and the licence service (`LicenceLive`) are lazy sub-layers behind `cachedOnSuccess`; per-workspace workers are `makeOpenWorkspaces`; native dialogs reach main through the `Dialogs` record | `apps/desktop/electron/host.ts` (`makeDesktopHost`), `open-workspaces.ts`, `dialogs.ts`, `cached-on-success.ts` |
| Electron shell port                                 | `ipcMain.on(SHELL_PORT_REQUEST_CHANNEL)` (`main.ts`) passes the request to `makeShellPort`, which hands the trusted main frame one `MessagePort` per document; `ShellServer` serves `ShellRpcs` on it, one fiber per sender                                                                            | `apps/desktop/electron/main.ts`, `shell-port.ts`, `shell-server.ts`                                             |
| Renderer shell runtime                              | one `ManagedRuntime` over an `RpcClient` on the shell port, behind a Promise facade (`call`, `fire`, `listen`)                                                                                                                                                                                         | `apps/desktop/src/host/electron.ts` (`electronAppHost`)                                                         |
| Renderer to workers                                 | `AtomRpc` clients (`Reads`, `Store`, `Insights` and `Desktop`, which serves workspace and licence state) over forwarded `MessagePort`s, built per opened catalog in `openReplicaChannel`; each worker serves one `RpcServer` per port                                                                  | `packages/inventory-react/src/services.ts`, `apps/desktop/electron/renderer-servers.ts`                         |
| Cloudflare Workers (`apps/server`, `apps/auth`)     | Alchemy calls the returned `HttpEffect`; app code never calls `run*`                                                                                                                                                                                                                                   | `apps/server/src/http/app.ts`, `apps/server/src/runtime/isolate.ts`                                             |
| React                                               | atoms from `effect/reactivity/Atom` through `@effect/atom-react`                                                                                                                                                                                                                                       | `packages/inventory-react/src/atoms.ts`                                                                         |

Desktop budget: nothing on the path to first paint waits for auth or the network, and a query result that drives the UI is paged, because the app runs on low-end machines. Measure cold start and command latency before and after a change to an entry point or a layer graph.

## Contracts

- `packages/contracts/src`: wire contracts shared by every process. `ids.ts` holds branded IDs, `sync/` the sync protocol and API (`sync/api.ts` is the `HttpApi`), `http-errors.ts` the wire errors.
- `packages/auth/src/model.ts` and `http-api.ts`: the auth wire model and API.
- IPC and RPC schemas sit beside their protocol: `apps/desktop/electron/replica-rpc.ts`, `ipc-channels.ts`.

## Persistence

- `SqlClient` drivers: `@effect/sql-sqlite-node` on desktop and in authority tests, `@effect/sql-sqlite-do` in the `OrgAuthority` Durable Object and `@effect/sql-d1` in the auth Worker, with Drizzle's Effect drivers on top where the schema is Drizzle's.
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
| `mergeAll` plus `provideMerge` used deliberately                              | `OperationsLive` in `apps/auth/infra.ts`                                                                      |
| Lazy sub-layer kept off first paint                                           | `apps/desktop/electron/auth.ts` with `cached-on-success.ts`                                                   |
| Context.Service with inline interface and static layers                       | `packages/sync/src/scheduler.ts`; `packages/sync/src/engine.ts` for the service shape only                    |
| Bounded fan-out with gap detection                                            | `makeReplicaCommitHub` in `packages/sync/src/replica/commit-hub.ts`                                           |
| Atom family keyed by scope, mounted while claimed                             | `packages/inventory-react/src/opening.ts`                                                                     |
| Test double as `Layer.mock`, engine built in the test's scope                 | `packages/sync/test/lib/engine-fixture.ts`                                                                    |
| Per-session sub-graph built with `Layer.build`                                | `apps/desktop/electron/worker-process.ts`                                                                     |
| State machine, restart and retry                                              | `apps/desktop/electron/replica-supervisor.ts`                                                                 |
| Per-connection RPC server on a `MessagePort`, one `FiberMap` fiber per sender | `apps/desktop/electron/shell-server.ts`                                                                       |
| `Rpc` contract shared by main and worker                                      | `apps/desktop/electron/replica-rpc.ts`                                                                        |
| Pure refusal returned as `Result`                                             | `apps/desktop/electron/replica-admission.ts`, `decideCatalogRow` in `packages/sync/src/replica/projection.ts` |
| Closed-reason refusal, `REFUSALS` table, exhaustive wire mapping              | `apps/auth/src/failures.ts`                                                                                   |
| Last-resort handler                                                           | `recoverUnexpected` in `apps/server/src/http/app.ts`                                                          |
| Layer graph built once per isolate                                            | `buildOncePerIsolate` in `apps/server/src/runtime/isolate.ts`                                                 |
| `waitUntil` passed in as an effect-returning function                         | `apps/server/src/global-search/service.ts`                                                                    |
| Value cached across requests in a `Ref`                                       | `apps/auth/src/google.ts`                                                                                     |
| Typed bridge failures: closed `Schema.TaggedError` union, one exhaustive map  | `BridgeFailure` in `apps/desktop/src/host/index.ts`, `bridgeSurface` in `apps/desktop/src/lib/errors.ts`      |

## Gotchas

- **Worker-protocol RPC encodes as JSON.** `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner` encode every payload with `Schema.toCodecJson` (the `RpcSerialization` codec), even over structured clone. A binary field needs `Schema.instanceOf(Uint8Array, { toCodecJson: () => undefined })`, or `Schema.Uint8Array` (base64). Transferable schemas toward `MessagePortMain` wedged Electron main; do not use them until that is understood.
- **Atoms dedupe equal consecutive values.** A stream whose consecutive values may be equal needs `Stream.zipWithIndex` or similar to keep each emission; the updater does this (`apps/desktop/src/hooks/use-app-updater.tsx:35`).
- **`no-host-policy-call-in-component` checks the nearest enclosing function.** A policy call inside a `useMemo` or `useCallback` callback written in a component body is not flagged, because that callback is an anonymous function. Keep policy reads in the workspace session atoms or an event handler, and do not rely on the rule alone.
- **A mounted effect atom runs work for a component's lifetime.** `useAtomMount` on an `Atom.make` whose read returns an Effect (`openLocalCatalog` in `apps/desktop/src/lib/local-catalog-witness.ts`, `resumeInterrupted` in `apps/desktop/src/lib/local-publish.ts:135`) is the repo's shape for it, and a write happens inside the Effect (`Effect.sync(() => get.set(...))`, `local-catalog-witness.ts:16`). A write made synchronously in the read body is a [departure](effect-departures.md).

## Departures

[Known departures](effect-departures.md) lists the code that does not meet the target yet, and the architecture choices already made or waiting on the user. Read it before copying a pattern from an existing file.
