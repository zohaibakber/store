---
name: effect
description: Idiomatic Effect 4 and the coding standards for this repo. Module ownership, services and layer composition, runtimes and Promise edges, typed errors, Schema and parsing, concurrency, retries, configuration, and which Effect module replaces hand-rolled code. Use when designing, writing, reviewing or refactoring code that imports `effect` or `@effect/*`.
---

# Effect in Store

This skill describes the **target**: the Effect code this repo is moving toward. The existing code is partway there, so a neighbouring file is evidence of history, not of the standard. New code follows the target. A service you are already changing moves to the target in the same change. A departure you notice outside your task gets reported, and added to [known departures](references/DEPARTURES.md), instead of copied or fixed in passing.

The repo runs `effect@4.0.0`. Most Effect code a model remembers is v3, so the installed package is the authority: read `node_modules/effect/AGENTS.md`, the worked examples under `node_modules/effect/ai-docs/src/`, and the JSDoc in `node_modules/effect/dist/<Module>.d.ts` before choosing an API. Confirm a name exists there before you write it.

## v3 names that are gone

| v3 | 4.0.0 |
| --- | --- |
| `Context.Tag`, `Context.GenericTag`, `Effect.Service` | `Context.Service` |
| `Effect.catchAll`, `catchAllCause` | `Effect.catch`, `Effect.catchCause` |
| `Effect.async` | `Effect.callback` |
| `Effect.fork`, `forkDaemon` | `forkChild`, `forkScoped`, `forkIn(scope)`, `forkDetach` |
| `Layer.scoped` | `Layer.effect` (it is scope-aware) |
| `Either`, `Effect.either` | `Result`, `Effect.result` |
| `Data.TaggedError`, `Schema.TaggedErrorClass` | `Schema.TaggedError` |
| `Effect.makeSemaphore` | `Semaphore.make` |
| `unsafeOffer`, `unsafeMake` | `offerUnsafe`, `makeUnsafe` (suffix) |
| `@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/schema` | `effect/http`, `effect/http-api`, `effect/rpc`, `effect/sql`, `effect/Schema` |
| `Schema.parseJson`, `Schema.decodeUnknown` | `Schema.fromJsonString`, `Schema.decodeUnknownEffect` |
| `Schema.Union(a, b)`, `Schema.Literal("a", "b")`, `.pipe(Schema.minLength(n))` | `Schema.Union([a, b])`, `Schema.Literals(["a", "b"])`, `.check(Schema.isMinLength(n))` |

`Effect.partition` and the `Array`/`Record` `partition` and `separate` return `[successes, failures]`.

## Target form

- Import one module per line as a namespace: `import * as Effect from "effect/Effect"`. It keeps the Electron and Worker bundles to the modules actually used.
- A capability is a `Context.Service` class with the interface inline and the id `@store/<package>/<Name>`. Its layers are statics on the class. See [services and layers](references/SERVICES_LAYERS.md).
- A reusable effectful function is `Effect.fn("Owner.method")(function* (...) { ... })`. Trailing arguments apply to the whole call, so pass `Effect.mapError(...)`, `Effect.retry(...)` or `Effect.timeoutOrElse(...)` there instead of wrapping in `.pipe`. `Effect.fnUntraced` is for hot inner helpers. `Effect.gen` is for values: layer bodies, one-off blocks, tests.
- A nullary service member is an effect value (`readonly refresh: Effect.Effect<void, E>`), and a pure helper stays a plain function.
- Bind a service to a name, then call it: `const feed = yield* PriceFeed`.
- Errors are `Schema.TaggedError` classes whose tag is the class name, built with `new` and raised with `return yield* new X({...})`.
- Data is `Schema.Struct` with `export type X = typeof X.Type`. IDs are branded strings from `@store/contracts`.
- The clock, randomness and crypto come from Effect (`Clock`, `DateTime`, `Random`, `Crypto.Crypto`), so tests control them. Wire and storage timestamps stay epoch milliseconds.
- Effect code is tested with `@effect/vitest`.
- Code carries no comments; a cast needs `// SAFETY:` on the line above.

## Rules

**Every concern has one owner.** Pure meaning and calculation live in domain modules, policy and effect order in an application service, protocol and vendor mechanics in an adapter, wiring in the composition root. A service exists because it owns authority, policy or real variation; an abstraction stays only if deleting it would push complexity into its callers. See [design](references/DESIGN.md).

**Services own behaviour.** Dependencies are yielded once while the layer builds and closed over, so every method has `R = never` apart from request-scoped values. A dependency that is an Effect service arrives through the environment; only foreign objects and configuration are arguments to a layer factory.

**One reference per layer.** Effect shares a layer by reference identity, across `Layer.provide` and across `Effect.provide` calls. Bind every layer to a constant and reuse that constant. A layer factory (`X.layer(config)`) returns a new layer each call, so call it once at the composition root. `Layer.provide` hides a dependency, `Layer.provideMerge` keeps it visible, `Layer.mergeAll` joins siblings.

**One edge per host.** Each process has one place where Effect meets the host: `Layer.launch` with `NodeRuntime.runMain` in a worker thread, the Alchemy constructor in a Worker, one `ManagedRuntime` behind a Promise facade for Electron main, the renderer and React. Everything inside that edge returns `Effect`. A callback that must re-enter Effect uses the runtime that already exists (`FiberMap.runtimePromise`, `FiberSet.makeRuntime`, `Stream.callback`). See [runtimes](references/RUNTIMES.md).

**Failures are values.** A failure a caller can act on (offline, refused, not found, invalid, conflict, storage full) stays in `E` as a tagged error with data fields. A defect is a bug or an infrastructure failure nobody upstream can handle. Translate at the boundary with `catchTag` or an exhaustive `switch` on `_tag`; `catchCause` belongs only to supervisors and the last-resort handler, and it re-raises interruption. See [errors](references/ERRORS.md).

**Parse at the boundary.** Everything that crosses a process, the network, storage or `JSON` text is decoded with a Schema built once at module scope. Inner code receives the decoded type and keeps it; where the data came from decides whether it is decoded, validated or passed through. See [schema](references/SCHEMA.md).

**A scope owns everything that runs.** Background work is forked with `Effect.forkScoped` inside a layer, resources are `Effect.acquireRelease`, and a keyed set of fibers is a `FiberMap`. State lives in the layer closure, never at module level. See [concurrency](references/CONCURRENCY.md).

**A retry needs a guarantee.** An operation is retried only where running it twice is safe, and the guarantee (an idempotency key, a unique constraint, a state guard) is named. A lost response is uncertainty, not failure. See [retry](references/RETRY.md).

**Secrets stay wrapped.** A credential is `Redacted` from the boundary where it enters to the one call that needs its value, and diagnostics carry structured, allowlisted fields. See [configuration](references/CONFIG.md).

**Hand-rolled is a smell.** Before writing a retry loop, timer, TTL map, in-flight dedupe, event emitter, request correlation map, mutex, pool, SSE parser, or type guard, find the module in [the module map](references/MODULES.md). An unstable-tier module is welcome when it removes hand-rolled code.

## References by branch

Read the ones that match the change, completely, before editing.

- Deciding what owns a behaviour, whether something is a service, adding or removing an abstraction, naming, files and imports: [design](references/DESIGN.md).
- Defining a service, wiring layers, sharing or isolating an instance, background work in a layer: [services and layers](references/SERVICES_LAYERS.md).
- Entry points, `ManagedRuntime`, `run*` calls, Electron main, worker threads, React and atoms: [runtimes](references/RUNTIMES.md).
- Alchemy Workers, Durable Objects, bindings, request-scoped clients: [Alchemy](references/ALCHEMY.md).
- Declaring, raising, catching or mapping failures; `orDie`; exhaustive matching: [errors](references/ERRORS.md).
- Wire contracts, IDs, branded values, unions, optional fields, decoding, stored representations: [schema](references/SCHEMA.md).
- State, fibers, scopes, queues, caches, batching, time: [concurrency](references/CONCURRENCY.md).
- Event sources, subscriptions, pagination, backpressure, stream consumers: [streams](references/STREAMS.md).
- Retry, repeat, polling workers, deadlines, idempotency, transactions against remote calls: [retry](references/RETRY.md).
- Configuration, environment, secrets, logging, spans, personal data: [configuration](references/CONFIG.md).
- Choosing a module, or replacing hand-rolled code: [module map](references/MODULES.md).
- `HttpApi`, `HttpClient`, `Rpc`, workers, SQL: [HTTP, RPC and SQL](references/HTTP_RPC.md).
- Tests of Effect code: [testing](references/TESTING.md).
- Before copying a pattern from an existing file, or when you find code that breaks these rules: [known departures](references/DEPARTURES.md).

## Done when

Every changed behaviour has one owner, every Effect API in the change exists in the installed package, every new layer is one constant provided at one composition root, the change adds no `Effect.run*` call outside an edge, every new failure is either a tagged error in `E` or a deliberate defect at its owner, every retried side effect has a named guarantee, nothing hand-rolled remains where the module map names a module, and every departure you met is either fixed because it was in your path or recorded in known departures.
