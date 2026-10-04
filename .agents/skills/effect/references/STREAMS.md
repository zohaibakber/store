# Streams

A `Stream<A, E, R>` emits many values over time. It is pull-based: the consumer's demand drives the producer. Use one when the source is many-valued and ordered: events, subscriptions, paged reads, change feeds. One repeated effect that emits nothing is `Effect.repeat` with a `Schedule`; see [retry](RETRY.md).

## Sources

| Source | Constructor |
| --- | --- |
| A callback API | `Stream.callback((queue) => Effect.acquireRelease(subscribe, unsubscribe), { bufferSize, strategy })`, offering with `Queue.offerUnsafe` |
| A DOM or Node event | `Stream.fromEventListener(target, "online")` |
| Work handed to one consumer | `Queue` and `Stream.fromQueue` |
| Events every subscriber sees | `PubSub` and `Stream.fromPubSub` |
| Current value plus updates | `SubscriptionRef.changes(ref)` |
| Polling | `Stream.fromEffectSchedule(effect, Schedule.spaced("30 seconds"))` |
| Ticks | `Stream.fromSchedule(schedule)` |
| A paged API | `Stream.paginate` |
| An async iterable | `Stream.fromAsyncIterable`, when no native Effect source exists |
| A stream that needs services or config first | `Stream.unwrap(effect)` |
| Known values | `Stream.make`, `Stream.fromIterable` |

```ts
export const changes = (source: Source) =>
  Stream.callback<ProductId>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => source.subscribe((id) => Queue.offerUnsafe(queue, id))),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 64, strategy: "sliding" },
  );
```

## Transforming

- Pure: `Stream.map`, `Stream.filter`. Effectful: `Stream.mapEffect`, `Stream.filterEffect`.
- Bounded parallel work: `Stream.mapEffect(f, { concurrency: 8 })`. Add `unordered: true` when order is irrelevant and latency matters.
- One input to many outputs: `Stream.flatMap`, with `{ concurrency }` to run inner streams together.
- Carrying state: `Stream.mapAccum`, `Stream.mapAccumEffect`.
- An inner stream that lives only while the outer value holds: `Stream.switchMap` ("sync only while this replica owns the network").
- Repeats: `Stream.changes`. Bursts: `Stream.debounce` for a quiet period, `Stream.throttle` for a rate.
- Encoded frames: `Stream.pipeThroughChannel(Ndjson.decode())`, `Sse.encode()`.

Work keyed by an id keeps its order per key while different keys run together. Put that bookkeeping in one place, a `FiberMap` or one named helper, and choose queueing, replacement or coalescing from the operation's policy.

## Consuming

- For side effects: `Stream.runForEach`. For the effects alone: `Stream.runDrain`.
- Into a value: `Stream.runFold`, `Stream.runHead`.
- `Stream.runCollect` only on a stream known to end.

A long-lived consumer belongs to a layer:

```ts
export const layerChanges = (source: Source) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const feed = yield* PriceFeed;
      yield* changes(source).pipe(
        Stream.runForEach((id) => Effect.ignore(feed.priceOf(id))),
        Effect.forkScoped,
      );
    }),
  );
```

## Buffers

Natural backpressure is the default. `Stream.buffer({ capacity, strategy })` decouples a producer from a slower consumer, and the strategy is a decision: `suspend` pushes back, `dropping` sheds new values, `sliding` keeps the latest. An unbounded buffer needs a bound that exists somewhere else.

A bounded `PubSub.sliding` suits progress updates only when consumers can tolerate gaps and recover the current state. Keep durable completion in a receipt or stored result that a reconnecting consumer can read. When retries can overlap, identify updates by operation, attempt and sequence so consumers can reject stale attempts and detect gaps. Closing a progress subscription releases that subscription; whether it cancels the work is a separate ownership decision. See [durability](DURABILITY.md).

## Interfaces

A service exposes `Stream` and keeps the `Queue`, `PubSub` or `SubscriptionRef` private:

```ts
readonly events: Stream.Stream<ProviderEvent, ProviderError>;
readonly status: Stream.Stream<ProviderStatus>;
```

## Failures

- Translate at the boundary with `Stream.mapError`.
- Recover a typed failure with `Stream.catchTag`, `Stream.catchIf` or `Stream.catchFilter`.
- `Stream.catchCause` belongs to a supervisor.
- A failure ends the stream. A consumer that must survive one handles it per element, inside `mapEffect` or `runForEach`.

## In tests

- A finite fixture: `Stream.fromIterable(values)`. An open subscription: the same followed by `Stream.concat(Stream.never)`.
- Events the test drives: a test-owned `Queue` and `Stream.fromQueue`.
- Bound an open stream with `Stream.take(n)` before collecting.
