# Module map

Find the need in the left column before writing the code yourself. Every module here ships in Effect 4; open `node_modules/effect/dist/<path>.d.ts` for its JSDoc and examples. Modules marked unstable upstream are welcome when they remove hand-rolled code.

## Control flow and resilience

| Hand-rolled | Module |
| --- | --- |
| Retry loop, backoff ladder, attempt counter | `Schedule` with `Effect.retry` |
| `setInterval`, polling loop | `Effect.repeat(Schedule.spaced(...))`, `Stream.fromEffectSchedule`, `Cron` |
| `setTimeout` deadline, `Promise.race` with a timer | `Effect.timeoutOrElse`, `Effect.timeoutOption`, `Effect.raceFirst` |
| Fallback chain across providers or tiers | `ExecutionPlan` |
| `AbortController` plumbing | interruption; `Effect.callback` and `Effect.tryPromise` hand you the `AbortSignal` |
| Token bucket, request pacing | `effect/persistence/RateLimiter`, `HttpClient.withRateLimiter` |

## State and coordination

| Hand-rolled | Module |
| --- | --- |
| Module-level `let` or `Map` | `Ref`, `SynchronizedRef`, in a layer |
| State plus a list of listeners | `SubscriptionRef` |
| `EventEmitter`, listener arrays | `PubSub`, `Stream.fromPubSub` |
| "Latest wins" task handle | `FiberHandle` |
| Map of running tasks by key | `FiberMap` |
| Set of background tasks to cancel together | `FiberSet` |
| `Promise | undefined` in-flight guard, `started` flag | `Effect.cached`, `Deferred` |
| TTL map, LRU, prune loop | `Cache`, `Effect.cachedWithTTL` |
| Reference-counted handle map | `RcMap`, `RcRef` |
| Keyed instances of a whole service | `LayerMap` |
| A value refreshed on a schedule | `Resource` |
| Mutex, keyed lock | `Semaphore`, `PartitionedSemaphore` |
| Boolean gate with waiters | `Latch` |
| Connection pool | `Pool` |
| DataLoader-style batching | `Request`, `RequestResolver`, `effect/sql/SqlResolver` |
| Multi-variable atomic update | `Effect.tx` with `TxRef`, `TxQueue` |

## Data

| Hand-rolled | Module |
| --- | --- |
| `JSON.parse`, manual validation, `as` on input | `Schema`, `Schema.fromJsonString` |
| `isRecord`, `isString`, `typeof` ladders | `Predicate`, `Schema.is` |
| `null`/`undefined` juggling | `Option` |
| Success-or-failure in pure code, `try`/`catch` returning a flag | `Result` |
| Nested ternaries over a union | `switch` on `_tag`; `Match` in expression position |
| Sort comparators, grouping, dedupe | `Order`, `Array`, `Record`, `Equivalence` |
| Deep immutable update | `Struct`, `Optic` |
| Byte and hex helpers, base64 | `effect/encoding/{Base64,Base64Url,Hex}` |
| SSE and NDJSON parsing | `effect/encoding/{Sse,Ndjson}` with `Stream.pipeThroughChannel` |
| Compact binary frames from a schema | `effect/encoding/SchemaBinary` |
| Secret that leaks into a log | `Redacted` |
| Date arithmetic, time zones, ISO formatting | `DateTime`, `Duration` |
| JSON patch and pointers | `JsonPatch`, `JsonPointer` |

## Platform

| Hand-rolled | Module |
| --- | --- |
| `fetch` with status checks and JSON decoding | `effect/http/HttpClient`, `HttpClientResponse.schemaBodyJson` |
| A client that re-declares the server's routes | `HttpApiClient.make(Api)` over the shared `HttpApi` |
| Route tables and request validation | `effect/http-api` (`HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`) |
| `postMessage` protocols, request ids, reply maps | `effect/rpc` (`Rpc`, `RpcGroup`, `RpcServer`, `RpcClient`) over `effect/workers` |
| Transfer lists for worker messages | `effect/workers/Transferable` |
| WebSocket reconnect and framing | `effect/socket/Socket` |
| `process.env` reads | `Config`, `ConfigProvider` |
| `node:fs`, `node:path` in Effect code | `FileSystem`, `Path` |
| `child_process` wrappers | `effect/process/ChildProcess` |
| The `crypto` global | `Crypto.Crypto` |
| `localStorage` wrappers | `effect/persistence/KeyValueStore` (`layerStorage`, `layerMemory`, `toSchemaStore`) |
| Cache that survives a restart | `effect/persistence/PersistedCache` |
| Durable work queue | `effect/persistence/PersistedQueue` |
| SQL string building, row decoding, migrations | `effect/sql` (`SqlClient`, `SqlSchema`, `Migrator`), `effect/schema/Model` with `SqlModel` |
| Multi-step process that must survive a crash | `effect/workflow` |

## UI

| Hand-rolled | Module |
| --- | --- |
| Store plus selectors over async data | `effect/reactivity/Atom`, `AsyncResult`, `@effect/atom-react` |
| Atom wrappers around API calls | `AtomHttpApi`, `AtomRpc` |
| Invalidate reads after a write | `effect/reactivity/Reactivity` |
| A persisted preference | `Atom.kvs` over `KeyValueStore` |

## Observability

| Hand-rolled | Module |
| --- | --- |
| `console.log` | `Effect.log*` with `Effect.annotateLogs`, `Logger.layer` |
| Timing a block by hand | `Effect.fn("Name")`, `Effect.withSpan`, `Effect.withLogSpan` |
| Counters and gauges | `Metric` |
| Exporters | `effect/observability` (`Otlp`), `ErrorReporter` for Sentry-style reporting |

## Whole subsystems

`effect/workflow`, `effect/eventlog` (typed event journal with replication), `effect/cluster`, `effect/ai`, `effect/cli`. Read the module before proposing one. Adopting one the project does not already use is an architecture decision for the user, not a refactor; check the project's departures for one already evaluated.
