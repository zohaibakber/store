# Plan 019: Give the sync outbox real backoff and make a stuck queue visible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- packages/persistence/src/sync-engine.ts packages/contracts/src/sync.schema.ts packages/db/src/local/sync.schema.ts packages/persistence/src/sync-engine.test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

The local outbox has two columns designed to schedule retries —
`attemptCount` and `nextAttemptAt` — and **neither is read**. `nextAttemptAt`
is only ever written back to `null`. The pending query filters solely on
`acknowledgedAt IS NULL`.

The consequence: when the server permanently rejects an operation (a poison
payload, a schema-drift row, a non-retryable 400), that operation sits at the
head of the `clientSequence`-ordered queue. Every sync cycle rebuilds the same
request and fails the same way, forever, with no backoff — and the only user-
visible signal is a generic status message. For an offline-first POS, that
means every subsequent sale, price change, and stock movement silently stops
reaching the cloud while the app continues to look like it is working.

This plan does two things:

1. **Backoff** — a failed operation gets an increasing `nextAttemptAt`, so a
   permanently-failing operation stops burning a request on every cycle.
2. **Visibility** — `SyncStatus` gains the pending count, the oldest pending
   timestamp, the last error, and a quarantine flag, so the UI can tell the
   user "42 operations are stuck" instead of nothing.

**Deliberately NOT in this plan**: skipping past a quarantined operation to let
later ones through. See "Why head-of-line blocking stays" below — that is a
correctness decision, not a mechanical one.

## Current state

### The dead columns

`packages/db/src/local/sync.schema.ts:8-37` — the table already has everything
needed, including an index whose column order anticipates exactly the query
this plan will write:

```ts
export const syncOutbox = pgTable(
  "sync_outbox",
  {
    operationId: text().primaryKey(),
    organizationId: tenantId(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
    clientSequence: bigserial({ mode: "number" }).notNull(),
    occurredAt: epochMilliseconds().notNull(),
    payload: jsonb().$type<ReadonlyArray<SyncEntityChangePayload>>().notNull(),
    payloadHash: text().notNull(),
    attemptCount: integer().notNull().default(0),
    nextAttemptAt: epochMilliseconds(),
    lastError: text(),
    acknowledgedAt: epochMilliseconds(),
  },
  (table) => [
    uniqueIndex("sync_outbox_organization_device_sequence_uidx").on(
      table.organizationId,
      table.deviceId,
      table.clientSequence,
    ),
    index("sync_outbox_pending_idx").on(
      table.organizationId,
      table.acknowledgedAt,
      table.nextAttemptAt,
      table.clientSequence,
    ),
  ],
);
```

### The pending query that ignores them

`packages/persistence/src/sync-engine.ts:195-206`:

```ts
const pending =
  yield *
  database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.organizationId, currentActor.organizationId),
        isNull(syncOutbox.acknowledgedAt),
      ),
    )
    .orderBy(asc(syncOutbox.clientSequence))
    .limit(MAX_SYNC_OPERATIONS_PER_REQUEST + 1)
    .pipe(mapPersistenceError("load pending sync operations"));
```

### Where attempts are counted (but never used)

`packages/persistence/src/sync-engine.ts:253-266` — incremented before the
exchange, and reset on success at `:322`:

```ts
                .set({ attemptCount: sql`${syncOutbox.attemptCount} + 1`, lastError: null })
```

```ts
                .set({ acknowledgedAt: completedAt, lastError: null, nextAttemptAt: null })
```

### Where failure is recorded

`packages/persistence/src/sync-engine.ts:395-411` — the failure path writes
`lastError` but never `nextAttemptAt`:

```ts
                    database
                      .update(syncOutbox)
                      .set({ lastError: error.message })
                      .where(
                        and(
                          eq(syncOutbox.organizationId, currentActor.organizationId),
                          isNull(syncOutbox.acknowledgedAt),
                        ),
                      ),
```

### The status contract

`packages/contracts/src/sync.schema.ts:76-81`:

```ts
export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly configured: boolean;
  readonly lastSyncedAt: number | null;
  readonly message: string;
}
```

`SyncPhase` is `"local-only" | "idle" | "syncing" | "error"`.

### Transport-level retry already exists — do not duplicate it

`sync-engine.ts:271-276` already retries the HTTP exchange itself:

```ts
        Effect.retry({
          schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
          times: 3,
          while: (error) => error.retryable,
        }),
```

That is **in-request** retry for transient transport failures, and it is
correct. This plan adds **across-cycle** backoff for operations that keep
failing after that retry is exhausted. Keep both.

### Why head-of-line blocking stays

I verified the server tolerates gaps: `apps/server/src/sync/operation.ts:41-56`
looks up `(organizationId, deviceId, clientSequence)` only to detect _reuse_
(same sequence, different `operationId`), and the inbox is keyed on
`(organizationId, operationId)`. Nothing requires contiguous sequences.

**But protocol tolerance is not domain safety.** Operations carry causally
dependent business changes: if operation N creates a product and N+1 sells it,
pushing N+1 while N is quarantined sends an invoice line referencing a product
the server has never seen. Deciding how to handle that (dependency tracking, or
quarantining the whole causal chain) is genuine design work.

So: this plan makes the stall _slow and visible_ instead of _fast and silent_.
It does not make it _skippable_. That is the honest, safe scope.

### Effect v4 conventions to follow

This repo pins `effect` 4.0.0-beta.101 via the root catalog. Follow the
project's existing idioms, which already match the house Effect guidance:

- Compose with `Effect.gen(function* () { ... })`.
- Name non-trivial operations with `Effect.fn("OfflineStore.operationName")`
  — see the existing `Effect.fn("OfflineStore.exchangeOnce")` at `:187`.
- Use `Schedule` for backoff computation rather than hand-rolled arithmetic
  where it fits; `Schedule.exponential(...)` and `Schedule.jittered` are
  already imported in this file.
- Map persistence failures through the existing
  `mapPersistenceError("label")` helper; do not introduce a new error type.
- Typed errors are `PersistenceError` (already imported). Do not hand-roll
  `_tag` classes.
- Do **not** use `as`, `any`, or non-null assertions to satisfy the checker.
- Background work stays forked with `Effect.forkScoped` as it already is at
  `:400-419`.

Note that jitter must not be applied when _persisting_ a deadline in a way
that makes tests non-deterministic — see Step 3.

## Commands you will need

| Purpose               | Command                                 | Expected on success              |
| --------------------- | --------------------------------------- | -------------------------------- |
| Format/lint/typecheck | `bunx vp check`                         | exit 0                           |
| Persistence tests     | `bunx vp test packages/persistence`     | exit 0, all pass                 |
| Full tests            | `bunx vp test`                          | exit 0                           |
| Workspace checks      | `bun run check`                         | exit 0                           |
| Regenerate migrations | `cd packages/db && bun run db:generate` | new migration files in both sets |

The persistence suite starts real PGlite instances and takes roughly a minute.

## Scope

**In scope**:

- `packages/persistence/src/sync-engine.ts`
- `packages/contracts/src/sync.schema.ts` (extend `SyncStatus`)
- `packages/persistence/src/sync-engine.test.ts`
- `packages/db/src/local/sync.schema.ts` **only if** a `quarantinedAt` column
  is added (Step 4) — plus the generated migrations

**Out of scope** (do NOT touch):

- **Skipping quarantined operations.** The pending query must keep
  `orderBy(asc(clientSequence))` and must not skip a blocked head-of-line
  operation. See "Why head-of-line blocking stays".
- `apps/server/**` — no server change is needed or wanted.
- The transport-level `Effect.retry` at `:271-276`. Leave it exactly as is.
- `apps/desktop/src/components/sync-status.tsx` and any renderer file.
  This plan extends the _contract and engine_; wiring the new fields into the
  UI is a follow-up. Extending `SyncStatus` must not break the existing
  renderer — see Step 5.
- `packages/persistence/src/outbox.ts` — enqueueing is correct.
- The per-change `findFirst` performance issue in `upsertRemoteChange`. Known,
  separate, and touching it here would make this diff unreviewable.

## Git workflow

- Branch: `advisor/019-outbox-backoff-and-visibility`
- Commit per step. Message style matches `git log` (short imperative, no
  prefix), e.g. `Back off failed sync operations instead of retrying forever`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extend the `SyncStatus` contract

In `packages/contracts/src/sync.schema.ts`, add to the `SyncStatus` interface:

```ts
  readonly pendingOperations: number;
  readonly oldestPendingAt: number | null;
  readonly lastError: string | null;
  readonly quarantined: boolean;
```

All four are **required** fields, per the house rule that normalized defaulted
values stay required and get their defaults at construction. This will produce
typecheck errors at every construction site — that is intended and Step 5
fixes them.

**Verify**: `bunx vp check` → fails, listing every `SyncStatus` construction
site. Record that list; it is your work queue for Step 5.

### Step 2: Filter the pending query on `nextAttemptAt`

In `sync-engine.ts`, add a due-time predicate to the pending query so an
operation whose `nextAttemptAt` is in the future is not selected:

```ts
            or(isNull(syncOutbox.nextAttemptAt), lte(syncOutbox.nextAttemptAt, now)),
```

`or` must be added to the `drizzle-orm` import (`and`, `asc`, `eq`, `isNull`,
`lte`, `sql` are already imported). Compute `now` once at the top of
`exchangeOnce` so all comparisons in one cycle use a single timestamp.

Keep `orderBy(asc(syncOutbox.clientSequence))` unchanged.

**Verify**: `bunx vp test packages/persistence` → the existing nine
`sync-engine.test.ts` cases still pass (none of them set `nextAttemptAt`, so
`isNull` keeps them all due).

### Step 3: Write a backoff deadline on failure

In the failure-recording path (`sync-engine.ts:395-411`), extend the
`syncOutbox` update so it also sets `nextAttemptAt`.

Compute the delay from the operation's `attemptCount` with capped exponential
backoff — for example base 1s, doubling, capped at 5 minutes. Express it as a
small named pure helper (e.g. `retryDelayMillis(attemptCount: number): number`)
so it can be unit-tested directly without a database.

**Determinism matters here**: do _not_ apply random jitter to the persisted
deadline. Jitter belongs in the in-request transport retry (which already has
it via `Schedule.jittered`); a randomized persisted timestamp would make the
tests in Step 6 flaky. Keep `retryDelayMillis` a pure function of
`attemptCount`.

The update currently targets _all_ unacknowledged rows for the organization.
Keep that targeting — the whole selected batch failed together.

**Verify**: `bunx vp check` → exit 0 for this file;
`bunx vp test packages/persistence` → still passing.

### Step 4: Mark permanently-failing operations as quarantined

Add a terminal state so the UI can distinguish "retrying" from "stuck".

Preferred approach — **no schema change**: treat
`attemptCount >= QUARANTINE_ATTEMPTS` (use 10) as quarantined, computed at
read time. This avoids a migration entirely.

Only if that proves insufficient, add a `quarantinedAt` column to
`packages/db/src/local/sync.schema.ts` and regenerate migrations with
`cd packages/db && bun run db:generate` (which regenerates **both** the local
and remote sets — commit both).

Prefer the no-migration approach. Record which you chose in the commit message.

**Verify**: `bunx vp check` → exit 0. If you added a column,
`bun run check` must also pass (it runs `drizzle-kit check` on both configs).

### Step 5: Populate the new status fields

Wherever `SyncStatus` is constructed in `sync-engine.ts`, supply the four new
fields. Add a small `Effect.fn("OfflineStore.readOutboxHealth")` helper that
runs one aggregate query over `syncOutbox` for the current organization
returning: count of unacknowledged rows, `min(occurredAt)` of those rows, the
most recent `lastError`, and whether any row is quarantined per Step 4.

Use it when transitioning to `idle` and to `error`. For the `"local-only"`
status (no transport configured), use `pendingOperations: 0`,
`oldestPendingAt: null`, `lastError: null`, `quarantined: false`.

Do not run this aggregate inside the write transaction that applies the pull —
keep it as a separate read.

**Verify**: `bunx vp check` → exit 0 across the whole repo, meaning every
construction site from Step 1 is now satisfied. Also confirm
`apps/desktop` still typechecks: the renderer reads `SyncStatus` but should
not need changes to compile, since fields were only added.

### Step 6: Add regression tests

In `packages/persistence/src/sync-engine.test.ts`, following the existing
structure in that file (real PGlite via `ManagedRuntime.make(layer({...}))`,
a fake transport injected through `syncTransport`), add:

1. **`retryDelayMillis` is pure and capped** — a direct unit test: it grows
   with `attemptCount` and never exceeds the cap. No database needed.
2. **A failed exchange sets a future `nextAttemptAt`** — drive one cycle with
   a permanently-failing transport, then read the `syncOutbox` row and assert
   `nextAttemptAt > now` and `attemptCount > 0`.
3. **An operation that is not yet due is not resent** — after case 2, invoke
   sync again immediately and assert the transport was **not** called a second
   time with that operation. This is the core assertion of the whole plan:
   it fails on `main` today.
4. **Status reports the stuck queue** — assert `pendingOperations` is the
   seeded count, `oldestPendingAt` is non-null, and `lastError` is populated
   after a failure.
5. **Success clears the backoff** — a subsequent successful exchange sets
   `acknowledgedAt` and leaves `nextAttemptAt` null, and status returns to
   `pendingOperations: 0`, `quarantined: false`.

Use the existing fake-transport helpers in that file rather than inventing new
ones. Control time with the file's existing approach; if you need to advance
past a backoff deadline, prefer manipulating the persisted `nextAttemptAt`
directly over sleeping. **Do not add `Effect.sleep` or real waits to tests.**

**Verify**: `bunx vp test packages/persistence` → exit 0, with all nine
pre-existing `sync-engine.test.ts` cases still passing plus the new ones.

### Step 7: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

Five cases as listed in Step 6, added to the existing
`packages/persistence/src/sync-engine.test.ts`. Structural pattern: that file's
existing "a flaky transport is retried and the outbox drains" and "a
permanently failing transport still fails after retries" tests — they already
build exactly the fixtures needed.

The load-bearing test is case 3 (not-yet-due operations are not resent): it is
the one that fails before this plan and passes after, and it is the behaviour
the whole plan exists to create.

All nine existing `sync-engine.test.ts` cases must keep passing unchanged —
they encode the convergence guarantees and this plan must not weaken them.

## Done criteria

ALL must hold:

- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `bun run check` exits 0
- [ ] `SyncStatus` has `pendingOperations`, `oldestPendingAt`, `lastError`,
      `quarantined`
- [ ] The pending query references `nextAttemptAt`
      (`grep -n 'nextAttemptAt' packages/persistence/src/sync-engine.ts` shows
      it in the select predicate, not only in the success reset)
- [ ] A `retryDelayMillis`-style pure helper exists and has a direct unit test
- [ ] All nine pre-existing `sync-engine.test.ts` cases still pass
- [ ] The pending query still orders by `asc(clientSequence)` and does **not**
      skip blocked operations
- [ ] `grep -n ' as \| as any\|!\.' packages/persistence/src/sync-engine.ts`
      → no new type escapes introduced
- [ ] If a column was added, both local and remote migrations are regenerated
      and committed
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Adding required fields to `SyncStatus` breaks `apps/desktop` compilation in
  a way that needs renderer edits. Renderer changes are out of scope — report
  the sites instead of editing them.
- Any of the nine existing `sync-engine.test.ts` cases fails and the fix is not
  obviously a test-fixture update. Those tests encode convergence guarantees;
  a genuine failure means the backoff changed drain behaviour.
- You conclude the plan needs quarantined operations to be **skipped** for a
  test to pass. It does not — re-read "Why head-of-line blocking stays" and
  report rather than implementing skipping.
- `bun run db:generate` produces migration diffs unrelated to your change
  (i.e. the committed migrations were already out of sync with the schema).
  Report that separately; do not commit unrelated migration churn.
- Backoff makes a test time-dependent and you are tempted to add a sleep.
  Report instead; manipulate persisted timestamps directly.

## Maintenance notes

- **The big deferred decision**: a quarantined operation still blocks
  everything behind it, just slowly and visibly now. Actually draining past it
  requires deciding how to handle causal dependencies between operations
  (dependency tracking, or quarantining a whole causal chain together). That
  design work is the natural follow-up and should reference this plan's
  "Why head-of-line blocking stays" section.
- The UI does not yet show any of the four new fields. `sync-status.tsx`
  currently shows online/offline, phase, and `lastSyncedAt`; a pending badge
  and a "Sync activity" panel are the obvious next step and are now purely a
  renderer change.
- A reviewer should check that `nextAttemptAt` is written on **every** failure
  path, not just the one modified in Step 3 — a missed path silently restores
  the old hammer-forever behaviour, and no test would catch it unless it
  exercises that specific path.
- Keep `retryDelayMillis` free of randomness. If jitter is ever wanted for the
  persisted deadline, it needs a seeded/injected source so tests stay
  deterministic.
- The `sync_outbox_pending_idx` index already covers
  `(organizationId, acknowledgedAt, nextAttemptAt, clientSequence)`, so the new
  predicate is index-supported. If the query shape changes further, re-check
  that the index still matches.
