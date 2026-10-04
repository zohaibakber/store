# Effect and architecture audit, 2026-10-04

The biggest opportunity is to remove infrastructure we maintain ourselves: query execution and publication machinery, durable job bookkeeping, duplicated model clients, and nested runtime ownership. Replacing a loop with an Effect combinator is much less valuable than deleting one of these responsibilities.

This is a repository-wide structural survey with detailed tracing of the candidates below. It is not a line-by-line review of every component, a production load test, or a completed migration feasibility study. Findings describe observed code; proposed architectures still need the specified proofs.

The survey covered all five apps, the eight shared packages, infrastructure and CI, migrations, dependency patches, and lint rules. Effect API names and semantics were checked against the installed `effect@4.0.0` declarations and selected implementations. The public v4 API reference was also consulted. No application behavior was changed.

## Priorities

| Priority                       | Finding                                                           | Recommendation                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Highest architectural payoff   | Multiple reactive query systems plus substantial TanStack patches | Compare one representative screen against a direct database read service with Effect atoms                       |
| Highest durable-work candidate | Catalog publishing implements its own recovery protocol           | Evaluate `Workflow` and `Activity`, backed by `SingleRunner` on desktop; add an explicit import-status operation |
| Serious sync alternative       | EventLog already provides journals and replication                | Run a requirements-based comparison against the existing sync contract tests                                     |
| Direct cleanup                 | Effect calls another Effect runtime through Promises              | Compose the underlying layers and keep Promise facades at host boundaries                                        |
| Direct reuse                   | Two AI generation integrations                                    | Extend the existing `LanguageModel` adapter and migrate extraction callers                                       |
| Direct reuse                   | Server API schemas coexist with handwritten feature clients       | Move portable API definitions to contracts and use `HttpApiClient`                                               |
| Ownership and durability       | Mobile scan queue lives in React with detached persistence        | Move it into a scoped service; compare persisted jobs against workflow execution                                 |
| Contract repair                | Recoverable failures become defects or `unknown`                  | Preserve typed failures through domain, storage, RPC, and UI boundaries                                          |

## 1. The read architecture makes us maintain parts of a database and a reactive query library

Evidence:

- `packages/client-db/src/replica/subset-ir.ts` compiles TanStack expressions into our own subset representation.
- `packages/client-db/src/replica/indexeddb-plan.ts` selects IndexedDB scans and residual filters.
- `packages/sync/src/replica/indexeddb/query.ts`, 922 lines, implements comparisons, SQL-like `LIKE`, collation, ordering, keyset scans, bounded sorting, pagination, counts, and distinct values.
- `packages/client-db/src/replica/collection-sync.ts`, 500 lines, manages acquisition, demand, refresh, retries, and publication.
- `packages/client-db/src/replica/coherence.ts` coordinates publication of invoice, item, and stock-movement collections by commit stamp.
- `packages/inventory-react/src/atoms.ts` also reads replica data and manages invalidation dependencies.
- `patches/@tanstack__db@0.9.2.patch` has 3,315 lines; the React DB patch has 779. These are raw patch lengths, including repeated source and build changes, not unique implementation line counts. They change ordered-source loading, publication, refetch behavior, and Suspense collection reuse.

This is the strongest overengineering candidate. The issue is the number of systems that must agree about a read, not the use of TanStack itself.

Compare the existing product-list and invoice-detail paths with a bounded domain read service that returns a complete, transactionally consistent result. Feed that result into `Atom`/`AsyncResult`; translate commit notices into `Reactivity` invalidations once. `Reactivity` is process-local invalidation, not a database, cache, or cross-collection transaction. It does not by itself solve invoice coherence.

For browser persistence, evaluate either a smaller set of explicit IndexedDB domain queries or SQLite WASM so SQL semantics are owned by SQLite. SQLite OPFS has real worker, browser, and concurrency constraints; this is a measured storage decision, not a promised drop-in replacement. See the [official persistence documentation](https://www.sqlite.org/wasm/doc/trunk/persistence.md).

The comparison must preserve bounded reads, optimistic updates, stable ordering, subscription cleanup, and an invoice result whose related rows come from the same database snapshot. Measure first paint, repeated navigation, memory, and update latency. Keep the existing patches until equivalent behavior is demonstrated. The success criterion is deleting adapters and patches, not adding a fourth query abstraction.

## 2. Catalog publishing is a genuine Workflow/Activity candidate

`apps/desktop/electron/replica-publish.ts`, `replica-publish-files.ts`, and `packages/client-db/src/replica/node-publish.ts` implement staging, sealing, marker persistence, commit, uncertain outcomes, resume, and source archival.

The clearest design smell is `askingWhetherItLanded` in `replica-publish.ts`. It changes the sealed part count and resubmits with `acceptChangedFile` to distinguish a previously committed import from a new attempt. That makes a read of remote state depend on the ordering of validation and idempotency checks in a mutation endpoint. Add a typed import-status/receipt operation instead.

A proposed workflow has a stable execution identity containing destination organization and import identity. Its steps prepare an immutable source snapshot, stage individually identified parts, persist the seal, request the existing atomic server commit, reconcile its receipt, and archive the source idempotently. Named `Activity` results can replace custom step-completion bookkeeping. `DurableDeferred` is available if an operation really waits for an external completion; `DurableClock` supplies persistent waits when needed.

The installed `Cluster.SingleRunner.layer` supplies SQL-backed mailbox storage in one process. It can support `ClusterWorkflowEngine.layer` on desktop without deploying a multi-node cluster. Keep execution storage outside a database file the workflow archives or replaces. The existing SQLite and Crypto services provide useful infrastructure, but startup, shutdown, and file ownership still need integration work.

`Activity` only memoizes completed results. Work before a crash or suspension can run again. Preserve the server's import identity, immutable payload checks, receipts, and transactional commit. Archival after commit is not a reason to compensate by undoing committed inventory. Do not remove the existing marker until the new persisted execution record covers the same recovery cases.

Proof: terminate the process after each step, including after remote commit before recording the reply; restart; verify one import, safe handling of a changed local file, correct destination ownership, and eventual archival. API references: [Activity](https://effect.website/docs/v4/api/effect/workflow/Activity), [Workflow](https://effect.website/docs/v4/api/effect/workflow/Workflow). Local declarations: `effect/dist/cluster/SingleRunner.d.ts` and `ClusterWorkflowEngine.d.ts`.

## 3. EventLog deserves a real comparison with the sync engine

No application import of `effect/eventlog`, `effect/workflow`, or `effect/cluster` was found. The repo's existing guidance labels EventLog as worth knowing; its overlap is substantial enough to investigate directly.

The installed EventLog implementation includes typed events and handlers, SQL and IndexedDB journals, local change subscriptions, remote sequence tracking, duplicate handling, conflict inputs to handlers, compaction hooks, remote RPC, chunked writes, and encrypted or unencrypted server options. These overlap with the custom journal, transport, and replay responsibilities in `packages/sync`.

However, our contract is authoritative inventory command acceptance. Two disconnected clients can both propose selling the last unit; the authority must accept only the permitted sale and return an explicit refusal for the other. Our code also owns optimistic stock overlays, rollback, receipts, atomic multi-entity groups, snapshots, epochs, hard deletes, schema compatibility, and cadence-controlled digest verification.

EventLog's handlers can receive conflicts, but that does not establish equivalence to those business and recovery guarantees. SQL journal writes can participate in the supplied SQL transaction; IndexedDB journal persistence does not automatically make separate application storage atomic with the journal. Its remote protocol and identity model also differ from ours.

Use `packages/contracts/src/sync/fixtures/last-unit-invoice.ts` and the current authority/replica contract tests as the acceptance specification. Compare a single invoice flow across two replicas, server acceptance, disconnect/reconnect, replay, rejection, and restart. Include snapshot recovery, membership changes, and mixed client versions before deciding on replacement.

Adopt it if it removes most generic replication machinery while leaving a small authority policy. Reject the design if we must retain the existing protocol and add another event journal beside it. This is a high-value architecture investigation, not grounds to declare the current sync engine unnecessary. References: [EventLog](https://effect.website/docs/v4/api/effect/eventlog/EventLog), installed `EventJournal.d.ts`, `SqlEventJournal.ts`, and `EventLogRemote.d.ts`.

## 4. Cluster fits durable ownership; deploying it everywhere would add another platform

`Entity` provides identity-based routing and handler ownership. `ClusterSchema.Persisted` and SQL message storage supply durable requests; `ClusterSchema.WithTransaction` requests transactional handling when the configured storage implements it. Both annotations default to false. A cluster import alone gives neither guarantee.

An organization inventory authority is a plausible entity boundary. It could centralize command handling in TypeScript and reduce divergence between the 1,651-line local authority and authoritative Postgres functions. But `local-authority.ts` already reuses `decideCatalogRow` and `projectCommand`; there is shared domain logic worth preserving. Storage constraints, receipts, and server authorization remain necessary even with entity serialization.

The current server is a stateless Worker with Postgres transactions, and `OrgHub` is a Cloudflare Durable Object with hibernated WebSockets. A distributed cluster introduces runners, shard ownership, durable mailbox storage, and an operational lifetime that the current deployment does not provide. It does not automatically replace hibernation or provide mobile background execution.

Evaluate `SingleRunner` for desktop workflows first. Evaluate organization entities only as part of an explicit server-authority redesign. For server-side durable AI/import jobs, the installed Alchemy package also has Effect-native Cloudflare workflow steps in `alchemy/src/Cloudflare/Workflows/Workflow.ts`; these are a separate integration, not an existing adapter for Effect's `WorkflowEngine`. Compare that hosted option before building custom workflow-engine glue.

Reference: [Entity](https://effect.website/docs/v4/api/effect/cluster/Entity), installed `ClusterSchema.d.ts` and `SingleRunner.d.ts`.

## 5. Runtime ownership is split where it should compose

`replica-worker.ts` runs an Effect RPC server. `replica-worker-handlers.ts` opens the replica through a Promise-returning facade. `replica-runtime.ts` creates another `ManagedRuntime`, a separate replica lifetime scope, and a publisher with its own scope. Worker handlers wrap the resulting Promise methods in `Effect.tryPromise` and reduce failures to `ReplicaWorkerFailure { message }`. Token and health callbacks also use default-runtime runners.

Compose the replica layers directly under the worker's RPC layer. Expose effectful store/engine operations and health streams internally. Keep the Promise facade for actual foreign hosts. Use captured callback runtimes such as `FiberMap.runtimePromise` or `FiberSet.makeRuntime` where a callback starts work. This removes repeated conversions and makes cancellation, tracing, finalization, and errors have an identifiable owner.

The return trip for commit notices also deserves consolidation: `ReplicaStore.commits` becomes a callback publisher and is then turned back into a stream in the worker. Preserve notice coalescing semantics. A sliding PubSub that drops a touched key is not equivalent to merging invalidations.

The reverse worker-to-main requests in `replica-pending.ts` still use custom correlation over request streams. RPC can own this on a suitable reverse transport, but the existing main-to-worker RPC connection is not automatically bidirectional. Do not propose deleting the map without specifying the reverse transport and credential boundary.

## 6. Mobile scan work needs one service owner

`apps/mobile/src/scan/drafts.tsx` creates a runtime at module load, holds an unbounded queue in React, mirrors draft state into a ref, runs a worker from an effect, and writes draft changes through detached fibers. `writeDraft` updates visible state before persistence finishes; persistence failures are logged and ignored. The file-backed store is already a useful adapter and serializes access.

A `ScanJobs` service can own state through `SubscriptionRef`, scheduling, persistence, and typed failures. React should observe state and issue commands. Distinguish an unsaved edit from a persisted draft instead of letting a logged failure look saved.

For one-step parsing jobs, evaluate `PersistedQueue` keyed by draft ID and input revision. It already supports durable claims, attempt tracking, deduplication, retries, and SQL storage. For a sequence whose completed intermediate results are expensive, evaluate `Workflow` plus `Activity`. `DurableQueue` connects a workflow to persisted workers, but exhausted items require an explicit recovery policy; the installed API documents that the waiting deferred otherwise remains unresolved.

Persisted queues deliver at least once. AI requests may repeat after a crash, so bound duplicate cost and reject stale results by revision. Put draft metadata and accepted job intent in one transaction if they must become durable together. A timer or workflow cannot make Android execute while the app is suspended; native background scheduling is a separate requirement.

## 7. Reuse the model integration already present

Global search uses `LanguageModel.generateObject` in `packages/services/src/global-search/service.ts`. `apps/server/src/ai/language-model.ts` already adapts Workers AI to that service. Product scans and invoice extraction instead use `GenerateModelJson`, `ModelPrompt`, a second `ai.run` wrapper, and fenced-JSON recovery in `model-json.ts`.

Extend the existing adapter with per-operation model settings, then migrate extraction. Preserve the current token budgets: invoice extraction uses 4,096, product scanning 512, while the existing language-model adapter fixes 1,024. Preserve gateway behavior and the deliberately tolerant extraction schemas and domain normalization. `generateObject` does not automatically replace the custom malformed-JSON salvage behavior; make that policy explicit in one place.

Document conversion through `ai.toMarkdown` remains a separate capability. `LanguageModel` does not replace it. `ExecutionPlan` is useful only if real fallback providers or models are required; adding one for a single provider would add indirection.

## 8. Finish sharing HTTP contracts

`apps/server/src/http/api.ts` defines product scans, uploads, and global search with `HttpApi`. Web `host/global-search.ts` and `host/invoice-upload.ts`, and mobile `scan/parse-client.ts`, still spell paths, payload handling, and response decoding separately. Auth and sync already use generated clients.

Move portable feature endpoint and error schemas to contracts and build clients with `HttpApiClient.make` or `group` over the authenticated HttpClient. Keep server middleware implementations on the server. Preserve multipart limits and the scan client's Retry-After behavior. The installed generated client supports raw/decoded response modes, so response metadata need not require an entirely handwritten client. `AtomHttpApi` is suitable for direct online feature UI, not as a replacement for local-first replica reads.

## 9. Restore typed failures instead of wrapping them away

`sqliteReplicaReads` in `packages/client-db/src/replica/sql-client-session.ts` applies `orDie` to reads. Catalog/invoice/purchasing projection functions throw ordinary errors and `catalog-commands.ts` captures them as `unknown`. The replica worker also suppresses open failure into an absent session, losing the original cause and presenting a generic unbooted worker later.

Use pure `Result` values for domain refusal, tagged storage failures for recoverable I/O, and schema-declared RPC failure unions. Keep defects for bugs. This simplifies recovery decisions and UI messages more than replacing syntax does. Failures at host boundaries may become Promise rejections, but Effect-to-Effect calls should retain their error types.

## 10. Some rules and bespoke behavior need reconsideration independently of Effect

- The blanket runtime-`typeof` rule also rejects narrowing of already-validated scalar unions. `indexeddb/query.ts` decodes numbers, strings, and booleans repeatedly inside comparison helpers. Decode stored rows once; use ordinary narrowing or `Predicate` inside trusted code. Re-running Schema is not inherently better architecture.
- `no-comments` rejects every comment in covered files, while the repo also requires `// SAFETY:` for justified casts. Align those policies. Names and types cannot always explain a protocol's historical constraint or crash-consistency rationale.
- CI runs standard checks but does not run the separately required `lint:design` script. Put the actual design-system rule in the automated gate instead of relying solely on instructions.
- Invoice extraction returns early when any CSV lines exist, before processing non-CSV attachments. If mixed uploads are allowed, PDFs in such a selection are skipped. This is a source-level behavioral finding, not a reproduced runtime result. Clarify the intended mixed-upload contract and then combine results or reject mixed input explicitly.

## What I would keep

- The sync scheduler already uses Schedule, queues, fibers, and a pure session state machine. Its visibility, ownership, retry-after, recovery, and digest rules are domain policy. Replacing it with one `Effect.repeat` would lose behavior.
- Receipt-based resolution of an uncertain remote mutation. Neither Activity nor a durable queue guarantees exactly-once external effects.
- Cross-tab preference handling. `Atom.kvs` alone does not provide the current storage-event adoption semantics.
- Cloudflare rate-limit bindings and cache adapters. A process-local limiter/cache is not equivalent, and sharing in-flight I/O between Worker invocations has host lifetime constraints.
- The tiny mobile keyed lock registry until a proper host scope exists. An RcMap conversion that introduces more lifetime machinery than it removes is not a win.
- Domain calculations for stock allocation, purchasing, and demand forecasting. Effect supplies execution machinery, not these rules.
- Platform-specific SQLite, Electron, Expo filesystem/camera, and hibernated WebSocket adapters where the host API has no equivalent implementation already available.
- Registry-owned UI components without current importers. They are inventory, not evidence of dead application code.

## Suggested order and proof

1. Compose the replica worker's layers and preserve errors. Verify worker shutdown, in-flight cancellation, startup failure, and notice delivery.
2. Consolidate AI and HTTP clients. Exercise existing extraction fixtures, budgets, status mapping, and multipart/Retry-After behavior.
3. Move mobile jobs into a service and decide whether persisted jobs or workflow steps are the simpler durable representation.
4. Build the catalog-publish workflow comparison and replace the malformed-commit status probe with an explicit receipt read.
5. Compare one direct-read screen with the patched TanStack path. Keep whichever demonstrably owns less machinery while meeting the same behavior and performance requirements.
6. Evaluate EventLog and organization entities against the existing sync acceptance tests. Make the architecture decision from how much code and operational responsibility disappear, not from how many Effect modules are used.

Baseline validation passed: `vp install`, `vp check`, `vp run -r check`, and `vp test`. The test run reported 54 files and 325 passing tests. These establish the current baseline, not correctness of the proposed replacements. No live backend, desktop/mobile interaction, crash test, or performance comparison was run for this audit.
