# Hand-written code that Effect can replace

Five parallel reviewers inspected sync, desktop and workspace, backend and auth, web and mobile, and shared packages. This report uses the installed `effect@4.0.0` declarations and selected implementations as the API authority. Findings are source-level refactoring opportunities, not reproduced application failures. No application code changed.

The strongest opportunities improve SQLite resource acquisition and remove callback fiber tracking, filesystem Promise adapters, and custom network parsing. Sync already uses Effect for most scheduling, retries, sockets, coordination, and SQL transactions.

## Direct replacements

### SQLite cleanup during initialization

New finding. `packages/client-db/src/analytics/database.ts:81`, `analytics/source.ts:366`, and `replica/node-backup.ts:70` construct SQLite handles, configure them, and only then return them to an Effect resource bracket. If configuration throws, the handle never reaches the bracket's finalizer. Analytics recovery also closes and reopens handles manually.

Acquire only the constructed handle with `Effect.acquireRelease`, then configure it after acquisition. In backups, configure inside acquireUseRelease's use function. Close every failed attempt before deleting or recreating analytics files. Keep existing error mapping and ignored close failures. This is a source-confirmed cleanup gap, not a reproduced leak.

Evidence: `node_modules/effect/src/internal/effect.ts:4152` registers the finalizer after successful acquisition; `:4414` brackets the use phase.

### MessagePort callback fibers

New finding. `apps/desktop/electron/message-port-main-runner.ts:30` captures the context, forks every callback effect, attaches an observer, and tracks each fiber with `Fiber.runIn(scope)`.

`FiberSet.makeRuntime<R>()` owns the capture, tracking, removal on completion, and interruption when the scope closes. Preserve logging through `Effect.onExit` on each submitted effect. Joining the set would change failure isolation: one handler failure must not stop the runner. Keep the Electron adapter, framing, handshake, and close Deferred.

Evidence: `node_modules/effect/dist/FiberSet.d.ts:106` and `:134`; implementation in `node_modules/effect/src/FiberSet.ts`.

### Typed timeout failures

New finding. These sites use `timeoutOption` and immediately turn absence into a failure or fallback:

- `apps/desktop/electron/replica-ownership.ts:44`.
- `apps/desktop/electron/analytics-supervisor.ts:97`.
- `apps/desktop/electron/replica-supervisor.ts:174`.
- `apps/desktop/electron/workspace-sessions.ts:247`.

`Effect.timeoutOrElse({ duration, orElse })` removes the intermediate Option. Keep the detached closing fiber in `workspace-sessions`: time out `Fiber.await(closing)`, terminate the workers in the fallback, then await closing. Timing out `Scope.close` directly changes cleanup ownership. Keep timeoutOption where presence or absence is the actual result, such as the supervisor's stability observation.

Evidence: `node_modules/effect/dist/Effect.d.ts:7990`.

### Filesystem Promise adapters

New finding. `apps/desktop/electron/replica-restore-files.ts:16` wraps filesystem Promises and repeats the translation around stat, remove, link, copy, and rename. `replica-publish-files.ts:36` and `workspace-sessions.ts:142` have related wrappers.

Use `FileSystem.FileSystem` and one `NodeFileSystem.layer` in the owning runtime. Map PlatformError into the existing domain failures at the adapter. Keep sidecar removal, rollback, and archival policy.

Two details prevent a blind rewrite. A file check must preserve stat's regular-file test, rather than use exists. Publishing at `replica-publish-files.ts:53` uses `{ flush: true }`; `writeFileString` has no flush option. Preserve that sequence with scoped open, writeAll, file.sync, close, and rename.

Evidence: `node_modules/effect/dist/FileSystem.d.ts:84`, `:107`, `:174`, `:208`, `:221`, `:285`, and `:572`; `node_modules/@effect/platform-node/dist/NodeFileSystem.d.ts:9`.

### PKCE crypto and encoding

New specific site. `apps/desktop/electron/auth.ts:93` wraps Node random bytes, Buffer Base64URL conversion, and SHA-256 hashing inside Effect.sync.

Use `Crypto.Crypto.randomBytes(32)`, `Base64Url.encode`, and `Crypto.Crypto.digest("SHA-256", bytes)`. Hash the UTF-8 bytes of the encoded verifier string, exactly as the current implementation does. Keep Redacted and translate typed platform failures into the sign-in failure contract. NodeCrypto.layer and the existing WebCrypto layer supply the service.

Evidence: `node_modules/effect/dist/Crypto.d.ts:86` and `:90`; `node_modules/effect/dist/encoding/Base64Url.d.ts:38`.

### Auth IPv6 parsing

New finding. `apps/auth/src/service.ts:79` expands compressed IPv6 manually to derive a /64 rate-limit bucket.

`NetAddress.ipv6FromString` and `NetAddress.ipv6ToSegments` replace the parsing. Keep the existing first-four-segments hexadecimal key format and the bypass for IPv4 and embedded IPv4. A standalone Node comparison matched the existing bucket keys for ten representative inputs, including compressed, uppercase, padded, localhost, unspecified, IPv4, and embedded IPv4 addresses. Decide how invalid input is handled before migration.

Evidence: `node_modules/effect/dist/net/NetAddress.d.ts:550` and `:582`.

### CSV file concurrency

New finding. `packages/services/src/invoice-extraction/service.ts:102` hides a Promise.all and async map inside one tryPromise.

Use `Effect.forEach` with a per-file `Effect.tryPromise`, explicit unbounded concurrency, and the existing AttachmentsUnreadable translation. Keep the CSV parser inside tryPromise so its thrown errors keep the same mapping. Preserve input order and null for non-CSV files. Effect owns sibling-fiber interruption, but File.text itself does not expose cancellation. Lower concurrency is a separate policy change.

Evidence: the installed `Effect.forEach` and `Effect.tryPromise` declarations in `node_modules/effect/dist/Effect.d.ts`.

### Drizzle report validation

New finding. `packages/db/scripts/check-schema-drift.mjs:38` parses JSON and inspects properties and arrays manually.

Use a module-level `Schema.fromJsonString(ReportSchema)` decoder with Schema.decodeUnknownResult. This needs no ManagedRuntime. Preserve dialect comparison, unexpected-status diagnostics, and truncation. Current code ignores non-array hints, so a stricter hints field would change behavior. Keep statement details tolerant until their upstream shape is established.

Evidence: `node_modules/effect/dist/Schema.d.ts:6876` and `:1337`.

## Smaller cleanups

- New: the browser online/offline fallback in `packages/sync/src/live-socket.ts:102` registers and removes listeners, then adapts them to a stream at `:272`. Use merged `Stream.fromEventListener` streams. Keep the initial navigator.onLine read, transition ordering, buffering, and the custom native callback adapter. Evidence: `node_modules/effect/dist/Stream.d.ts:1214`.
- New: the Set-backed unique helper in `packages/sync/src/replica/footprint.ts:49` and deduplication in `commit-hub.ts:63` can use `Array.dedupe` for primitive IDs and keys. Preserve first-occurrence order. Do not apply to object collections without checking equality semantics. Evidence: `node_modules/effect/dist/Array.d.ts:8383`.
- New: reusable gen-plus-withSpan functions in `packages/sync/src/replica/digest.ts:89` and `:123` can use named `Effect.fn`, with the same span names. The paging and hashing algorithms stay. Evidence: `node_modules/effect/dist/Effect.d.ts:17737`.
- New: `packages/services/src/model-normalize.ts:4` and `invoice-extraction/line.ts:17` duplicate string and number predicates. Use `Predicate.isString` and `Predicate.isNumber`, preserving separate finite-number checks and migrating the product-scan imports. Evidence: `node_modules/effect/dist/Predicate.d.ts:696` and `:726`.
- New: `packages/services/src/insights/analysis.ts:736` groups batches with a get/push/set Map loop. `Array.groupBy` produces nonempty groups and preserves item order. Change subsequent lookup to record access with an empty-array fallback. The local Map has no concurrency or lifetime defect. Evidence: `node_modules/effect/dist/Array.d.ts:6068`.
- Optional: `packages/services/src/global-search/service.ts:121` and `:205` use Set-based deduplication. `Array.dedupeWith` can express the same normalized equality, after successful decoding and before slicing. Its quadratic comparisons can be worse than the current linear Sets, so this is a readability choice for small results. Evidence: `node_modules/effect/dist/Array.d.ts:8286`.
- New: `apps/mobile/src/auth/controller.ts:163` and `:521` cache the startup Promise manually. Allocate `Effect.cached(restore())` once in the controller's layer graph and expose it through the existing runtime facade. Keep lazy startup, shared concurrent waiting, and permanent retention of failure as well as success. A cache created inside each start call would not share work. Inspected consumers await the Promise and do not require Promise identity. Evidence: `node_modules/effect/dist/Effect.d.ts:12956`.
- Optional: `apps/mobile/src/inventory/host.ts:65` retains a semaphore for every database name. `RcMap.make` with semaphore lookup and zero idle TTL can reclaim unused entries. Both holders and waiters must retain references, acquisition must remain interruptible, and permit release must precede reference removal. Keep independent locks per database. This is lifetime cleanup, not a reproduced leak. Evidence: `node_modules/effect/dist/RcMap.d.ts:260` and `:458`.
- New: `apps/mobile/src/scan/use-now.ts:4` owns an interval and Date.now state. `Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced("1 second"))` can feed an atom under the host runtime. Keep the immediate sample, frozen time while disabled, teardown, and epoch milliseconds. The shared minute clock in `packages/inventory-react/src/atoms.ts:110` is already recorded. Atom.withRefresh itself uses native timers and does not provide TestClock control. Evidence: `node_modules/effect/dist/Stream.d.ts:418`, `node_modules/effect/dist/reactivity/Atom.d.ts:293`, and `node_modules/effect/src/reactivity/Atom.ts:2371`.
- New: `apps/mobile/src/scan/parse-worker.ts:175` branches on timeoutOption to wake due drafts. `Effect.timeoutOrElse` expresses that branch directly. Keep recalculation after a change, the twelve-hour sleep cap, handledThrough, absolute persisted retry timestamps, and worker interruption. The deadline policy remains domain code. Evidence: `node_modules/effect/dist/Effect.d.ts:7990`.
- New: `packages/client-db/src/purchasing-projection.ts:174`, `catalog-projection.ts:60`, and `packages/contracts/src/store/invoice-allocation.ts:58` repeat safe-integer and lower-bound validation. Reuse Schema.Natural and the existing PositiveInt through Schema.decodeUnknownResult, then map to existing refusals. Preserve messages, fields, validation order, and each helper's success value. Stock rules and legal transitions remain domain code. Schema.isInt uses Number.isSafeInteger. Evidence: `node_modules/effect/dist/Schema.d.ts:5898` and `node_modules/effect/src/Schema.ts:7645`.
- New: `packages/client-db/src/catalog-read.ts:50` manually slices IDs into bounded predicate chunks. `Array.chunksOf(unique, MAX_IN_VALUES)` preserves chunk order, the short final chunk, and empty-input behavior. Keep first-occurrence ID deduplication and the predicate shape. Evidence: `node_modules/effect/dist/Array.d.ts:5721`.
- New: `packages/contracts/src/sync/digest.ts:196` filters all sources separately for each entity. Array.groupBy groups in one pass. Keep partitionEntityRecord, sortedPartitionLeaves, empty-entity digests, duplicate leaves, entity order, UTF-8 ordering, separators, and hash bytes. Evidence: `node_modules/effect/dist/Array.d.ts:6068`.

## Existing departures confirmed

- `apps/desktop/electron/auth.ts:320` maintains token listeners that `workspace-sessions.ts:191` converts back into a stream. An auth-owned PubSub exposed as Stream.fromPubSub removes both adapters. Preserve future-events-only delivery, subscription order, and an explicit buffering policy. Queued delivery differs from synchronous callbacks.
- `packages/sync/src/engine.ts:135` uses global crypto.randomUUID. Crypto.Crypto.randomUUIDv4 supplies the same UUID version through a substitutable service, with typed platform failures. The existing crypto departure already covers this site.
- New location within that theme: `packages/client-db/src/replica/node-backup.ts:232` uses global crypto.randomUUID for a partial-file suffix. Use the existing host's Crypto service and map generation failure into ReplicaFileFailure. Keep one UUIDv4 suffix per invocation and the cleanup paths. Evidence: `node_modules/effect/dist/Crypto.d.ts:138`.
- `apps/server/src/ai/workers-ai.ts:17` and `packages/services/src/model-json.ts:47` duplicate the existing LanguageModel integration. Reuse requires preserving 512 and 4096 token budgets and tolerant fenced-JSON recovery. LanguageModel.generateObject decodes JSON directly and does not provide that salvage behavior. Ai.toMarkdown remains separate.
- `apps/mobile/src/scan/drafts.tsx:49` owns draft state, mirrored refs, parsing state, and worker cleanup in React. A scoped service with SubscriptionRef.modifyEffect and forkScoped can serialize persistence and publish after success. Keep draft.json recovery, sequential parsing, request coalescing, sameInput guards, and a distinction between optimistic and committed edits. Evidence: `node_modules/effect/dist/SubscriptionRef.d.ts:743` and `node_modules/effect/dist/reactivity/Atom.d.ts:367`.
- `apps/web/src/session/workspace-session.ts:184` creates a scope and FiberHandle, then enters it with default-runtime runners. Capture FiberHandle.runtime under the existing host context. Keep synchronous Switching publication, latest-wins cancellation, and storage-before-publication order. The current settled operation discards Fiber.await's Exit; runtimePromise would instead reject, so it is not a drop-in replacement. Evidence: `node_modules/effect/dist/FiberHandle.d.ts:140`.

## Replacements that do not fit directly

- Worker requests must not share an in-flight Cache or Effect.cached lookup across invocations. The Google JWKS Ref cache intentionally stores completed values.
- Cloudflare rate-limit bindings enforce limits across isolates, and the Cloudflare Cache API stores response-based entries. Process-local Effect replacements change those contracts.
- Crypto.Crypto supplies random bytes, UUIDs, and digests, but does not replace the auth adapters for PBKDF2, HMAC, signature verification, or constant-time equality.
- SessionHttp refresh flights carry owner and sequence epochs, forced renewal, stale-result rejection, and cancellation. Cache alone does not replace that policy.
- PartitionedSemaphore shares one permit capacity across keys. It does not provide independent locks per database, and replica ownership also tracks closing barriers.
- Workspace session maps carry sender ownership, restore suspension, reopening, and release policy. RcMap is not a direct substitution.
- Web Locks coordinate across processes. An Effect semaphore only coordinates within its runtime.
- The sync backoff adapter already uses Schedule and exposes next-delay and reset operations. Effect 4 has Schedule.toStep; proposing a v3 Schedule.driver is incorrect.
- Sync prefetch reconciles a cursor against concurrent writes. Stream.paginate alone would lose that behavior.
- Analytics coalescing includes startup, settling, and minimum-gap policy. Stream.debounce alone does not cover it.
- Cross-tab preferences need storage events and a fresh storage read before updates. Atom.kvs alone does not preserve both.
- Renderer RPC clients still require the documented ten-second linger while atom runtimes dispose before dependants detach. This audit found no evidence that the workaround can be removed.
- FiberHandle.run with onlyIfMissing does not join an existing task. It returns an interrupted fiber, so it does not replace catalog-opening deduplication.
- Replay channels currently deliver callbacks inline. SubscriptionRef covers replayed values but does not preserve synchronous facade delivery automatically.
- Mobile edit debounce flushes on unmount and handles empty-draft removal. Atom.debounce alone does not supply those policies.
- Synchronous analytics transactions use BEGIN IMMEDIATE, and read snapshots roll back on success. SqlClient.withTransaction commits successful work and requires an Effect adapter. Adoption needs an explicit interface and error-policy migration.
- `packages/client-db/src/reads/search.ts:61` keeps the last row's value at the first key position. Array.dedupeWith retains the first value and changes that behavior.
- Prepared-statement caches have synchronous consumers and clear all entries at capacity. Cache.get is effectful and changes eviction policy, so replacing the Map alone does not fit.
- Digest ordering and incremental hashing are protocol algorithms. Order.String does not replace UTF-8 or prefix-aware ordering.
- Command metadata uses caller-supplied occurredAt and commandId. Sampling Clock inside those helpers would change replay semantics.
- Scan draft.json already owns durable acceptance. PersistedQueue would duplicate it.
- EventLog and Workflow were already evaluated and rejected for the current requirements. This audit found no new reason to reopen those decisions.

## Verification

All five reviews are complete. Candidate API names and semantics were checked against installed Effect 4 declarations and selected source. Small standalone probes checked IPv6 bucket equivalence and numeric, chunking, and grouping behavior.

The audit changes documentation only. `vp check` passed formatting, lint, and type checking. `vp test` passed 48 files and 273 tests. `vp run -r check` passed database schema, migration-bundle, and schema-drift checks. Application behavior and failure injection remain untested by this audit.
