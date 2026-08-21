---
title: When to use which Effect API
---

# When

Decision table for efficiency work. Prefer column wins unless the avoid case
applies.

| Concern | Prefer | Avoid |
| --- | --- | --- |
| Long-lived DI / run edge | One `ManagedRuntime.make(layer)` (+ shared `MemoMap` if Layer graph is large); reuse `runPromise` / `runFork` / `runSync`; `dispose()` on shutdown | Per-request `Layer.build`; new runtime per sync or mount; forget dispose |
| N-way concurrency / single-flight | `Semaphore.make(n)` + `withPermits`; keyed mutex map of semaphores for per-path locks | Ad-hoc locks; `Effect.sleep` to serialize; unbounded `Effect.fork` storms |
| Sync construction of a permit | `Semaphore.makeUnsafe(1)` at module or class field init only | `makeUnsafe` inside hot Effect paths that should acquire effectfully |
| Latest value + subscribers | `SubscriptionRef` (`get` + `changes`) | `Ref` alone when UI/fibers must react; polling |
| Keyed memo + in-flight dedupe | `Cache.make` / `Cache.makeWith` once in a Layer | `Map` + TTL + in-flight `Map` in domain code |
| Single-value memo | `Effect.cached` / `cachedWithTTL` / `cachedInvalidateWithTTL` | One-key `Cache` |
| Cached resources that need cleanup | `ScopedCache` (idle TTL OK for location-like scopes) | Storing closable handles in plain `Cache` |
| Many values over time | `Stream` (+ `Queue` / `PubSub` at producer edge) | Unbounded arrays; sleep loops; unbounded queues without capacity |
| Layer-owned background consumer | `Effect.forkScoped` inside the owning Layer / scope | Detached fiber that outlives the Layer with no shutdown path |
| Bootstrap that must outlive caller | `Effect.forkDetach` (OpenCode `init` style) | Forking detach for work the Layer should cancel |
| Shared REST contract | `HttpApi` + `HttpApiBuilder` server; `HttpApiClient.make` client | Hand-duplicated route schemas; OpenAPI by hand |
| Outbound HTTP in Effect domain | `effect/unstable/http/HttpClient` + schema body helpers + `retryTransient` | Raw `fetch` inside domain services |
| Thin browser session adapter | Raw `fetch` OK (`auth`, `session-http`) | Dragging HttpApi into cookie-only helpers with no shared contract |
| Durable multi-step resume | `unstable/workflow` (+ cluster engine when distributed) | Homegrown DB state machine without durable need |
| Multi-node addressable actors | `unstable/cluster` Entity + RPC | Cluster for single-process sync |
| Token refresh dedupe | `Cache.make({ capacity: Infinity, timeToLive: Duration.zero, lookup })` for in-flight only | Parallel refresh storms; reconnecting WS on every 401 without refresh |
| Ops / spans on hot public methods | `Effect.fn("Domain.op")` | Anonymous generators on non-trivial service ops |

## Fork chooser

1. Work dies with the Layer or request scope → `forkScoped`.
2. Work must continue after the caller returns and is owned by app lifetime →
   `forkDetach`, then track shutdown explicitly.
3. Need a value later in the same fiber → do not fork; `yield*` it.
4. Need many concurrent bounded tasks → `Semaphore` + forks, or Stream
   concurrency operators with a limit.

## HTTP chooser

1. You own server + client schemas → HttpApi contract package, then Client.
2. Effect service calling third-party HTTP → HttpClient + decode at boundary.
3. Cookie/session glue with no Effect error channel needed → thin `fetch`.
4. Never re-encode `StoreApi` routes by hand on the client.
