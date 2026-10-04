# Alchemy and Cloudflare Workers

For Cloudflare Workers defined with Alchemy's Effect constructors. Read the installed Alchemy source (`node_modules/alchemy`) for the constructor you are changing before choosing a shape; a resource's name, its physical identity and its serialized state are three separate facts.

## Two phases

An Alchemy constructor's **outer** effect runs at plan time and again at every cold start. The effect or handlers it **returns** run only in the deployed Worker.

Provide infrastructure-backed layers to the outer effect, yield the services by tag there, and close over them in the returned handlers:

```ts
Effect.gen(function* () {
  const commands = yield* OrderCommands;

  return {
    fetch: requestHandler(commands),
  };
}).pipe(Effect.provide(OrdersLive));
```

- The composition root uses a service's layer. Yielding the service's `make` effect directly skips the layer's wiring, memoization and substitution.
- Bindings are resolved in the outer effect, so the plan can discover them. A layer provided only inside the returned effect registers its bindings too late.
- When an inner layer needs a service the outer effect already built, bridge the value: `Layer.provide(Layer.succeed(OrderCommands, commands))`, or `Layer.succeedContext(context)` for several. Providing the infrastructure layer again would build it twice.
- The layer graph is built once per isolate, and each request runs the resulting effect. A request handler never calls `Effect.provide(layer)`.
- Request-derived values (the actor, the tenant, the access token) are provided by middleware with `Effect.provideService`.
- Work that outlives the response goes through the execution context's `waitUntil`, passed in as an effect-returning function.
- Configuration and secrets are read with `Config` in the outer effect and stay `Redacted`. See [configuration](CONFIG.md).

## Durable Object state

At plan time a Durable Object's outer effect runs against mock state. It may resolve bindings, layers and the state reference. Anything backed by real storage (SQL clients, migrations, storage-backed services) is described outside and acquired inside the returned runtime effect, and finishes before the handlers become available.

## Clients that belong to one invocation

A Durable Object stub, and any HTTP client generated over one, is valid only inside the invocation that created it. Resolve the namespace binding once in the outer effect, and acquire the stub in the invocation that uses it, through Alchemy's per-execution memo. An isolate-wide layer or cache outlives the invocation; a canonical cache key does not extend the stub's lifetime. Add a keyed cache only when one invocation talks to several targets, with a capacity and a request-owned lifetime.

## Values cached across requests

A value an isolate keeps between requests is stored complete, in a `Ref`. `Cache`, `Effect.cached` and `Effect.cachedWithTTL` share one in-flight lookup between callers, and in a Worker that lookup's I/O belongs to the request that started it: when that request ends first, the other requests waiting on the entry can hang. Each request does its own fetch and the last one to finish writes the `Ref`. An identity provider's signing keys are kept this way.

## Drizzle

Yield every Drizzle chain directly: `const rows = yield* db.select().from(table)`. Alchemy's Drizzle handle is a lazy proxy that becomes an effect only when yielded. Handing an unyielded builder to `Effect.all` spins the isolate at full CPU.

## Verifying

A local run shows that planning needs no native storage and that repeated invocations reuse no stale client. It does not show that a deploy, a resource adoption or a namespace transfer is safe; those are verified against a deployed dev stage.
