# Plan 001: Preserve the underlying cause in PersistenceError

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a98b4aa7..HEAD -- packages/persistence/src/errors.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (diagnostics)
- **Planned at**: commit `a98b4aa7`, 2026-07-15

## Why this matters

Every failure in the persistence layer (PGlite, drizzle, migrations, sync) is
funneled through `mapPersistenceError`, which flattens the original error to a
plain message string. The original error object — its stack, its type, any SQL
error metadata — is destroyed at the first hop. Debugging a production
persistence failure currently yields only a hand-written operation label and a
message. The repo already has the correct pattern in `apps/api/src/sync/errors.ts`,
which keeps the cause as a `Schema.Defect`. This plan brings
`packages/persistence` in line with it.

## Current state

- `packages/persistence/src/errors.ts` — the only file to change. Small file; the relevant parts today:

```ts
// errors.ts:9-12
export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

// errors.ts:26-36
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const persistenceError = (operation: string, cause: unknown) =>
  cause instanceof PersistenceError
    ? cause
    : PersistenceError.make({ operation, message: messageOf(cause) });

export const mapPersistenceError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> =>
    effect.pipe(Effect.mapError((cause) => persistenceError(operation, cause)));
```

- The repo convention to match — `apps/api/src/sync/errors.ts:3-6` (exemplar, do NOT modify it):

```ts
export class SyncDatabaseError extends Schema.TaggedErrorClass<SyncDatabaseError>()(
  "SyncDatabaseError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}
```

- Effect version is `4.0.0-beta.98` (`effect/Schema` module imports, `Schema.TaggedErrorClass`, `Schema.optionalKey`, `Schema.Defect` all exist at this version — the exemplar above compiles today).
- ~25 call sites use `mapPersistenceError`/`persistenceError` across `product-store.ts`, `invoice-store.ts`, `sync-engine.ts`, `database.ts`, `bootstrap.ts`. Their signatures do not change; do not touch them.

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |

## Scope

**In scope** (the only files you should modify/create):

- `packages/persistence/src/errors.ts`
- `packages/persistence/src/errors.test.ts` (create)

**Out of scope** (do NOT touch):

- `apps/api/src/sync/errors.ts` — already correct; it is the exemplar.
- All `mapPersistenceError`/`persistenceError` call sites — the helper signatures are unchanged.
- Any IPC serialization concerns — plan 003 handles the IPC boundary. Keep the new field `optionalKey` so encoding stays backward compatible.

## Git workflow

- Branch: `advisor/001-persistence-error-cause` (or commit directly if the operator says so — repo history uses short `sync`-style messages; a message like `persistence: preserve error cause` is fine).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `cause` field to `PersistenceError`

In `packages/persistence/src/errors.ts`, change the `PersistenceError` schema to:

```ts
export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
```

**Verify**: `vp check` → exit 0.

### Step 2: Populate `cause` in `persistenceError`

Change the constructor helper so the original error travels with the wrapper
(keep the existing pass-through for already-wrapped errors):

```ts
export const persistenceError = (operation: string, cause: unknown) =>
  cause instanceof PersistenceError
    ? cause
    : PersistenceError.make({ operation, message: messageOf(cause), cause });
```

`messageOf` and `mapPersistenceError` stay exactly as they are.

**Verify**: `vp check` → exit 0.

### Step 3: Add a unit test

Create `packages/persistence/src/errors.test.ts` using plain vitest `test()`
(match the style of `packages/persistence/src/sync-engine.test.ts`, which uses
top-level `test(...)` with no `describe`). Cover:

1. `persistenceError("load", new Error("boom"))` → `_tag === "PersistenceError"`, `operation === "load"`, `message === "boom"`, and `cause` is the original `Error` instance.
2. Pass-through: wrapping an existing `PersistenceError` returns the same instance (`toBe`).
3. Non-Error cause: `persistenceError("load", "boom")` → `message === "boom"` and `cause === "boom"`.

**Verify**: `vp test` → all pass, including the 3 new tests.

## Test plan

Covered by Step 3. No integration tests needed — the change is additive on one
schema and one constructor.

## Done criteria

- [ ] `vp check` exits 0
- [ ] `vp test` exits 0; `errors.test.ts` exists with the 3 cases above
- [ ] `PersistenceError` schema includes `cause: Schema.optionalKey(Schema.Defect())`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Schema.optionalKey` or `Schema.Defect` does not exist in the installed
  `effect` version (it should — `apps/api/src/sync/errors.ts` uses both today).
- Adding the field produces type errors in other persistence files (it should
  not — `make` with an extra optional field is backward compatible). If it
  does, the codebase drifted; report which call sites broke.
- You find yourself wanting to change any file other than the two in scope.

## Maintenance notes

- Plan 003 (typed IPC error contract) serializes `PersistenceError` across
  Electron IPC. `Schema.Defect()` encodes causes into a serializable
  representation, which is exactly why the field must be part of the schema
  rather than an untyped property.
- Reviewers should confirm no call site started passing secrets as `cause`
  message content (none does today; causes are DB/driver errors).
