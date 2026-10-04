# Concurrency, state, caching and time

## One worked service

```ts
export class Watcher extends Context.Service<
  Watcher,
  {
    readonly health: Stream.Stream<Health>;
    readonly watch: (id: ProductId) => Effect.Effect<void>;
    readonly unwatch: (id: ProductId) => Effect.Effect<void>;
    readonly priceOf: (id: ProductId) => Effect.Effect<number, PriceFeedError>;
  }
>()("@acme/pricing/Watcher") {
  static readonly layer = Layer.effect(
    Watcher,
    Effect.gen(function* () {
      const feed = yield* PriceFeed;
      const health = yield* SubscriptionRef.make<Health>({ _tag: "Idle" });
      const watchers = yield* FiberMap.make<ProductId>();
      const writes = yield* Semaphore.make(1);
      const seen = yield* SynchronizedRef.make(0);

      const prices = yield* Cache.makeWith(
        (id: ProductId) =>
          feed.priceOf(id).pipe(Effect.catchTag("UnknownProduct", () => Effect.succeed(0))),
        {
          capacity: 1_024,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(30) : Duration.zero),
        },
      );

      const poll = (id: ProductId) =>
        Cache.invalidate(prices, id).pipe(
          Effect.andThen(Cache.get(prices, id)),
          Effect.andThen(SynchronizedRef.update(seen, (count) => count + 1)),
          writes.withPermit,
          Effect.retry({ schedule: Schedule.jittered(Schedule.exponential("250 millis")), times: 5 }),
          Effect.ignore,
          Effect.repeat(Schedule.spaced("1 minute")),
        );

      return Watcher.of({
        health: SubscriptionRef.changes(health),
        watch: (id) => FiberMap.run(watchers, id, poll(id), { onlyIfMissing: true }).pipe(Effect.asVoid),
        unwatch: (id) => FiberMap.remove(watchers, id),
        priceOf: (id) => Cache.get(prices, id),
      });
    }),
  );
}
```

Everything it creates (the fibers, the cache, the refs) is owned by the layer's scope and ends with it. Nothing is stored at module level and nothing is cleaned up by hand.

## State

State belongs to a layer, created while the layer builds. Module-level `let` and module-level `Map` outlive every scope, are shared by every test, and cannot be replaced.

| The state is | Use |
| --- | --- |
| A value fibers read and replace | `Ref` |
| Updated by an effect, or by a read-then-write that must not interleave | `SynchronizedRef.modifyEffect` |
| Observed by someone | `SubscriptionRef`, exposing `SubscriptionRef.changes(ref)` as a `Stream` |
| A state machine | a `_tag` union held in one of the above |
| Entries that own a fiber | `FiberMap` (one per key), `FiberHandle` (at most one, latest wins), `FiberSet` (a dynamic set) |
| Entries that own a scoped resource | `RcMap` with `idleTimeToLive` |
| Entries that are computed and expire | `Cache` |
| Read synchronously by non-Effect code | `MutableRef` |

A plain `Map` in the layer closure is acceptable only for bookkeeping where every mutation is synchronous, nothing observes it, and no entry owns a resource. The moment an update spans a `yield*`, it is a `SynchronizedRef`.

To wait for a transition, read the stream: `SubscriptionRef.changes(state).pipe(Stream.filter(isReady), Stream.runHead)`.

## Fibers

- `Effect.forkScoped`: the fiber belongs to the current scope. The default inside a layer.
- `Effect.forkChild`: a structured child that ends with its parent. The default inside a workflow and in tests.
- `Effect.forkIn(scope)`: the fiber belongs to a scope you captured, usually the service's.
- `Effect.forkDetach`: outlives everything. Almost never what you want.
- Concurrency over a collection is explicit: `Effect.forEach(items, f, { concurrency: 8 })`. The default is sequential.
- A deadline that should be a typed failure: `Effect.timeoutOrElse({ duration, orElse })`. One that should be absence: `Effect.timeoutOption`.
- A region that must not be interrupted halfway: `Effect.uninterruptibleMask((restore) => ...)`. Protect the smallest ownership handoff or commit/publication sequence; restore interruptibility where abandoning the work is safe. A mask neither serializes other fibers nor survives process loss. See [durability](DURABILITY.md).

Pass the `AbortSignal` supplied by `Effect.tryPromise` to a foreign API that supports cancellation. Use `Effect.abortSignal` when the signal must follow a scope's lifetime instead of one call. An interrupted waiter does not establish that remote work stopped; accepted durable work needs its own cancellation and recovery policy.

## Coordination

| Need | Use |
| --- | --- |
| One fiber tells others "this happened", once | `Deferred` |
| A gate that opens and closes | `Latch` |
| Mutual exclusion or bounded parallelism | `Semaphore.make(n)` and `withPermit` |
| Hand work to one consumer | `Queue` (`bounded`, `sliding`, `dropping`) |
| Every subscriber sees every event | `PubSub` and `Stream.fromPubSub` |
| "Wake up, something changed", coalesced | `Queue.sliding<void>(1)` |

Request and reply inside one process is a `Deferred` per request, registered and removed with `Effect.ensuring`. Across a worker or IPC boundary it is `Rpc`, never a correlation map.

## Caching and sharing work

| The pattern | Use |
| --- | --- |
| One value, computed once | `yield* Effect.cached(effect)` |
| One value that expires or can be invalidated | `Effect.cachedWithTTL`, `Effect.cachedInvalidateWithTTL` |
| The same key asked for again over time | `Cache` |
| The same key asked for by several fibers at once | `Cache`: concurrent `Cache.get` calls for a missing key share one lookup |
| Many distinct keys, and the backend answers a batch | `Effect.request` with a `RequestResolver` (`RequestResolver.batchN` bounds the batch) |
| Many distinct keys, one call each | `Effect.forEach(keys, f, { concurrency: n })`, through a `Cache` if keys repeat |
| A cached value that owns a resource | `ScopedCache`, `RcMap` |

- Build a cache once, in the layer that owns it, and share the handle. A cache built per call caches nothing.
- `capacity` is required and is the eviction bound. Choose it, the TTL and the invalidation rule deliberately.
- `Cache.make({ capacity, lookup, timeToLive })` has one TTL. `Cache.makeWith(lookup, { capacity, timeToLive: (exit, key) => ... })` decides per result: `Duration.zero` for a transient failure or a degraded fallback, so the caller gets the answer and the next call tries again; a short TTL for a stable failure such as not-found, to protect the upstream.
- `Cache.invalidate` and `Cache.refresh` handle staleness; `Cache.has` checks without a lookup.
- A handle that belongs to one request or invocation stays out of a process-wide cache. See [Alchemy](ALCHEMY.md).

A stored `Promise | undefined`, `Fiber | undefined` or `started` flag is one of these written by hand.

## Resources

- `Effect.acquireRelease(acquire, release)` ties a resource to the current scope; `Effect.addFinalizer` registers cleanup for something already built.
- `Effect.scoped` closes the smallest region that needs the resource.
- A finalizer that drops pending work first fails the waiters (`Deferred.fail`), so nothing hangs on a closed service.

## Streams and schedules

Streams are in [streams](STREAMS.md). Retry, repeat, polling and deadlines are in [retry](RETRY.md).

## Time, randomness and crypto

- Now: `Clock.currentTimeMillis`, or `DateTime.now` when you need calendar or time-zone arithmetic and formatting.
- Waiting: `Effect.sleep("750 millis")`. Durations are `Duration` values or strings.
- Random values and ids: `Random`, `Crypto.Crypto` (`randomUUIDv4`, `randomBytes`, `digest`).
- `Date.now()`, `setTimeout`, `Math.random()` and the `crypto` global inside Effect code make the code untestable with `TestClock` and a seeded `Random`.
