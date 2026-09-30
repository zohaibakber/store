# Effect optimization plan

Status: implemented 2026-09-30 on `resilient-desktop-architecture` (uncommitted). See [Outcome](#outcome).

Reviewed against the repository's installed Effect **4.0.0-rc.117**, including its source and runtime behavior. Recheck APIs against that pin during implementation; v3 examples and newer RC documentation can differ.

## Objective

Reduce repeated I/O, CPU work, allocations, and lifecycle code by using Effect primitives where their semantics fit. Preserve the offline-first model and make the resulting code idiomatic Effect: effectful acquisition, explicit ownership, typed expected failures, structured concurrency, and Promise conversion at host interfaces.

The repository already uses Effect extensively. The strongest opportunities are gaps between existing Effect modules, particularly the Promise-based session HTTP module, the fallback insights cache, and row decoding. Introducing more modules is useful only when it removes work or makes an existing invariant easier to maintain.

## Evidence and priorities

| Work                                                 | Priority                                    | Expected benefit                                                             | Evidence                                                               |
| ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Share fallback insights computation with `Cache`     | First                                       | Fewer replica reads and repeated analyses; consistent report revisions       | Reproduced duplicate work through the existing insights interface      |
| Decode replica row batches with schema codecs        | First, benchmark before adoption            | Fewer intermediate objects and separate decode effects                       | Per-row copying and decoding visible in source; speed gain unmeasured  |
| Evaluate schema AOT compilation on hot paths         | Conditional on profiling                    | Lower schema parsing CPU                                                     | Available in the installed Effect version; application gain unmeasured |
| Consolidate session HTTP into Effect clients         | Next                                        | Less duplicated transport code; better cancellation and refresh coordination | Existing generated clients are wrapped by a custom Promise transport   |
| Validate AI output before normalization              | First correctness fix during implementation | Malformed provider output stays in the expected error channel                | Reproduced through the real upload route                               |
| Acquire stable HTTP dependencies in layers           | With HTTP migration                         | Less repeated setup; simpler dependency types                                | Google OAuth provides a fetch layer for each request                   |
| Use `Clock` and consolidate timing policy            | Later                                       | Deterministic policy tests; less custom time plumbing                        | JWT, session freshness, and fallback insights use wall-clock calls     |
| Evaluate `RcRef` and `SqlSchema` selectively         | Later, only if simpler                      | Smaller lifecycle and query adapters                                         | Concrete candidates exist, but domain semantics limit substitution     |
| Use generated API atoms and test clients selectively | Later                                       | Less repeated remote query and test orchestration                            | Existing `HttpApi` and atom infrastructure can support them            |

No end-to-end latency, memory, throughput, or cost improvement has been measured yet. The observed work-count reductions below are narrower evidence.

### Reproduced cases

1. Three simultaneous fallback summary requests for the same fixed replica snapshot performed **three `readInsights` calls** and returned report run IDs **1, 2, and 3**. Wrapping that fixed-snapshot workload in Effect `Cache` performed **one read** and returned run ID **1** to all three callers. This comparison proves coalescing for the fixture; the production cache must also preserve snapshot, policy, and date invalidation.
2. The upload route returned **502 / `EXTRACTION_FAILED`** for a provider returning `not-json`, but **500 / `INTERNAL_SERVER_ERROR`** for `{"lines":[null]}`. The generic parser casts the recovered object before `normalizeLine` reads its properties, so malformed nested data can throw before schema decoding and bypass `mapError`.
3. Repeated fresh plain-object keys matching the live-horizon cache coalesced correctly on the installed runtime. Keep that existing cache; do not apply v3 key-equality assumptions to this v4 pin.

The temporary reproduction tests were removed after running them. No production code was changed.

## 0. Establish comparable measurements

Capture measurements before each proposed runtime change, using the existing public interfaces and benchmark infrastructure where possible.

| Workload                                                                  | Measurements                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Simultaneous insights summary, product, and restock reads                 | Replica reads, analysis executions, report revisions, duration, retained heap              |
| Replica row decoding at ordinary window sizes and existing maximum bounds | Cold and warm duration, allocations, peak heap, malformed-row behavior                     |
| Concurrent authenticated requests near expiry and after 401 responses     | Refresh calls, request attempts, canceled upstream calls, completion time                  |
| Workspace open, organization switch, and close                            | Resource acquisitions, live workers/fibers, time until the prior writer releases ownership |
| API and sync operations                                                   | Database statements, retry attempts, duration, payload bytes                               |

Use `Metric` for counters and duration distributions, and existing `Effect.fn` / `withSpan` instrumentation for operation timing. Add only the measurements needed to evaluate these changes.

Before adding exporters, inspect Alchemy's telemetry integration. Its installed Worker bridge already builds configured telemetry per event and finalizes it through the request scope and `waitUntil`. The current infrastructure enables Cloudflare observability, but the application source does not explicitly configure `Cloudflare.Telemetry` or an OTLP destination. Verify the actual export path with one representative emitted span and counter. Keep metric labels bounded to operation, host, outcome, and error tag.

For each comparison, use the same fixtures, host, and concurrency. Measure cold startup separately from warm execution. Keep a change when it removes observable duplicate work, delivers a repeatable performance improvement, or substantially reduces orchestration while preserving behavior. Record the result instead of assigning an assumed percentage gain.

## 1. Share fallback insights computation

Sources: [insights-source.ts](../packages/inventory-react/src/insights-source.ts), [open.ts](../packages/inventory-react/src/open.ts), and [atoms.ts](../packages/inventory-react/src/atoms.ts).

The current one-entry cache is a mutable `cached` variable. It stores completed reports, but concurrent misses independently read and analyze the same data. Summary, product, and restock reads all use this loader.

Planned changes:

1. Construct an Effect `Cache` once per workspace when acquiring the insights source. Migrate the source construction and its caller together.
2. Preserve the existing key dimensions: replica generation, local commit version, stock policy version, UTC offset, and insight window boundary. Use immutable keys with equality verified against the installed runtime.
3. Put `readInsights` and `analyzeInsights` inside the cache lookup so all consumers share the complete report computation. Keep capacity small and explicit; start from the existing one-report retention behavior.
4. Give failed lookups zero TTL. Preserve the original storage failure instead of caching a successful empty fallback.
5. Reconcile the requested stamp with the stamp returned by the read. A commit between `stamp()` and `readInsights()` must not label a newer report as an older snapshot. Keep run and cursor revisions tied to the report actually produced.
6. Read time through `Clock` and retain policy/date rollover behavior. Do not replace revision-based invalidation with a long TTL.

Acceptance:

- Simultaneous summary, product, and restock requests for one key perform one analysis read and receive the same report revision.
- A commit, generation change, policy change, date rollover, or relevant offset change produces fresh results.
- A failed read can succeed on the next attempt.
- Closing or switching the workspace does not reuse its report in another workspace.
- Canceling one consumer does not break remaining consumers; closing the owner prevents further use.

Effect's [`Cache`](https://effect.website/docs/v4/api/effect/Cache) supplies shared pending lookups, bounded entries, and invalidation. The domain module still owns report keys and revisions.

## 2. Use bulk schema codecs for replica rows

Sources: [decode.ts](../packages/client-db/src/replica/decode.ts), [rows.ts](../packages/client-db/src/rows.ts), and [indexeddb-handle.ts](../packages/client-db/src/replica/indexeddb-handle.ts).

`sqliteRowsDecoder` calls `Object.entries`, maps the fields, and reconstructs an object for every row, including entities with no boolean conversion. It then creates a separate decode effect for each row through `Effect.forEach`.

Planned changes:

1. Derive storage-facing codecs from the existing row field definitions. For the affected boolean fields, use `Schema.BooleanFromBit` and retain boolean input where the current adapter accepts it.
2. Acquire a decoder for `Schema.Array(storageRowCodec)` once and decode a returned batch as a batch.
3. Remove the general-purpose object-copy pass and the separate boolean-field list where the codec now owns that transformation.
4. Preserve branded IDs, number refinements, accepted representations, output field shapes, and `ReplicaRowInvalid` classification. Keep decoding at the storage interface.
5. Benchmark before adopting across every entity. Compare the complete read/decode interface as well as the decoder alone; database time can dominate small reads.

Acceptance:

- Existing SQLite, IndexedDB, and IPC row fixtures retain their observable values.
- Invalid bit values and invalid rows fail through the typed storage error, with a useful row/field path.
- Output ordering is unchanged.
- Typical windows do not regress; larger batches show a repeatable CPU or allocation improvement.

### Optional: compile only schemas proven hot

The installed Effect version includes `SchemaAOTCompiler` and `SchemaAOTCompiler/Build`. Evaluate these after the bulk-codec comparison.

1. Identify hot struct/array decoders from profiling, rather than compiling every schema.
2. Compare interpreted parsing with generated AOT parsing. Include first use, warm use, generated bundle size, and invalid-input diagnostics.
3. Install generated parsers before consumers capture decoders. Regenerate when schemas or the Effect pin change, and keep generated output reproducible through the build.
4. Verify transformations and refinements remain behaviorally equivalent; unsupported operations can retain interpreted parsing.
5. For Node workers, JIT compilation is another benchmark option. Prefer AOT for a shared deployment approach; JIT uses dynamic function construction and may fall back when a host blocks it.

[`SchemaAOTCompiler`](https://effect.website/docs/v4/api/effect/unstable/schema/SchemaAOTCompiler) generates static decoder modules. Its benefit here remains a hypothesis until measured on this repository's actual schemas and hosts.

## 3. Consolidate session HTTP into Effect

Sources: [session-http.ts](../packages/workspace/src/session-http.ts), [organization-client.ts](../packages/workspace/src/organization-client.ts), [session-broker.ts](../packages/workspace/src/session-broker.ts), [auth client](../packages/auth/src/client.ts), [Google OAuth](../apps/auth/src/google.ts), and [mobile auth controller](../apps/mobile/src/auth/controller.ts).

`SessionHttpClient` implements Promise-based refresh sharing, request serialization, generic JSON parsing, error interpretation, and replay after 401. Organization operations then decode that JSON again despite an existing organization `HttpApi` group. Several callers cross from Effect to Promise and back while coordinating the same session.

Planned changes:

1. Define one session-owned Effect interface for access-token acquisition and authenticated HTTP. Keep workspace selection, persistence, logout, and offline policy in their owning domain modules.
2. Acquire `HttpClient` once in the owning layer and use `HttpClient.mapRequestEffect` / response transformation for authentication policy. Build the existing generated `HttpApiClient` on that client.
3. Migrate organization calls to the existing typed `organization.roster` and `organization.command` endpoints, removing their generic JSON transport and duplicate decode path.
4. Keep one refresh operation shared by concurrent consumers. Use scoped Effect sharing and synchronization; preserve the current guarantee that one caller cannot cancel refresh for other callers.
5. Track the session/token generation used by each request. After 401, recheck whether another request already refreshed it before starting another rotation. Limit replay to the established single attempt.
6. Preserve request bodies across replay, origin restrictions, credentials behavior, and host-specific token storage. Aborting an ordinary request should reach its upstream fetch.
7. Retain Promise adapters at fetch, Electron IPC, React, and native host interfaces that require them. Remove the superseded internal transport once all desktop, browser, and mobile callers migrate.
8. During this migration, make Google OAuth acquisition effectful and capture its HTTP client in the layer. Remove the per-request `provideFetch` helper and its residual-environment assertion. Move auth-client construction into effectful acquisition where useful, retaining an adapter for synchronous host setup if required.

Acceptance:

- A burst of requests needing the same refresh performs one rotation.
- Late 401 responses from the prior token generation reuse the new token instead of forcing another rotation.
- Logout and organization switches invalidate the previous session owner; delayed refresh cannot restore it.
- Request cancellation aborts upstream I/O while independent refresh consumers remain intact.
- Existing cookie/native refresh modes, typed errors, and replay limits pass through real client and host interfaces.
- Request and refresh counts do not increase; canceled requests leave less ongoing work.

[`HttpClient`](https://effect.website/docs/v4/api/effect/unstable/http/HttpClient) provides effectful request transformations and transport composition. Token rotation and session-generation rules remain application policy. A generic TTL cache for refresh tokens is insufficient.

## 4. Put AI provider output through a typed schema first

Sources: [model-json.ts](../packages/services/src/model-json.ts), [invoice extraction](../packages/services/src/invoice-extraction/service.ts), [product scan](../packages/services/src/product-scan/service.ts), and [Workers AI adapter](../apps/server/src/ai/workers-ai.ts).

Implement this correctness change independently of the larger provider migration:

1. Describe the permissive raw model response with schemas, including supported scalar forms, optional fields, and nested item objects.
2. Recover text/envelopes without casting the recovered object to the caller's payload type. Decode the raw schema before normalizers access properties.
3. Retain domain normalization for currency, quantities, pack factors, dates, and received-stock filtering. Decode the normalized public result afterward where it enforces distinct invariants.
4. Map malformed provider data into the existing extraction/scan error channel and public route response.

Then evaluate a shared `effect/unstable/ai/LanguageModel` adapter for both features:

- Use `LanguageModel.generateObject` with the raw schema to own structured-output decoding and provider error mapping.
- Preserve provider cancellation, timeout budgets, model settings, and token limits.
- Keep the Workers AI `toMarkdown` operation in its provider adapter. No drop-in Workers AI language-model adapter was identified in the installed dependencies; budget for an adapter rather than assuming the existing provider becomes unnecessary.
- Keep the current narrow adapter if a general `LanguageModel` integration adds more code than it removes. The raw-schema fix does not depend on it.

Acceptance: malformed nested output returns the intended typed API failure; existing salvage cases continue working; canceled generation reaches its provider signal; there are no additional model calls or retries. Document-conversion timeout should be described accurately if the provider offers no cancellation hook.

## 5. Consolidate clocks and timing policy

Sources: [jwt.ts](../packages/auth/src/jwt.ts), [session-http.ts](../packages/workspace/src/session-http.ts), [live-socket.ts](../packages/sync/src/live-socket.ts), and [scheduler.ts](../packages/sync/src/scheduler.ts).

Planned changes:

1. Use `Clock.currentTimeMillis` for time-dependent Effect workflows. Preserve explicit domain timestamps when a caller intentionally supplies one.
2. Use `TestClock` to validate expiry, rollover, backoff, and cancellation without custom wall-clock injection or sleeping through intervals.
3. Evaluate `Schedule` for the live socket's backoff ladder and repeated keepalive timing. Preserve first-probe timing, nudges, jitter, attempt reset, and offline interruption; retain the current loop if schedule composition becomes harder to follow.
4. Keep one retry owner per operation. The sync transport reports retry dispositions and `Retry-After` to its scheduler; adding HTTP retries underneath it could multiply attempts.

This is primarily a policy and maintainability improvement. The scheduler already uses Effect primitives and expresses real domain behavior: network ownership, visibility, auth pause, recovery, and digest cadence. Preserve those decisions and measure wakeups or requests before claiming resource savings.

## 6. Simplify resource ownership only where semantics match

Sources: [analytics-supervisor.ts](../apps/desktop/electron/analytics-supervisor.ts), [catalog lifetime](../packages/inventory-react/src/lifetime.ts), [pending replies](../apps/desktop/electron/replica-pending.ts), [server application](../apps/server/src/http/app.ts), and [auth HTTP](../apps/auth/src/http.ts).

Planned evaluation:

- Prototype `RcRef` for sharing the lazily started read-only analytics worker. Compare it with the existing `Ref` + semaphore + child-scope acquisition. Preserve the current stay-warm policy, crash invalidation, incarnation checks, one-retry behavior, and cooldown. Adopt only if the resulting ownership is simpler and scope closure still waits for the necessary cleanup.
- Keep the catalog's per-database writer coordination and stale-lease rules. Its `RcMap` of semaphores already uses Effect for keyed resource ownership. `PartitionedSemaphore` controls one shared permit pool with fairness between partitions; substituting it would change independent database locks into a different concurrency policy.
- Keep the pending-reply map that correlates external request IDs with responses unless the communication protocol itself changes. Its shared token-flight helper already composes `RcMap`, `Deferred`, and a semaphore; it is not an unused opportunity for ordinary result caching.
- Review failed initialization and test teardown for manually created isolate scopes. Expose deterministic disposal in test/runtime owners that can close; preserve Cloudflare's isolate-lifetime requirement in production. Do not introduce request-bound handles into isolate caches.
- Reuse existing `ManagedRuntime` owners at JS/native interfaces. Avoid adding a new runtime per operation or replacing every explicit scope with another abstraction.

Acceptance: simultaneous acquisition starts one analytics worker; a lost worker can be replaced; readers cannot use a closed incarnation; workspace switches release the old writer correctly; failed startup closes acquired resources. Runtime speed improvement is unproven; this step must earn its place by reducing lifecycle machinery or measured resource retention.

## 7. Use typed SQL adapters selectively

Sources: [maintenance.ts](../apps/server/src/inventory/maintenance.ts), [snapshots.ts](../apps/server/src/inventory/snapshots.ts), [commands.ts](../apps/server/src/inventory/commands.ts), and [coherence.ts](../packages/client-db/src/replica/coherence.ts).

Evaluate `SqlSchema` first for simple encode/execute/decode adapters such as maintenance and snapshot acquisition. It can centralize request encoding, result decoding, optional results, and expected missing-row failures.

Preserve cardinality guarantees. The command gateway currently decodes exact one-row tuples; `SqlSchema.findOne` takes the first row and would weaken that check if substituted blindly. Preserve database error classification and the existing encoded-body fast path.

Use `SqlResolver` when multiple distinct lookups can be answered by one SQL statement. The client already uses `RequestResolver` for coherent subset batches and product insights. Extend batching only where query counts show a remaining problem. Preserve transaction/snapshot grouping and batch bounds.

Acceptance: fewer handwritten query adapters where adopted, unchanged statement count and transaction semantics, unchanged encoded payloads, and verified missing/extra/malformed row behavior. This step is mostly code simplification unless a specific batch eliminates round trips.

## 8. Reuse API reactivity and testing modules at remote interfaces

Evaluate `AtomHttpApi` for organization roster and other remote account queries after the authenticated client is consolidated. It connects the existing typed API to query/mutation atoms and invalidation keys. Keep session transitions and offline workspace policy explicit.

Evaluate `HttpApiTest.groups` for focused handler/contract tests that currently acquire the full Worker application for every request. The generated in-memory client runs the API encoding/routing/decoding pipeline. Retain real Web-handler coverage for CORS, origin checks, multipart requests, and platform behavior. Benchmark fixture setup before doing a broad test migration. See [`HttpApiTest`](https://effect.website/docs/v4/api/effect/unstable/httpapi/HttpApiTest).

`AtomRpc` is a candidate for future direct typed RPC consumers. Electron workers already use Effect RPC; adding another layer to the existing host bridge does not itself reduce work. Local inventory queries already use atoms, batching, and TanStack DB demand windows; a remote API atom is not a substitute for those local semantics.

## Broader module decisions

| Module family                                                                     | Decision for this plan                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache`, `Effect.cached*`                                                         | Adopt shared report lookups; preserve existing prepared-statement and live-horizon caches. Match cache lifetime and failure TTL to the operation.                                                                                                  |
| `Schema`, codecs, `BooleanFromBit`                                                | Adopt at storage and AI input interfaces; preserve domain refinements and avoid redundant internal parsing.                                                                                                                                        |
| `SchemaAOTCompiler`, `SchemaJITCompiler`                                          | Benchmark selected hot decoders; adopt only with measured benefit and host-compatible initialization.                                                                                                                                              |
| `HttpClient`, `HttpApiClient`                                                     | Consolidate shared authenticated transport and consume existing contracts.                                                                                                                                                                         |
| `Layer`, `ManagedRuntime`, `Scope`                                                | Acquire stable dependencies once in their valid owner; keep host-specific lifetimes explicit.                                                                                                                                                      |
| `RcRef`, `RcMap`, `ScopedCache`, `Pool`                                           | Select by resource acquisition/release semantics. Evaluate `RcRef`; retain existing `RcMap` uses. No new connection pool is justified by this review.                                                                                              |
| `LayerMap`, `LayerRef`, `ScopedRef`, `Resource`                                   | Useful for keyed service contexts or refreshable scoped values. No sufficiently strong current replacement identified; avoid introducing them for ordinary report caching or writer leases.                                                        |
| `Deferred`, `Semaphore`, `SynchronizedRef`, `FiberHandle`, `FiberMap`, `FiberSet` | Use for session-owned coordination and sharing; much worker and replica coordination already uses them.                                                                                                                                            |
| `PartitionedSemaphore`                                                            | Conditional on a real need for fairness across one shared resource pool; preserve independent keyed locks.                                                                                                                                         |
| `Request`, `RequestResolver`, `SqlResolver`                                       | Preserve existing batching; extend only when one backend operation can serve several distinct keys.                                                                                                                                                |
| `SqlSchema`, `SqlModel`, `Model`, `VariantSchema`                                 | Selective adapter/codec simplification. Preserve Drizzle's migration ownership and command-specific domain shapes; no ORM migration proposed.                                                                                                      |
| `Clock`, `TestClock`, `Schedule`                                                  | Consolidate time acquisition and mechanical timing; preserve the sync state machine and retry owner.                                                                                                                                               |
| `Stream`, `Queue`, `PubSub`, `SubscriptionRef`                                    | Already used for bounded events and health state. Keep notice overflow/coalescing semantics; a sliding queue alone can lose required invalidations.                                                                                                |
| `Atom`, `AtomHttpApi`, `AtomRpc`, `Reactivity`                                    | Existing local atom usage is substantial. Evaluate typed remote account queries without replacing local demand-driven collections.                                                                                                                 |
| `Metric`, `Tracer`, `Logger`, `ErrorReporter`, OTLP modules                       | Measure the selected work and verify the existing Alchemy export path. Add a reporter only for an identified reporting gap.                                                                                                                        |
| `LanguageModel`, `Prompt`, `Response`, `AiError`                                  | Evaluate a shared provider adapter; implement raw-schema correctness first.                                                                                                                                                                        |
| `ExecutionPlan`, AI `Toolkit` / `Tool` / `Chat`                                   | Use if multi-provider fallback or tool-using workflows are introduced. Current structured extraction does not need those features.                                                                                                                 |
| `PersistedQueue`, `Workflow`, `Activity`, durable workflow primitives             | Revisit for independently scheduled, restartable jobs such as asynchronous extraction. Current bounded synchronous endpoints do not establish that requirement.                                                                                    |
| `EventLog`, `EventJournal`, cluster/entity modules                                | No sync rewrite proposed. The current authority/outbox owns receipts, overlays, rejection rollback, sequence gaps, snapshots, and digest cadence; matching those semantics would be an architectural project with no demonstrated efficiency gain. |
| Transactional `Tx*` collections                                                   | Use when multiple in-memory references need atomic transactions with retry. Database authority and existing serialized worker policies do not establish a need for STM here.                                                                       |
| `RateLimiter`, `HttpClient.withRateLimiter`                                       | Consider outgoing provider admission if rate pressure is measured. Preserve native Cloudflare rate-limit authority and bounded request/retry budgets.                                                                                              |
| `Cron`, `DateTime`, `BigDecimal`, encoding modules                                | Adopt for a matching feature or demonstrated bug. Preserve platform cron execution, existing day/offset policy, integer money, and current wire formats.                                                                                           |
| `Config`, `Redacted`, platform SQL/worker/socket modules                          | Already foundational. Preserve them; no additional wrapper layer is justified solely for stylistic consistency.                                                                                                                                    |

## Execution order and completion criteria

1. Establish baselines and verify the measurements/export path. Track the existing full-suite test failure before using suite results to judge later work.
2. Implement the raw AI schema fix and the fallback report cache as separate small changes. They address reproduced behavior and do not require the HTTP redesign.
3. Compare bulk row codecs; adopt if their complete-interface measurements support it. Run the AOT evaluation only if parsing remains a meaningful cost.
4. Migrate shared session HTTP and all host callers together, then remove the superseded transport. Do the stable-client layer cleanup in this work.
5. Consolidate clocks and evaluate simpler schedules.
6. Select lifecycle, SQL-adapter, API-atom, and test-fixture changes only when each reduces machinery or measured work. Leave unsuccessful candidates out of the implementation.

Across all steps, preserve native-free shared sync exports, domain-only IPC, replica hard deletes, digest cadence, receipt idempotency, snapshot coherence, and writer ownership. Keep pure domain calculations direct; wrapping arithmetic or native `Map` loops in effects does not inherently improve efficiency.

Migrate callers and delete the superseded path in the same change. Use explicit layers and typed errors. Avoid new service abstractions that merely rename one function or expose the underlying mechanism to callers.

Validate through the real owning interfaces, without module mocks. Use temporary probes freely; retain a new test only when an essential invariant lacks existing coverage, following the repository's test policy. For implementation changes, run `vp check`, `vp run -r check`, and `vp test`, plus affected host/build checks when imports or runtime initialization change. Run `vp run lint:design` if desktop UI code changes.

### Review baseline

- `vp install`: passed.
- `vp check`: passed.
- `vp run -r check`: passed, including database schema/migration checks.
- `vp test`: 815 passed, 1 failed. The failure was `windows > releases departed rows and never reloads the source while the window slides` in `packages/client-db/test/replica-collection-demand.test.ts`.
- Rerunning that file alone: all 8 tests passed. The cause of the full-suite failure remains unestablished; this review does not claim a clean full-suite baseline.
- Temporary upload-route and insights-concurrency probes: passed and removed.

## Outcome

Implemented against Effect 4.0.0-rc.117. `vp check`, `vp run -r check`, `vp test` (131 files, 821 tests, no failures) and `vp run lint:design` pass.

| Step                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Measurements                  | Local counts and timings only. The Alchemy export path was not verified; that needs a deployed Worker.                                                                                                                                                                                                                                                                                                                                                                 | Tables below                                                                                                                           |
| 1. Fallback insights `Cache`     | Adopted. One `Cache` per workspace, capacity 1. Failures get zero TTL. Time comes from `Clock`. The report is also stored under the stamp the read actually returned. The scope finalizer closes the source.                                                                                                                                                                                                                                                           | Three concurrent reads: 3 `readInsights` calls with revisions 1/2/3 before; 1 call with revision 1 for all after                       |
| 2. Bulk row codecs               | Adopted. `Schema.Array(storageCodec)` is decoded once per batch, with `Union(Boolean, BooleanFromBit)` for flags. The IndexedDB re-decode is removed.                                                                                                                                                                                                                                                                                                                  | Decoder alone about 2× faster with about half the allocation. Full read path 15–25% faster at 200+ rows                                |
| 2b. Redundant generic row check  | Removed. The per-row `SqliteResultRow` decode ran before the entity codec, on the snapshot, read-only and IPC paths. The raw-SQL `query` path keeps it.                                                                                                                                                                                                                                                                                                                | Read path about 2× faster (500 rows: 10–11.7 → 5.4 ms; 3000 rows: 53–56 → 28 ms)                                                       |
| 2c. AOT/JIT                      | Measured, not adopted.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | JIT warm decode is a further 1.7–3.8× faster, but its first decode is slower (9.6 vs 6.1 ms at 50 rows) and AOT would add a build step |
| 3. Session HTTP                  | Adopted. The `SessionHttp` service owns one `HttpClient`. It adds bearer tokens with `mapRequestEffect` and replays a 401 once, checking whether the token has already changed. One refresh fiber runs in the session scope under a generation guard. Organization and session calls use the typed `AuthHttpApi` endpoints. `SessionHttpClient` and `organization-client.ts` are deleted. Each host has one `ManagedRuntime`, and `sessionFetch` is the fetch adapter. | 10 requests near expiry: 1 refresh. 5 staggered 401s from the old token: 5 refreshes before, 1 after                                   |
| 3.8 Google OAuth / auth client   | Adopted. `HttpClient` is acquired once in the layer. `provideFetch` and its cast are removed. `authClientLayer` is effectful, and sync `makeAuthClient` stays for the renderer's module-level client.                                                                                                                                                                                                                                                                  | —                                                                                                                                      |
| 4. AI raw schema                 | Adopted. `decodeModelJson(schema)` recovers the JSON and then decodes it before normalization.                                                                                                                                                                                                                                                                                                                                                                         | `{"lines":[null]}` returned 500 before; now 502 `EXTRACTION_FAILED` (scan: 502 `PRODUCT_SCAN_FAILED`)                                  |
| 4b. `LanguageModel` adapter      | Not adopted. `generateObject` decodes strictly and would drop the fenced/prose/envelope salvage. The adapter would be 60–90 lines replacing about 25.                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                      |
| 5. Clock / Schedule              | JWT uses `Clock` with `TestClock` tests. Session freshness and the insights source use `Clock`. The live-socket and scheduler loops are kept: the attempt reset and nudges don't map onto `Schedule`.                                                                                                                                                                                                                                                                  | —                                                                                                                                      |
| 6. `RcRef` analytics worker      | Adopted (242 → 197 lines). Interrupted startup no longer leaks a worker. Failed isolate startup now closes the scope in the server and auth apps, and auth builds in one isolate scope. Fixed a notice-encoding defect (`overflowedEntities: undefined`) that stopped analytics notices after the first commit.                                                                                                                                                        | —                                                                                                                                      |
| 7. `SqlSchema`                   | Adopted in `maintenance.ts` only; the SQL it sends is byte-identical. Snapshots, commands and `SqlResolver` were not clear wins.                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                      |
| 8. `AtomHttpApi` / `HttpApiTest` | Not adopted. The desktop app already has a roster atom over the host bridge. `HttpApiTest` setup was slower and would lose Worker-level coverage.                                                                                                                                                                                                                                                                                                                      | Build plus call: `HttpApiTest` 3.9–4.2 ms vs full app 2.1–2.2 ms                                                                       |

Behavior changes to note:

- A success response with an invalid body is now `RequestError` 502 `INVALID_RESPONSE`.
- Network failures on typed session paths are `RequestError` with status 0 `NETWORK_ERROR`.
- Model output with a non-scalar field, or a top-level non-object, now fails as a 502 instead of being coerced.
- Replica row decode errors include the row index.
