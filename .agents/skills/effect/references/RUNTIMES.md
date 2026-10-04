# Runtimes and edges

An **edge** is the one place in a process where Effect meets the host. Inside it everything returns `Effect`; the edge alone calls `run*`.

## The edge for each host

The target is one layer graph per process, launched once. The project profile says which file is each host's edge today.

| Host | Edge |
| --- | --- |
| A process or worker thread whose whole job is a layer | `Layer.launch(layer).pipe(NodeRuntime.runMain)` |
| A process with a main program | `program.pipe(Effect.provide(layer), NodeRuntime.runMain)` |
| A worker thread serving another thread | an `RpcServer.layer(...)` chain, then `Layer.launch` and `NodeRuntime.runMain`; see [HTTP, RPC and SQL](HTTP_RPC.md) |
| A host that cannot be Effect-first (Electron's event API, a native listener, a browser or React Native app) | one `ManagedRuntime` behind a Promise facade |
| React | atoms from `effect/reactivity/Atom` through `@effect/atom-react`, which run effects on the `AtomRegistry` |
| UI to a worker | `AtomRpc` clients over a `MessagePort`; the worker serves one `RpcServer` per port |
| Cloudflare Workers | the platform calls the returned `HttpEffect`; app code never calls `run*`. See [Alchemy](ALCHEMY.md) |

## A Promise facade

```ts
const runtime = ManagedRuntime.make(AppLive);

export const host = {
  quote: (id: ProductId, quantity: number, signal?: AbortSignal) =>
    runtime.runPromise(
      Quotes.use((quotes) => quotes.quote(id, quantity)),
      { signal },
    ),
  dispose: () => runtime.dispose(),
};
```

- Build the runtime once, when the host object is created. Each facade method is one `runtime.runPromise` over one service call or one `Effect.gen` workflow. Several small `runPromise` calls in a row lose interruption and tracing between them, so make them one effect.
- Cancellation is the caller's `AbortSignal` passed as the `signal` run option. Application code constructs no `AbortController`.
- The host disposes the runtime when it goes away, which closes every scope the layers opened.
- Module load stays inert: the runtime is created by the host's factory function, never as a side effect of an import.
- `Schema.decodeUnknownSync` is correct here and at module level, because a throw becomes a rejected Promise. Inside Effect code use `Schema.decodeUnknownEffect`.

## Callbacks that re-enter Effect

A host callback (an Electron event, a database commit hook, a native listener) runs outside any fiber. Give it the runtime that already exists:

- **A source of values** becomes a stream: `Stream.callback((queue) => Effect.acquireRelease(subscribe(...), unsubscribe))`, offering with `Queue.offerUnsafe`. See [concurrency](CONCURRENCY.md).
- **A sink that starts work** gets a run function captured inside Effect: `const run = yield* FiberSet.makeRuntime<R>()`, or `yield* FiberMap.runtimePromise(fibers)()` when each call is keyed and cancellable. The fibers belong to the surrounding scope.
- **A single captured context**: `const context = yield* Effect.context<R>()`, then `Effect.runForkWith(context)(effect)` in the callback.

`Effect.runSync`, `Effect.runFork` and `Effect.runPromise` on the default runtime see no provided logger, tracer or service, and `runSync` throws the moment the effect becomes asynchronous. They belong to an edge that has no layer at all.

## Effect calling Effect through a Promise

When Effect code needs a capability that another package exposes as a Promise facade over its own runtime, depend on the layer underneath the facade. Wrapping the facade in `Effect.tryPromise` nests a second runtime, flattens typed errors into a message, and breaks interruption. The facade stays for hosts that are not Effect.

## One runtime per host

- A feature does not get its own `ManagedRuntime` or `Atom.runtime` to reach a resource another runtime owns. Compose the resource into the host's layer.
- When atoms need services the host runtime already built, share the built context: `Atom.runtime(Layer.effectContext(runtime.contextEffect))`.
- When two runtimes in one process are unavoidable, give both the same memo map (see [services and layers](SERVICES_LAYERS.md)).

## Electron

- The worker thread that owns a resource, such as a SQLite database, does the work. The renderer reaches it through named `Rpc` contracts on forwarded `MessagePort`s; main only brokers the ports. A contract carries domain reads and commands, never SQL or a query description.
- Main talks to workers through `RpcClient.layerProtocolWorker` and `RpcGroup` contracts, never through hand-written message correlation.
- Nothing on the path to first paint waits for auth or the network. Defer a dependency with a lazy sub-layer, and start no network machinery the current screen does not need.
- Measure cold start and command latency before and after a change to an entry point or a layer graph.

## Cloudflare Workers

Alchemy owns the edge: its constructor's outer effect builds the layer graph once per isolate, and app code never calls `run*`. The two phases, bindings, Durable Object state and request-scoped clients are in [Alchemy](ALCHEMY.md).

## Process entry points

`NodeRuntime.runMain` installs signal handlers and interrupts every fiber on shutdown, so a process entry point ends in it and in no other `run*` call.
