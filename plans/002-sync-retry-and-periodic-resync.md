# Plan 002: Add transport retry with backoff and a periodic re-sync signal to the sync engine

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a98b4aa7..HEAD -- packages/persistence/src/sync-engine.ts packages/persistence/src/config.ts packages/persistence/src/sync-engine.test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (robustness)
- **Planned at**: commit `a98b4aa7`, 2026-07-15

## Why this matters

This is an offline-first app whose durability story is "network failures leave
local writes intact and pending for retry" (README). But the sync engine has
**no retry, no backoff, and no periodic re-sync**: the background loop only
runs when a local mutation signals it. If one sync attempt fails (flaky Wi-Fi,
Worker cold error), the status flips to `error` and the durable outbox strands
until the user happens to make _another mutation_. A device that stops
mutating after a failed sync never drains its outbox and never pulls remote
changes. The local schema even has a `syncOutbox.nextAttemptAt` column that is
only ever set to `null` — retries were anticipated but never built.

## Current state

All in `packages/persistence/src/sync-engine.ts` (imports at the top of the
file currently include `Effect`, `Queue`, `Ref`, `Schema`, `Semaphore` from
`effect/*` — no `Schedule`):

- The single network call, inside `exchangeOnce` (`sync-engine.ts:237-243`) —
  transport errors are mapped once, never retried:

```ts
const response =
  yield *
  transport
    .exchange(request)
    .pipe(
      Effect.mapError((error) =>
        PersistenceError.make({ operation: "exchange sync changes", message: error.message }),
      ),
    );
```

- The background loop (`sync-engine.ts:364-374`) — purely signal-driven; one
  initial signal at startup, then only `signalSync` from mutations:

```ts
if (configured) {
  yield *
    Effect.gen(function* () {
      while (true) {
        yield* Queue.take(signals);
        const result = yield* Effect.result(sync());
        if (result._tag === "Failure")
          yield* Effect.logWarning("Background synchronization failed", result.failure);
      }
    }).pipe(Effect.forkScoped);
  yield * Queue.offer(signals, undefined);
}
```

- The transport type: `config.syncTransport.exchange(request)` fails with
  `SyncTransportError` (`packages/persistence/src/errors.ts:4-7`,
  `{ message: Schema.String }`). Validation/protocol failures inside
  `exchangeOnce` are `PersistenceError`s created via `invalidResponse(...)`
  (`sync-engine.ts:41-42`) — those must NOT be retried (they indicate a broken
  response, not a transient network problem).
- `signals` is `Queue.sliding<void>(1)` (`sync-engine.ts:173`), so extra
  offers coalesce — safe to offer from a timer.
- `sync()` (`sync-engine.ts:288-362`) already serializes runs through a
  semaphore (`lock.withPermit`) and loops `exchangeOnce()` up to 100 rounds.
- `PersistenceConfig` lives in `packages/persistence/src/config.ts` and is
  constructed in `apps/desktop/electron/main.ts:199-223` (`activateOrganization`)
  and `main.ts:185-190` (`activateLockedRuntime`, no `syncTransport`).
- Attempt bookkeeping: `exchangeOnce` increments `syncOutbox.attemptCount`
  once per call _before_ the exchange (`sync-engine.ts:212-235`). Retrying the
  `transport.exchange` call inside one `exchangeOnce` will NOT re-increment
  it; that is acceptable — note it in the PR description.

Repo conventions to match: `effect/*` subpath imports (`import * as Schedule
from "effect/Schedule"`), `Effect.fn("OfflineStore.…")` for named operations,
typed errors only (no thrown exceptions).

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |

## Suggested executor toolkit

- If the `effect-ts` skill is available, consult
  `.claude/skills/effect-ts/references/guide-schedule.md` (retry policies,
  `Schedule.exponential`, jitter) and `guide-retries.md` before Step 1.

## Scope

**In scope** (the only files you should modify):

- `packages/persistence/src/sync-engine.ts`
- `packages/persistence/src/config.ts` (add one optional config field)
- `packages/persistence/src/sync-engine.test.ts` (extend)
- `apps/desktop/electron/main.ts` — ONLY if you choose to pass an explicit
  interval; the default must make this unnecessary.

**Out of scope** (do NOT touch):

- `apps/api/**` — server-side retry semantics are separate.
- `syncOutbox.nextAttemptAt` persistence-driven scheduling — a full
  per-operation backoff persisted to the DB is deliberately deferred (see
  Maintenance notes). This plan adds in-memory retry + periodic wake-up only.
- `packages/db/**` migrations/schema.

## Git workflow

- Branch: `advisor/002-sync-retry-and-periodic-resync`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Retry the transport exchange with exponential backoff

In `sync-engine.ts`, import Schedule (`import * as Schedule from
"effect/Schedule";`) and change the exchange call inside `exchangeOnce` to
retry **only transport failures**, before the error is mapped to
`PersistenceError`:

```ts
const response =
  yield *
  transport.exchange(request).pipe(
    Effect.retry({
      schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
      times: 3,
    }),
    Effect.mapError((error) =>
      PersistenceError.make({ operation: "exchange sync changes", message: error.message }),
    ),
  );
```

Key points:

- The retry wraps `transport.exchange(...)` only — validation failures
  (`invalidResponse`) and DB failures occur outside this pipe and are not
  retried.
- Total worst-case added latency ≈ 0.5s + 1s + 2s (jittered) — acceptable for
  a background sync; the semaphore already prevents overlapping runs.
- If the exact options-object form of `Effect.retry` differs in
  `effect@4.0.0-beta.98`, use the equivalent composed schedule
  (`Schedule.exponential(...).pipe(Schedule.jittered, Schedule.compose(Schedule.recurs(3)))`
  or the API the vendored source in `.repos/effect/packages/effect/src/`
  shows) — verify against the source, do not guess.

**Verify**: `vp check` → exit 0.

### Step 2: Add a periodic re-sync signal

1. In `packages/persistence/src/config.ts`, add to `PersistenceConfig`:

```ts
/** How often the engine re-signals a background sync. Default: 5 minutes. */
readonly resyncIntervalMillis?: number;
```

2. In `makeSyncEngine`, alongside the existing background loop (after the
   `if (configured) { ... }` block's fiber fork, inside the same `if`), fork a
   second scoped fiber that periodically offers a signal:

```ts
const resyncInterval = config.resyncIntervalMillis ?? 300_000;
yield *
  Queue.offer(signals, undefined).pipe(
    Effect.delay(resyncInterval),
    Effect.forever,
    Effect.forkScoped,
  );
```

(Equivalent `Effect.repeat(Queue.offer(...), Schedule.spaced(resyncInterval))`
is fine — pick whichever compiles cleanly on this beta; check the vendored
source if unsure.)

Because `signals` is a sliding queue of capacity 1, periodic offers coalesce
with mutation-driven ones; a wake-up while sync is already running just queues
one more run.

**Verify**: `vp check` → exit 0, and `vp test` → all existing tests still pass
(the periodic fiber must not break `sync-engine.test.ts`'s existing two tests —
the default 5-minute interval will never fire within a test run).

### Step 3: Test — transient transport failure recovers within one sync call

Extend `packages/persistence/src/sync-engine.test.ts` (match its existing
style: top-level `test(...)`, real PGlite data dirs via helpers from
`test-support.ts`, a stub transport object). Add:

- **"a flaky transport is retried and the outbox drains"**: build a transport
  whose `exchange` fails with `SyncTransportError` on the first 2 calls and
  succeeds afterwards (mirror the response-shape the existing successful-path
  test uses). Perform one mutation, run `sync` once, then assert via
  `readOutbox(dataDir)` that the operation is acknowledged
  (`acknowledgedAt !== null`) and the returned status has `phase === "idle"`.

- **"a permanently failing transport still fails after retries"**: transport
  always fails; assert `sync` fails with a `PersistenceError` whose
  `operation` is `"exchange sync changes"`, and the outbox row remains
  unacknowledged with `lastError` set. (This pins the retry cap so a future
  change can't accidentally retry forever.)

Use a short interval-free path: these tests call `sync` directly and do not
depend on the periodic fiber. Do not write a timing-based test for the
periodic fiber (flaky); the fiber is covered by `vp check` + code review.

**Verify**: `vp test` → all pass, including the 2 new tests.

## Test plan

Covered by Step 3. Pattern file: `packages/persistence/src/sync-engine.test.ts`
(existing tests "each business mutation commits one durable sync operation"
and "an offline transport never rolls back local writes and leaves outbox
work pending" show how to build the engine, stub transports, and read the
outbox).

## Done criteria

- [ ] `vp check` exits 0
- [ ] `vp test` exits 0; the 2 new tests exist and pass
- [ ] `grep -n "Schedule" packages/persistence/src/sync-engine.ts` shows the retry and/or spaced schedule
- [ ] Retry wraps only `transport.exchange` (validation errors are not retried — confirm by reading the pipe)
- [ ] A periodic signal fiber exists, gated on `configured`, default interval 5 minutes, overridable via `PersistenceConfig.resyncIntervalMillis`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `Effect.retry` / `Schedule` API shape in `effect@4.0.0-beta.98` differs
  from both forms given in Step 1 and you cannot confirm the correct form from
  the vendored source at `.repos/effect/packages/effect/src/Schedule.ts` /
  `Effect.ts` within a reasonable attempt.
- Existing sync-engine tests start failing for reasons unrelated to your
  change (drift).
- The fix seems to require touching `syncOutbox` schema or migrations — that
  is explicitly out of scope.

## Maintenance notes

- Deliberately deferred: persisted per-operation backoff using
  `syncOutbox.nextAttemptAt` (respecting it in the pending-operations query,
  setting it on failure). If sync volume grows or the server starts rate
  limiting, that is the next step — this plan's in-memory retry is the 80/20.
- Reviewers should scrutinize: (a) that protocol-validation failures are not
  inside the retry pipe; (b) fiber lifecycle — both fibers are `forkScoped` so
  they die with the runtime's scope when `disposeRuntime()` runs on
  organization switch (`apps/desktop/electron/main.ts:174-179`).
- If plan 003 (typed IPC errors) lands, the renderer will be able to
  distinguish transport-exhausted errors; nothing here blocks it.
