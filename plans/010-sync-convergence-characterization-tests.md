# Plan 010: Characterization tests for sync convergence — real server apply path, real client pull path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- apps/api/src/sync packages/persistence/src/sync-engine.ts packages/persistence/src/sync-engine.test.ts packages/persistence/src/test-support.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: LOW (tests only — no production code changes except optional test-only exports)
- **Depends on**: none. **Blocks** the two sync performance backlog items
  (client and server per-change roundtrip elimination) — those must NOT be
  attempted until this plan is DONE.
- **Category**: tests
- **Planned at**: commit `fe1891d6`, 2026-07-19

## Why this matters

The repo's core promise is multi-device offline convergence, and its most
intricate code is the server apply path (`apps/api/src/sync/apply-change.ts`,
253 lines; `inventory.ts`'s `reconcileBatch`) and the client pull path
(`sync-engine.ts`'s `upsertRemoteChange` with rowVersion conflict handling).
Today neither is exercised by any test: the api's `service.test.ts` stubs the
whole database (`Layer.succeed(SyncDatabase, {...})`), and every
`sync-engine.test.ts` response carries `changes: []`. Last-writer-wins
conflicts and stock reconciliation could silently corrupt inventory and no
test would notice. These characterization tests lock in current behavior and
are the prerequisite for the planned performance rework of both loops.

## Current state

- **Server side** — `apps/api/src/sync/database.ts:34-60`:
  `makeDatabase(db: SyncDrizzle)` builds `exchange` as
  `Effect.fn("SyncDatabase.exchange")` running, inside one
  `db.transaction`: `applyOperation(tx, actor, operation)` per operation,
  then a cursor-paged pull from `syncChangeLog` (PAGE_SIZE 500).
  `SyncDrizzle` comes from `database.client.ts`:
  `PgDrizzle.makeWithDefaults({ relations: remoteRelations })` using
  `drizzle-orm/effect-postgres`. Check the bottom of `database.ts` for what
  is exported — if `makeDatabase` is not exported, add a test-only export
  (allowed, in scope).
- `apps/api/src/sync/operation.ts` — `applyOperation`: inbox idempotency
  check (duplicate → early ack), sorts changes (`compareChanges`), applies
  each via `applyChange`, collects `affectedBatchIds`, runs `reconcileBatch`
  per batch, writes `syncChangeLog` rows one-per-change with `.returning()`,
  updates `syncInbox.appliedCursor`. Also uses a raw advisory-lock `sql`
  statement near the top of the transaction (read `operation.ts:1-60` for
  the exact mechanism).
- `apps/api/src/sync/inventory.ts:9-50` — `reconcileBatch`: re-derives a
  batch's quantities from its stock movements (SELECT batch, SELECT
  movement sums, UPDATE batch), producing a replacement canonical change.
- `apps/api/src/sync/service.test.ts:56-59` — the existing stubbed layer
  (`Layer.succeed(SyncDatabase, { exchange: ... })`) with `@effect/vitest`'s
  `layer(testLayer)((it) => { it.effect(...) })` pattern — keep these tests;
  yours are additive.
- **Client side** — `packages/persistence/src/sync-engine.ts:59-140`
  (`upsertRemoteChange`): per entity, `Schema.decodeUnknownEffect` the row,
  `ensureIdentity(row, actor, change)`, `findFirst` the current row, skip if
  `current.rowVersion > change.rowVersion`, else
  `insert(...).onConflictDoUpdate(...)`. `:250-265` applies pulled changes in
  strict cursor order inside one transaction.
- `packages/persistence/src/sync-engine.test.ts` — the pattern to extend:
  tmpdir PGlite + `ManagedRuntime.make(layer({ dataDir, migrationsFolder,
syncTransport }))`, a `responseFor(request)` helper currently always
  returning `changes: []`, and `readOutbox` from `./test-support`.
- `packages/persistence/src/test-support.ts` exports `migrationsFolder`
  (local) AND `remoteMigrationsFolder`
  (`../../db/migrations/remote`) — the remote schema migrations needed to
  build a server-side PGlite fixture already have a pointer.
- Available packages: `packages/persistence` already depends on
  `@effect/sql-pglite` and `drizzle-orm` (effect-pglite driver);
  `apps/api` does NOT have pglite deps — adding
  `@effect/sql-pglite@4.0.0-beta.98` and `@electric-sql/pglite` as
  devDependencies to `apps/api/package.json` is in scope (versions must
  match `packages/persistence/package.json` exactly).

## Commands you will need

| Purpose        | Command                       | Expected on success |
| -------------- | ----------------------------- | ------------------- |
| Install        | `vp install`                  | exit 0              |
| Check all      | `vp check`                    | no NEW failures     |
| All tests      | `vp test`                     | all pass (28 + new) |
| Just api tests | `cd apps/api && bun run test` | all pass            |

## Scope

**In scope** (the only files you should modify/create):

- `apps/api/src/sync/database.test.ts` (create — server apply-path tests)
- `apps/api/src/sync/database.ts` (ONLY to export `makeDatabase` for tests, if not already exported)
- `apps/api/package.json` (ONLY to add the two pglite devDependencies)
- `packages/persistence/src/sync-engine.test.ts` (add pull/convergence tests)
- `packages/persistence/src/test-support.ts` (add helpers if needed, e.g. reading rows from a PGlite dir)

**Out of scope** (do NOT touch):

- Any behavioral change to `apply-change.ts`, `operation.ts`,
  `inventory.ts`, `sync-engine.ts` — if a test reveals what looks like a bug,
  characterize the CURRENT behavior in the test with a comment and report the
  suspected bug; do not fix it here.
- `service.test.ts` — leave the existing stub-based tests as they are.
- The sync wire contract in `packages/contracts`.

## Git workflow

- Branch: `advisor/010-sync-convergence-tests`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Server fixture — real `exchange` over PGlite

In `apps/api/src/sync/database.test.ts`, build the real database layer over
an in-memory/tmpdir PGlite loaded with the REMOTE schema:

1. Add devDeps (`@effect/sql-pglite@4.0.0-beta.98`,
   `@electric-sql/pglite` at the version `packages/persistence` uses) to
   `apps/api/package.json`; run `vp install`.
2. Construct the drizzle instance the way
   `packages/persistence/src/test-support.ts:15-19` does
   (`PgDrizzle.makeWithDefaults` + `PgliteClient.layer({ dataDir })`), but
   with `{ relations: remoteRelations }` imported from
   `@store/db/remote/relations` — mirroring `makeSyncDrizzle` in
   `database.client.ts`, swapping the postgres driver for the pglite one
   (`drizzle-orm/effect-pglite`).
3. Apply remote migrations from
   `packages/db/migrations/remote` (path helper: copy the
   `remoteMigrationsFolder` resolution from persistence's `test-support.ts`;
   check how persistence applies local migrations — find `migrationsFolder`
   usage in `packages/persistence/src/database.ts` — and use the analogous
   mechanism; if drizzle's migrator API differs for the api driver, read the
   drizzle-orm package source in node_modules before improvising).
4. Feed it to `makeDatabase(...)` and exercise `exchange(actor, request)`
   directly with `@effect/vitest` (`layer(...)`/`it.effect` — copy the
   harness shape from `service.test.ts`).

Build valid `SyncRequest`s with `SyncRequest.make`/`SyncOperation.make` from
`@store/contracts` — `service.test.ts` shows the exact construction including
`payloadHash` (see its `requestFor()` helper; reuse its hashing approach —
it must match `apps/api/src/sync/hash.ts`).

**Verify**: a trivial first test — an operation creating one category — gets
an `applied` acknowledgement with a cursor > 0, and the response `changes`
echo the canonical change. `cd apps/api && bun run test` → passes.

### Step 2: Server characterization cases

Add tests, each a fresh PGlite dir:

1. **Idempotent replay**: submit the same operation (same `operationId`,
   same payload) twice → second acknowledgement has status `duplicate` and
   the same cursor; row counts unchanged.
2. **Batch reconciliation**: one operation inserting a batch (initial
   quantities) plus stock movements that change quantities → after apply, the
   batch row's quantities equal the movement-derived values from
   `reconcileBatch`, and the change log contains the reconciled batch change
   (not the client's raw one).
3. **Conflicting concurrent updates** (the money case): two operations from
   two device actors touching the same batch with different quantities →
   apply both; assert the final batch row matches current last-writer /
   reconciliation semantics (characterize whatever the code does — derive the
   expectation by reading `applyChange`'s `commonMutable` + `reconcileBatch`,
   and document it in a comment).
4. **Pull paging**: after applying operations, `exchange` with `cursor: 0`
   returns the change log in strict ascending cursor order; with the cursor
   of the last change, returns `changes: []` and `hasMore: false`.

**Verify**: `cd apps/api && bun run test` → all pass.

### Step 3: Client pull-path tests

In `packages/persistence/src/sync-engine.test.ts`, add tests where the
stubbed transport returns POPULATED `changes` (build `SyncServerChange`
values from `@store/contracts`; rows must satisfy the row schemas the engine
decodes — model row shapes on what the engine itself pushes: run a local
mutation first, capture its outbox payload row via `readOutbox`, and replay a
modified copy as a remote change):

1. **Remote change applies**: a remote product upsert for a product that
   doesn't exist locally → after `program.sync`, the product exists locally
   with the remote rowVersion.
2. **Stale change skipped**: local product at rowVersion 3; remote change
   carries rowVersion 2 → local row unchanged after sync.
3. **Newer change wins**: remote rowVersion 4 over local 3 → local row
   updated.
4. **Cursor-order violation rejected**: transport returns changes out of
   strict cursor order → sync fails with the protocol error and local data
   is unchanged (assert via row counts).

**Verify**: `vp test` → all pass.

## Test plan

This plan IS the test plan — see Steps 2–3 for the enumerated cases
(4 server + 4 client). Structural patterns: `service.test.ts` for the api
harness, `sync-engine.test.ts` for the persistence harness.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `vp check` — no new failures
- [ ] `vp test` exits 0; ≥8 new tests across `apps/api/src/sync/database.test.ts` and `packages/persistence/src/sync-engine.test.ts`
- [ ] `git diff apps/api/src/sync --stat` shows only `database.test.ts` (new) and at most an added `export` in `database.ts`
- [ ] No behavioral diff in `apply-change.ts`, `operation.ts`, `inventory.ts`, `sync-engine.ts` (`git diff --stat` on those paths → empty)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- PGlite cannot execute something the apply path needs (e.g. the advisory
  lock statement in `operation.ts`, an extension, or a driver difference in
  `drizzle-orm/effect-pglite` vs `effect-postgres`) after one honest attempt
  to configure it — report the exact failing statement. Do NOT stub or patch
  production code to make the fixture work.
- The remote migrations cannot be applied to PGlite through any mechanism
  already present in the repo's dependencies.
- A characterization test reveals apparently wrong behavior (e.g. stale
  writes overwriting newer rows). Characterize what IS, add a `// NOTE:`
  comment, and report the suspected bug — do not fix.
- Version pinning: if `@effect/sql-pglite@4.0.0-beta.98` conflicts with
  `apps/api`'s effect version resolution, report instead of forcing
  overrides.

## Maintenance notes

- These tests exist to make the sync perf rework safe (backlog items: fold
  the client's read-per-change into conditional upserts; batch the server's
  per-change SELECTs and change-log inserts). Whoever does that work must
  keep every test here green without editing the assertions.
- Test 3 in Step 2 documents the current conflict semantics — if the team
  later chooses different semantics (e.g. per-field merge), that test is the
  place the decision becomes visible.
- The api pglite devDeps are test-only; they must never move to
  `dependencies` (the Worker uses Hyperdrive/postgres).
