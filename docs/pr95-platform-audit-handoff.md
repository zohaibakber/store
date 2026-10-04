# PR 95 refactor and platform audit handoff

Audited on 2026-10-04 at `65b3a77d40bd2f6c805291144850f8d250c5f2b0`, branch `effect-restructure`, [PR #95](https://github.com/zohaibakber/store/pull/95). Durable Objects, Effect, and Drizzle were reviewed in parallel, followed by a combined review of ownership and contracts. This document records recommendations; production fixes have not been implemented.

## Goal

Find where our abstractions make the system easier to understand and where we are still maintaining infrastructure that Cloudflare, Effect, or Drizzle can own. Check whether Durable Objects have the right responsibilities, whether their guarantees are being used correctly, and whether an identifiable coordination problem would benefit from another DO. Hunt for bugs while tracing those boundaries.

Judge each replacement by the responsibility and code it removes, the guarantees it preserves, and the operational cost it introduces. Preserve inventory rules, offline behavior, and recovery semantics. A new library import alone is not an improvement.

## Assessment

The refactor is a substantial improvement. Named replica RPC operations, transactionally stamped reads, worker-owned commands, typed domain refusals, and direct Effect layer composition replace considerable custom query and publication machinery. Keep that direction. **Fix A1 and A2 before merging PR 95.** Both are reproduced regressions introduced by the PR.

The remaining work is mainly resource ownership, recovery, and validation. The existing organization DO is well placed. Drizzle and Effect are already doing more of the work than a superficial search for custom classes suggests.

The earlier [Effect audit](effect-audit-2026-10-04.md) describes the architecture before this refactor. Its deleted query machinery and proposed Workflow/EventLog migrations are not a current implementation plan. Read the current [known departures](../.agents/skills/effect/references/DEPARTURES.md) before reopening those decisions.

## Work order

| ID  | Priority and evidence                              | Work                                                               |
| --- | -------------------------------------------------- | ------------------------------------------------------------------ |
| A1  | P2, reproduced PR regression                       | Make history beyond 500 rows reachable through bounded pages       |
| A2  | P2, reproduced PR regression                       | Drain commands before capturing the restore version floor          |
| A3  | P2, reproduced existing bug                        | Recover mobile scan retry deadlines and exhausted retries          |
| A4  | Source-confirmed host lifetime risk                | Remove shared in-flight SQL lookup caching between Worker requests |
| A5  | Refactor                                           | Put command admission under the replica session owner              |
| A6  | Refactor with persistence risk                     | Move mobile scan acceptance and execution into a scoped service    |
| A7  | Refactor                                           | Complete mobile replica layer composition and delete the facade    |
| A8  | Direct native reuse                                | Consolidate model generation through the existing Effect adapter   |
| A9  | Reproduced validation gap; current schemas clean   | Add native Drizzle schema drift checks                             |
| A10 | Source-based race concern; replacement needs proof | Replace the Drizzle Kit symlink wrapper with dependency metadata   |
| A11 | Source-confirmed validation omission               | Run design lint in CI                                              |

A1–A2 belong in the PR correction. Existing bugs and broader refactors can follow separately. A3 and A6 touch the same scan owner and should share a design. A5 and A7 share the replica lifetime design. Other areas can proceed independently once contracts are agreed. Changes to shared files need one owner.

## A1. Bound each history page, not the total reachable history

Evidence: [atoms.ts](../packages/inventory-react/src/atoms.ts), `boundedHistory`, `invoiceHistoryAtom`, and `movementHistoryAtom`; [queries.ts](../packages/inventory-react/src/queries.ts), `useHistory`; [read handlers](../packages/client-db/src/reads/handlers.ts), `InvoiceHistory` and `StockMovementHistory`; [history contract](../packages/contracts/src/replica/reads/shared.ts).

`boundedHistory` caps the cumulative request at `MAX_HISTORY_ROWS = 500`. With more rows, the handler still reports `hasMore`. At a page size of 50, moving from page 10 to page 11 requests the same first 500 rows. Subsequent `fetchNextPage` calls keep setting page 11, so older invoices and movements are unreachable.

Reproduction used real SQLite, in-process RPC links, and the actual workspace atoms with 501 invoices. Increasing pages returned the same 500 invoices and `hasMore: true`. The temporary test was removed.

Implement explicit history pagination in the named RPC contracts. Prefer a cursor with deterministic ordering and a row-ID tie-breaker; a correctly bounded offset design is also possible. Keep each response bounded. Define how accumulated pages refresh after a commit or generation change. Do not solve this by removing all limits or raising the total cap.

Verify more than 500 rows are reachable exactly once, the final page reports completion, equal timestamps are ordered consistently, and inserts/deletes/reconnects do not silently lose or duplicate history. Invoice items must remain consistent with their invoice page snapshot.

## A2. Capture the restore floor after command admission drains

Evidence: [replica-worker-handlers.ts](../apps/desktop/electron/replica-worker-handlers.ts), `releaseForRestore`; [renderer-admission.ts](../apps/desktop/electron/renderer-admission.ts), `commandAdmission`; [commit-notices.ts](../packages/client-db/src/store/commit-notices.ts), `openingNotice`.

`releaseForRestore` reads `stamp` before waiting on `commandTurn`. An already admitted command can commit after that read. The restored file is then sealed using a version floor older than the last version observed by a renderer. `openingNotice` does not invalidate a subscriber whose previous version is ahead of the restored version in the same generation.

Reproduction used actual MessagePort RPC and SQLite. A real category command was paused inside its admitted turn, restore began, and the command resumed. The old file reached version 3 while the staged file was sealed at version 1. Reconnecting with the old stamp yielded no full invalidation. The temporary test was removed.

Make stopping admission, draining admitted commands, and capturing the final stamp one ordered handoff. Capture the stamp while holding the same session gate and while SQL remains open. Close the session and seal the staged file afterward. Also establish what `openingNotice` should do with a version-ahead stamp; a defensive invalidation must not replace the ordering fix.

Verify a delayed command followed by restore, queued commands during shutdown, repeated restore, scope disposal, and renderer reconnection. The resulting stamp/invalidation must force stale reads to refresh, and no command may enter a closed SQL session.

## A3. Recover mobile scan retry deadlines

Evidence: [drafts.tsx](../apps/mobile/src/scan/drafts.tsx), `eligibleForParse`, the retry schedule and startup enqueue effect; [review-screen.tsx](../apps/mobile/src/scan/screens/review-screen.tsx), the `RateLimited` banner.

A restored rate-limited draft with a future `retryAt` is skipped during load. Nothing wakes it when that deadline passes. Four consecutive 429 responses also exhaust `Schedule.recurs(3)`, leave the draft rate-limited, clear the pause indicator, and schedule no further work. The UI promises automatic resumption and offers no retry action in that state.

Two fault reproductions passed using the actual provider, React, Effect, parser, and HTTP contract, with native/auth/file edges replaced by test adapters. A restored deadline 250 ms ahead caused zero requests after 500 ms; manual enqueue succeeded. Four 429 replies caused exactly four requests and no fifth request after the server became healthy. Temporary tests were removed. The same behavior exists at the PR base.

Recover absolute deadlines from `draft.json`. Let the scan service own one scheduled wake for the earliest eligible deadline. Keep automatic retries bounded; when attempts end, expose a truthful retryable state and manual action. Cover reopening before a deadline, prolonged throttling, offline/online changes, discarded drafts, changed input revisions, and scope closure. Do not promise mobile execution while the OS suspends the app.

## A4. Keep Worker lookup I/O inside its invocation

Evidence: [live-horizon.ts](../apps/server/src/inventory/live-horizon.ts), `makeInventoryLive`; [infra.ts](../apps/server/infra.ts), where it is built; [Alchemy guidance](../.agents/skills/effect/references/ALCHEMY.md), “Values cached across requests.”

The isolate-owned `Cache.makeWith` can share a pending SQL lookup between requests for one replica. That conflicts with the repo's request ownership rule. Cloudflare documents that request-scoped I/O must not be reused across invocations. This is a source-confirmed risk; no deployed hang or cross-request error was reproduced. [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

Start by deleting the one-second cache and calling the statement directly. If measurements justify caching, retain only completed, decoded values in a bounded `Ref` with expiry; each cache miss must own its own lookup. Do not cache SQL connections, DO stubs, streams, or pending request effects across invocations.

Verify simultaneous admissions for the same replica when one caller disconnects or fails. The other must finish independently. Exercise this against the real dev Worker before claiming the host-specific failure is fixed. Preserve replica ownership checks and invocation-local DO stub acquisition.

## A5. Give command admission one session owner

Evidence: [renderer-admission.ts](../apps/desktop/electron/renderer-admission.ts), [store handlers](../packages/client-db/src/store/handlers.ts), [command handlers](../packages/client-db/src/store/commands.ts), and [inventory services](../packages/inventory-react/src/services.ts), `makeInventoryLinks.command`.

Desktop serializes commands in RPC middleware. Mobile depends on a renderer-side semaphore. The read → project → enqueue invariant belongs beside the command implementation, and restore needs that same owner.

Allocate one admission service per replica session and provide it to every desktop port and in-process handler. A semaphore allocated by each RPC layer build will not serialize separate ports: [renderer servers](../apps/desktop/electron/renderer-servers.ts) use `Layer.fresh`. Keep long-lived commit/health streams outside the mutation permit. Preserve bounded wait/run behavior and typed busy/restarting failures.

After proving shared admission, delete the renderer command semaphore and duplicate desktop mutation admission. Keep transport-specific read deadlines where useful. Verify two clients issuing concurrent commands, invoice-number allocation, stock refusal, cancellation, queued shutdown, and restore draining. Avoid reacquiring the same permit inside an already admitted command.

## A6. Make scan persistence own durable acceptance

Evidence: [drafts.tsx](../apps/mobile/src/scan/drafts.tsx), the module runtime, `writeDraft`, `commitDrafts`, `createDraft`, and removal; [draft-store.ts](../apps/mobile/src/scan/draft-store.ts).

Visible drafts are updated before detached file persistence completes. Persistence failures are logged and ignored; creation can return success before its supporting write, and removal can disappear from the UI before deletion succeeds. This ordering is source-confirmed; a real device storage failure was not reproduced.

A scoped `ScanJobs` service should own state, persistence, queue, retry deadlines, and worker lifetime. React observes state and sends commands. Commit acceptance before claiming durable success, or model an explicit unsaved optimistic state with an actionable storage error. Preserve edits made while parsing and reject stale results by input revision.

Delete the module runtime, React worker lifecycle, mirrored mutable ownership, and detached persistence paths once all callers move. Keep `draft.json` as the durable boundary. The previously evaluated persisted queue would duplicate that representation. Verify blocked/failing writes, failed deletion, remount, restart, cancellation, and A3's deadline cases.

## A7. Finish mobile replica layer composition

Evidence: [mobile inventory host](../apps/mobile/src/inventory/host.ts), [sql-client facade](../packages/client-db/src/replica/sql-client.ts), [sql-client-session.ts](../packages/client-db/src/replica/sql-client-session.ts), and [replica-runtime.ts](../packages/client-db/src/replica/replica-runtime.ts).

Mobile enters a Promise facade that opens another `ManagedRuntime`; desktop now builds the session layers directly. Build the existing SQLite replica layers under a mobile host/session scope. Keep Promise conversion at actual native or React host edges. Apply A5's session-owned admission.

Migrate every remaining facade caller and test host, then delete the obsolete runtime, lifetime/publisher/notice adapters, and facade `orDie` reads where their imports disappear. Preserve typed storage failures. Move keyed locks under the host scope when it exists; the current six-line lock registry is not an independent reason to introduce `RcMap`.

Verify close-before-reopen, rapid account/organization changes, database exclusivity, session disposal, in-flight cancellation, commit notice overflow, reconnection, and registry isolation. A single host should own logger/tracer and callback entry runtimes. Do not expand this into an Electron bootstrap rewrite without measuring startup and lifecycle effects.

## A8. Consolidate the two model generation integrations

Evidence: [language-model.ts](../apps/server/src/ai/language-model.ts), [workers-ai.ts](../apps/server/src/ai/workers-ai.ts), [model-json.ts](../packages/services/src/model-json.ts), and the global-search, product-scan, and invoice-extraction services under `packages/services/src`.

Extend the existing `LanguageModel` adapter with explicit operation configuration, then migrate generation callers. Preserve scan/global-search/invoice budgets of **512 / 1,024 / 4,096** completion tokens. Preserve the intended AI Gateway difference: search uses it; extraction/scanning currently use the binding directly.

Extraction tolerates optional scalars, fenced JSON, surrounding prose, response envelopes, and already decoded objects. Strict structured output is not automatically equivalent. Consolidate shared JSON recovery at the provider/parsing boundary; keep invoice and product normalization in their owning domain services. Document conversion through `toMarkdown` remains a separate capability. [Effect LanguageModel API](https://effect.website/docs/v4/api/effect/ai/LanguageModel)

Delete the second generator and duplicate prompt/error plumbing after the callers migrate. Verify budgets, gateway options, malformed/truncated output, schema tolerance, cancellation, and extraction fixtures. No live Workers AI request was made during the audit.

## A9. Add native Drizzle schema drift validation

Evidence: [db package scripts](../packages/db/package.json) and [CI](../.github/workflows/ci.yml). `drizzle-kit check` validates migration history, not the current schema against the latest snapshot. The audit proved it can pass with a nonexistent schema path or an unmigrated table. All four actual schemas returned `no_changes`; **no current drift was detected**. [Drizzle check](https://orm.drizzle.team/docs/drizzle-kit-check), [Drizzle generate](https://orm.drizzle.team/docs/drizzle-kit-generate)

The installed `1.0.0-rc.5-ab785fc` CLI provides a native dry run. From `packages/db`, run these commands sequentially:

```bash
node scripts/drizzle-kit.cjs generate --config drizzle.auth.config.ts --explain --output json
node scripts/drizzle-kit.cjs generate --config drizzle.postgres.config.ts --explain --output json
node scripts/drizzle-kit.cjs generate --config drizzle.replica.config.ts --explain --output json
node scripts/drizzle-kit.cjs generate --config drizzle.analytics.config.ts --explain --output json
```

Add a small checker requiring successful execution, valid JSON, the expected dialect, and exactly `status === "no_changes"`. A planned migration returns `status: "ok"` and also exits zero; exit status alone is insufficient. Fail on unresolved rename hints, unexpected statuses, malformed output, or spawn failure. These newer flags are confirmed by [CLI source at the installed commit](https://github.com/drizzle-team/drizzle-orm/blob/ab785fcd99710d6d136ffbfd121b7aeb96e4d51d/drizzle-kit/src/cli/schema.ts) and installed help.

Keep history checks and migration-bundle freshness checks. Verify an isolated unmigrated column/table fails, the corresponding migration makes it pass, all real schemas pass, and validation changes no migration files. Do not use database `push` or `migrate`, or rewrite applied migrations to make this check green.

## A10. Delete the shared symlink workaround after a clean-install proof

Evidence: [drizzle-kit.cjs](../packages/db/scripts/drizzle-kit.cjs) creates an ORM symlink inside Kit's pnpm dependency directory and removes it on exit. Concurrent processes can race creation or unlink a dependency another process still needs. Those races were inferred from source, not reproduced.

Prototype an exact-version `packageExtensions` declaration for Kit's missing ORM dependency/peer dependency. Confirm `vp install` resolves the pinned, patched ORM correctly. Run direct Kit checks and dry runs for all four configs, plus concurrent invocations. Then delete the wrapper and migrate its callers. Keep pnpm's isolated linker. [pnpm packageExtensions](https://pnpm.io/settings/dependency-resolution#packageextensions)

Retain the Drizzle compatibility patch until an upstream pinned release resolves the obsolete `effect/unstable/sql/SqlError` imports and the relevant checks pass. Record what upstream change permits deletion; do not remove a patch solely because a newer version exists.

## A11. Put required design lint in the CI gate

[CI](../.github/workflows/ci.yml) runs `vp check`, schema checks, and tests, but omits the separately required `vp run lint:design`. Add that command to verification. Prove application design violations fail while registry-owned COSS primitives keep their existing policy.

## Durable Objects: use the current owner more fully when the requirement warrants it

### D1. Native alarms can own server-side socket expiry

`OrgHub` correctly uses hibernation, tags, attachments, automatic ping replies, and typed `publish`/`revoke` methods. Matching automatic pings bypass `webSocketMessage`, so a custom idle client can keep an expired connection alive. Publishing checks expiry before sending inventory data; the normal client renews two minutes before expiry. This is lifecycle hardening, not a reproduced inventory leak. [DO state](https://developers.cloudflare.com/durable-objects/api/state/)

If server-enforced idle expiry is wanted, use the DO's single native alarm to close expired sockets and schedule the next earliest attachment expiry. Recompute from native socket attachments on wake. Preserve automatic replies and hibernation; avoid a timer registry or durable job queue. Verify ping-only clients, hibernation, earlier new expiries, and repeated alarm delivery with workerd. [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

### D2. Durable admission fences require a revocation policy change

`revoke` closes current sockets without preventing reconnect with a still-valid JWT. The actual hub reproduction confirmed connect → revoke → reconnect → publish delivers to the replacement socket. Access tokens last one hour. [Authentication design](../packages/auth/ARCHITECTURE.md) explicitly accepts access until expiry, so this is an accepted tradeoff, not a newly discovered authorization regression.

If immediate revocation becomes required, the per-org DO is a plausible owner for versioned admission fences. Design this with authoritative D1 permissions/session state and reliable propagation. Define whether the guarantee covers socket admission, all HTTP operations, or both. A permanent blocked-user flag breaks re-invitation. Verify old JWT reconnects, admission races, hibernation, failed propagation, demotion, sign-out, and re-invitation. Do not silently change the existing auth contract during the refactor.

### D3. Prototype query-owned coordination only after measuring duplicate search cost

[Global-search routes](../apps/server/src/routes/global-search.ts) perform extraction after a cache miss. Concurrent misses can duplicate expensive upstream/model calls, and the current Cache API is local to a data center. [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)

A DO keyed by normalized query plus result/model version could coordinate one computation and its completed result across callers. Measure duplicate calls first, then compare routing latency, cost, storage, expiry, caller disconnection, and restart recovery. Preserve caller-specific authorization/rate limits and current normalization. Restart can still repeat an external AI request. Adopt only if measured savings exceed the added system's cost.

## Custom code and native integrations to keep

- **Postgres authority and receipts.** Transactions, refusal, sequence allocation, import status, retention and database locks belong beside the authoritative inventory data. DO serialization or ORM CRUD cannot replace their crash and concurrency guarantees.
- **Best-effort live fanout.** Persisted Postgres history and pull repair missed notifications. A DO outbox would add a durability system without a required delivery guarantee.
- **Ephemeral hub cursor.** It is a hint rebuilt from admission/publish inputs. Attachments survive hibernation. Adding SQLite merely to persist that hint adds ownership rather than removing it.
- **The generic replica Drizzle adapter.** It accepts the existing Effect `SqlClient` and delegates transactions to it. The native node adapter imports a native driver and is not a shared/mobile replacement. Keep the bridge private; delete it only when an equivalent generic adapter preserves transaction sharing, codecs, rollback and native-free entrypoints.
- **Existing Drizzle codecs and migrations.** Row codecs already derive through `drizzle-orm/effect-schema`; migration execution already uses Effect's SQL migrator. FTS, stock overlays and domain SQL are actual application semantics.
- **The sync state machine.** Backoff already uses `Schedule`; scoped fibers and queues already own execution. Ownership, visibility, refusals, recovery and digest cadence are domain policy.
- **Current durable representation.** EventLog, Workflow/SingleRunner and persisted scan queues were evaluated and rejected for the current requirements. `Effect.tx` is in-memory transactional state, not SQLite/Postgres durability. Reopen those decisions only with a new requirement and demonstrated deletion.
- **The isolated renderer RPC lifetime workaround.** The ten-second linger has a measured Effect 4 lifetime reason. Remove it only when mounted reads, in-flight commands and generation changes pass without it. Expand reconnect/overflow/lifecycle coverage around real boundaries when changing them.
- **Host adapters and distributed primitives.** Electron, Expo files/camera, hibernated sockets, cross-tab storage adoption, and Cloudflare cache/rate limits have host semantics that generic in-process services do not supply.

When touching remaining runtime edges, preserve tagged errors through Effect-to-Effect calls, use the owning runtime for callbacks, and have service layers own dependencies. Avoid broad renaming or `Map` replacement campaigns. Measure output cardinality of categories/suppliers and batches-by-ID before declaring bounded inputs sufficient or adding another paging abstraction.

## Release and API policy

The checked release page and installed dependencies both use **Effect 4.0.0**. Its native RPC/Socket/AI, transactional memory and durable-work capabilities are available; there is no pending Effect upgrade needed for this plan. Some modules remain unstable across minor releases. Verify actual installed signatures and semantics before replacing an adapter. [Effect 4.0.0 release](https://github.com/Effect-TS/effect/releases/tag/effect@4.0.0)

Drizzle ORM and Kit are pinned together at `1.0.0-rc.5-ab785fc`. Distinguish an API shown in newer docs from one in the pinned build. Native Alchemy schema-aware socket attachments are worth considering when changing the socket adapter, provided they delete code and preserve the pure fanout seam; the small decoder alone does not justify a broadcast rewrite.

## Agent execution and verification

1. Read [AGENTS.md](../AGENTS.md), the [Effect skill](../.agents/skills/effect/SKILL.md), its relevant references, and the current source for the task. Reproduce the stated behavior before editing.
2. State the invariant and the owner. For a replacement, list the old files/adapters that should disappear and prove the native facility covers their semantics.
3. Fix A1–A2 first. Keep independently reviewable changes; do not combine the sync protocol, auth policy and platform experiments into a single rewrite.
4. Run `vp install` as required, `vp check`, `vp run -r check`, and `vp test`. Run `vp run lint:design` for web UI changes. Use temporary reproduction tests or extend existing suites; retain tests only for otherwise unguarded invariants under the repository's test policy.
5. Verify lifecycle and crash boundaries using the actual artifact where required. A fake socket test does not establish DO hibernation/alarm behavior; an in-memory restart does not establish abrupt process-loss recovery.
6. Report deleted responsibilities, behavior preserved, checks performed, and any unverified deployment/device conditions. Update known departures only when the corresponding work is actually completed.

Rerun the [capability inventory](../scripts/audit-capabilities.mjs) from the repository root:

```bash
node scripts/audit-capabilities.mjs
node scripts/audit-capabilities.mjs --details
```

It scans tracked source/configuration/patch files, excludes generated files and migrations, and reports locations of native integrations, runtime edges, SQL adapters and ordering mechanisms. Matches are evidence to inspect, not automatic findings or an exhaustive architectural proof.

Audit baseline validation passed: `vp install`, `vp check`, `vp run -r check`, `vp test` (50 files, 278 tests), and `vp run lint:design`. Focused temporary reproductions established A1, A2 and A3; Drizzle CLI experiments established A9. The handoff and inventory are the only retained changes. No live backend, device storage-failure test, deployed DO alarm/concurrency test, crash-kill test, or load/cost comparison was performed. Those proofs remain work for the relevant implementation task.
