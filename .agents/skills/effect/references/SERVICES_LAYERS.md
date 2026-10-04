# Services and layers

Whether something should be a service at all, and which module owns it, is decided in [design](DESIGN.md).

## Shape of a service

One module per service, in this order: errors and schemas, the `Context.Service` class with its interface inline, then its layers as statics.

```ts
export class PriceFeedError extends Schema.TaggedError<PriceFeedError>()("PriceFeedError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class UnknownProduct extends Schema.TaggedError<UnknownProduct>()("UnknownProduct", {
  id: ProductId,
}) {}

const failed = (operation: string) =>
  Effect.mapError((cause: unknown) => new PriceFeedError({ operation, cause }));

export class PriceFeed extends Context.Service<
  PriceFeed,
  {
    readonly priceOf: (id: ProductId) => Effect.Effect<number, PriceFeedError | UnknownProduct>;
    readonly refresh: Effect.Effect<void, PriceFeedError>;
  }
>()("@acme/pricing/PriceFeed") {
  static readonly layer = (baseUrl: string) =>
    Layer.effect(
      PriceFeed,
      Effect.gen(function* () {
        const http = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)),
          HttpClient.filterStatusOk,
        );
        const [prices, invalidate] = yield* Effect.cachedInvalidateWithTTL(
          http.get("/prices").pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Prices)),
            failed("load"),
          ),
          "5 minutes",
        );

        const priceOf = Effect.fn("PriceFeed.priceOf")(function* (id: ProductId) {
          const price = Option.fromNullishOr((yield* prices)[id]);
          if (Option.isNone(price)) return yield* new UnknownProduct({ id });
          return price.value;
        });

        return PriceFeed.of({ priceOf, refresh: Effect.andThen(invalidate, Effect.asVoid(prices)) });
      }),
    );
}
```

- The id is `<scope>/<package>/<Name>`, unique in the workspace. The project profile gives the scope.
- The interface is inline. Refer to it as `PriceFeed["Service"]`, and to one method as `PriceFeed["Service"]["priceOf"]`.
- Every method lists its failures explicitly and has `R = never`. A request-scoped value such as `CurrentUser` is the exception: it is provided per request by middleware with `Effect.provideService`.
- Stable dependencies are yielded while the layer builds and closed over. A value scoped to one request, fiber or operation is yielded inside the method that uses it, or passed as an argument when it is part of the request.
- Each method is `Effect.fn("PriceFeed.priceOf")`. The name is the service and the method, which is what a trace and a log line show.
- A nullary member is an effect value (`refresh`). Give it its span with `Effect.withSpan("PriceFeed.refresh")` when it does I/O.
- Return through `PriceFeed.of({...})`.
- The interface as a type parameter is the default, because the contract is then written down before the implementation. `Context.Service<Self>()(id, { make })` infers the interface from `make` and pairs with `static readonly layer = Layer.effect(this, this.make)`; use it for a small service whose shape is obvious from its body. `make` never creates the layer for you.
- A tag with no layer, whose value is built by a free `makeX(dependency)` function and wrapped in `Layer.succeed` at the root, is a departure: the dependency should be yielded inside a layer.

## Whole-operation concerns

A concern that needs the complete effect and the original arguments (error classification, log annotations, a deadline, a bounded retry) is a trailing transform on `Effect.fn`. Each transform receives `(effect, ...args)`:

```ts
export const deliver = Effect.fn("Mailer.deliver")(
  function* (message: Message) {
    yield* post(message);
  },
  (effect, message) =>
    effect.pipe(
      mailFailed("deliver"),
      Effect.annotateLogs({ to: message.to }),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(new MailError({ operation: "deliver", cause: "timeout" })),
      }),
    ),
);
```

The generator stays the operation; one or two transforms carry the policy. A helper like `mailFailed(operation)` earns its place when every failure passing through it has the same meaning; when failures need different handling, map them by tag. See [errors](ERRORS.md).

## Naming

| Thing | Name |
| --- | --- |
| A service's own layer | `static readonly layer` |
| A variant of it | `layerMemory`, `layerTest`, `layerNoDeps` |
| A layer that needs configuration | `static readonly layer = (options) => Layer.effect(...)` |
| A layer that is not one service (a bundle, a worker) | a free `layerX` function or constant |
| A wired sub-graph in a composition root | `PascalCaseLive`, such as `OperationsLive` |

Older code may spell layers `xLayer` or `XLive` on the service itself and declare a separate `XApi` or `XContract` interface. When you change such a service's definition, move it to this table and inline the interface in the same change.

## Choosing a constructor

- `Layer.succeed(Tag, value)`: the value already exists.
- `Layer.sync(Tag, () => value)`: built lazily, synchronously.
- `Layer.effect(Tag, effect)`: built by an effect. The effect may acquire resources and fork scoped fibers; the layer's scope owns them.
- `Layer.effectDiscard(effect)`: runs an effect for its side effect, provides nothing. Background workers.
- `Layer.effectContext(effect)`: one acquisition provides several services.
- `Layer.unwrap(effect)`: an effect chooses or configures the layer, usually from `Config`.

## Composing

```ts
const PriceFeedLive = Layer.unwrap(
  Effect.gen(function* () {
    const baseUrl = yield* Config.String("PRICE_FEED_URL");
    return PriceFeed.layer(baseUrl);
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

export const AppLive = Layer.mergeAll(Quotes.layer, PriceRefreshLive).pipe(
  Layer.provideMerge(PriceFeedLive),
);
```

- `Layer.provide(dep)` feeds `dep` in and hides it from the output. Use it for implementation dependencies.
- `Layer.provideMerge(dep)` feeds `dep` in and keeps it in the output. Use it only when later consumers also need `dep`.
- `Layer.mergeAll(a, b, c)` joins independent layers. `Layer.provide([a, b])` feeds several siblings at once.
- Layers later in a `pipe` are built beneath the earlier ones. Loggers, tracers and Sentry go last so every fiber forked above them sees them.
- Reaching for `provideMerge` or `mergeAll` to make a type error disappear hides a wiring mistake. Read which requirement is missing and provide exactly that.

## Sharing: one reference

A layer is shared when the same layer value is used. Two values that look the same build twice.

```ts
const D1Live = D1Client.layer({ db });
const RepositoryLive = AuthRepository.layer.pipe(Layer.provide(D1Live));
const EphemeralLive = EphemeralStore.layer.pipe(Layer.provide(D1Live));
```

- Bind a factory's result to a constant at the composition root and pass that constant to every consumer. Calling `D1Client.layer({ db })` inside two service layers opens two clients.
- A service may provide a dependency locally when the dependency is a module-level constant that is private to it, such as `WebCrypto.layer` or `FetchHttpClient.layer`. The constant is still built once.
- Leave application services open (not provided) on the service's layer and provide them at the composition root. A closed layer's inner dependency cannot be replaced by a test afterwards.
- `Effect.provide(layer)` also shares by reference between calls. `Effect.provide(layer, { local: true })` or `Layer.fresh(layer)` builds a private copy, which is what an isolated test or a per-key instance wants.
- Two `ManagedRuntime`s in one process share instances only when they are given the same memo map: `ManagedRuntime.make(layer, { memoMap })` with one `Layer.makeMemoMapUnsafe()`. Prefer one runtime; reach for a shared memo map when a second runtime is unavoidable.

## Handing a built value to another graph

When a service was built by an outer effect and an inner graph needs the same instance, bridge the value, never the layer:

```ts
Layer.provide(Layer.succeed(SqlClient.SqlClient, sql))
Layer.provide(Layer.succeedContext(dependencies))
```

A composition root that builds its dependencies once with `Layer.build` hands the resulting context on with `Layer.succeedContext`. Alchemy constructors need this; see [Alchemy](ALCHEMY.md).

## Deferring and keying

- **Lazy sub-layer.** When a dependency must not cost startup time, build it on first use and keep it: `yield* Effect.cached(Layer.buildWithScope(layer, scope))`. A desktop app defers its HTTP session this way so first paint does not pay for it.
- **Per-session sub-graph.** `Layer.build(layer)` builds into the current scope and returns the context. A supervisor builds an RPC client transport once per worker incarnation this way.
- **One instance per key.** `LayerMap.Service` builds a layer per key and releases it after `idleTimeToLive`; `RcMap` does the same for a single scoped resource; `ScopedCache` for a keyed value that owns a scope. Select the instance with `Effect.provide(Map.get(key))`: that is a lookup, not a rebuild. `node_modules/effect/ai-docs/src/01_effect/05_resources/30_layer-map.ts` is the worked example.

## Background work

```ts
export const PriceRefreshLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const feed = yield* PriceFeed;
    yield* feed.refresh.pipe(
      Effect.catch((error) =>
        Effect.logWarning("prices.refresh_failed").pipe(
          Effect.annotateLogs({ operation: error.operation }),
        ),
      ),
      Effect.repeat(Schedule.spaced("15 minutes")),
      Effect.forkScoped,
    );
  }),
);
```

- Layer acquisition must complete. A loop, stream consumer or listener is forked with `Effect.forkScoped`, and the layer's scope interrupts it.
- A background concern with no interface is its own `Layer.effectDiscard`, so the composition root chooses its lifetime separately from the service.
- Work that a method starts but the service owns: capture `const scope = yield* Scope.Scope` while the layer builds and use `Effect.forkIn(scope)` from the method. The caller being interrupted then leaves the work running for the other callers.
- A service exposes no `start` method unless the domain needs manual lifecycle control.

## Layers for tests

- `layerMemory` is a faithful in-memory implementation of the whole observable contract. When persistence, transactions, serialization or protocol behaviour matter, use the real local thing (SQLite in memory) instead.
- A double that tests need to control or inspect exposes a second tag from the same object. See [testing](TESTING.md).
- A one-off fake stays in its test file.

## Ambient values

`Context.Reference` is for a value with a real, safe default (a log level, a feature flag). Credentials, persistence, transports and anything that grants authority are ordinary services with no default, so a missing one is a type error.

## Worked examples

`node_modules/effect/ai-docs/src/01_effect/03_services/` and `05_resources/` are Effect's own worked examples of every shape above. The project profile lists the repo's exemplars; where one differs from this document, the document wins.
