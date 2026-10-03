# HTTP, RPC and SQL

One definition, shared by both sides. The server implements it, the client is derived from it, and neither re-declares a route, a payload or an error.

## HttpApi

- The API definition lives in a contract package with no server code: `packages/contracts/src/sync/api.ts`, `packages/auth/src/http-api.ts`. It is `HttpApi.make(name).add(HttpApiGroup.make(group).add(HttpApiEndpoint.post(name, path, { payload, success, error })))`.
- Handlers are a layer per group: `HttpApiBuilder.group(Api, "sync", Effect.fn("SyncHandlers.make")(function* (handlers) { ... }))`. Yield the services the group needs once, at the top, and close over them in each handler. A handler decodes nothing by hand, calls one service method, and maps the service's failures to the endpoint's declared errors.
- Each endpoint declares its errors. They are wire schemas with a status (`HttpApiSchema.status`), separate from the internal tagged errors. See [errors](ERRORS.md).
- Cross-cutting concerns are `HttpApiMiddleware.Service` classes attached with `.middleware(...)`: authentication provides the actor with `Effect.provideService`; `HttpApiMiddleware.layerSchemaErrorTransform` turns decode failures into the public malformed-request error.
- Routes outside the declared API (a WebSocket upgrade, a raw stream) use `HttpRouter.add`.
- Serving: a Worker converts the route layer once with `HttpRouter.toHttpEffect`; a Node process uses `HttpRouter.serve(...)` and `Layer.launch`. Provide `HttpServer.layerServices` at the root.
- `node_modules/effect/ai-docs/src/51_http-server/` is the full worked example, including the handler and middleware fixtures.

## HttpClient

- Calling our own API: `HttpApiClient.make(Api, { baseUrl, transformClient })` or `HttpApiClient.group(...)`. A second, hand-written client with its own path strings is a duplicate contract.
- Calling someone else's API: wrap `HttpClient.HttpClient` in a service. Configure the client once while the layer builds (`HttpClient.mapRequest(HttpClientRequest.prependUrl(...))`, `HttpClient.filterStatusOk`, `HttpClient.retryTransient({ schedule, times })`), and decode every body with `HttpClientResponse.schemaBodyJson(Schema)`.
- The implementation is a layer: `FetchHttpClient.layer`. Swap the underlying `fetch` with `Layer.succeed(FetchHttpClient.Fetch, fn)`, as the desktop does with Electron's `net.fetch`. A transport that is not HTTP at all (a proxy through the main process) is still an `HttpClient` built with `HttpClient.make`, so everything above it stays unchanged.
- One named effect owns each outgoing operation end to end: build the request, attach authentication, execute, classify the status, decode the body, translate transport, status and decode failures into the service's error, and apply the retry policy. Status is classified before a success body is decoded.
- Requests: `HttpClientRequest.bearerToken`, `acceptJson`, `bodyJson`, and `schemaBodyJson(Schema)` to encode a typed body. `HttpClient.mapRequestEffect` when a transform needs an effect, such as reading the current token.
- Responses: `HttpClientResponse.schemaBodyJson` for the body, `schemaJson` when status and headers are part of the contract, `schemaNoBody` for status and headers alone.
- Retry only idempotent requests. `HttpClient.retryTransient` covers transport failures and 408, 429, 500, 502, 503 and 504; a retry that depends on a domain failure is an `Effect.retry` on the operation. See [retry](RETRY.md).
- Pacing against a provider's limit is `HttpClient.withRateLimiter` with a `RateLimiter`. It reads rate-limit and `Retry-After` headers and adds `RateLimiterError` to the failure channel.
- Raw `fetch` is for a boundary that cannot depend on `effect/http`. It then does the same jobs by hand: pass the `AbortSignal` from `Effect.tryPromise`, check `response.ok` before reading the body, decode with a Schema, and translate each failure.
- A database transaction is closed before any HTTP call.

## Rpc and workers

- A contract is `RpcGroup.make(Rpc.make("Name", { payload, success, error, stream: true }))`, defined beside the protocol and imported by both ends (`apps/desktop/electron/replica-rpc.ts`).
- The worker thread is a layer chain: `RpcServer.layer(Rpcs)`, the handlers from `Rpcs.toLayer(Effect.gen(...))`, `RpcServer.layerProtocolWorkerRunner`, `NodeWorkerRunner.layer`, then `Layer.launch` and `NodeRuntime.runMain`.
- The main process builds `RpcClient.layerProtocolWorker(...)` and calls `RpcClient.make(Rpcs)`. Worker loss arrives as an `RpcClientError` matched by tag.
- A typed boot payload is `RpcWorker.initialMessage(Schema)`.
- Handlers yield the services they need from the worker's layer graph. A handler that opens its dependency through a Promise facade has left Effect and come back; give it the layer instead.
- A streaming procedure returns a `Stream`; health, progress and change feeds are streams, never a polled procedure.
- Large binary payloads move with `effect/workers/Transferable`.

## SQL

- The driver is a layer providing `SqlClient.SqlClient`: `@effect/sql-sqlite-node` on desktop, `@effect/sql-d1` in the auth Worker, `@effect/sql-pg` in server tests, with Drizzle's Effect drivers on top where the schema is Drizzle's. Shared code depends on `SqlClient.SqlClient` only.
- One client per database per process: one layer constant, provided once.
- A persistence service is shaped by the domain capability it serves. Table layout, queries, raw rows and ORM types stay private to it.
- Stored data is input. Decode it on the way out even though this process wrote it, and re-apply cross-field refinements that a row's column types cannot prove.
- When storage holds more than one representation (a legacy row, a versioned payload), choose the codec from explicit evidence, a version or a discriminator, before decoding. Malformed data then fails in the chosen codec instead of falling through to a weaker one that drops fields. A migration or import commits only after every required validation has passed, and the invalid original stays available for diagnosis.
- A transaction is `sql.withTransaction(effect)`. Calls to providers and other processes stay outside it.
- Rows are decoded. `SqlSchema.findAll({ Request, Result, execute })`, `findOne` and `findOneOption` pair a query with its schemas; a Drizzle result goes through `Schema.decodeUnknownEffect`.
- Migrations run through `effect/sql/Migrator` and complete before the layer finishes building, so every consumer sees a migrated database.
- `SqlError` is classified by `reason._tag`: a serialization failure or deadlock is retried, a constraint violation becomes a domain refusal, the rest is the storage error.
- A query result that drives the UI on a low-end machine is bounded: page it, and keep catalog-sized data out of renderer memory.
