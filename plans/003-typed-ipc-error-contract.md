# Plan 003: Carry typed store errors across the Electron IPC boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a98b4aa7..HEAD -- apps/desktop/electron/main.ts apps/desktop/electron/preload.ts packages/contracts/src packages/persistence/src/errors.ts`
> Plans 001 and 004 intentionally touch some of these files first — that is
> expected drift; re-read the live code where excerpts differ. On any other
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-persistence-error-cause.md, plans/004-remove-program-accessors.md
- **Category**: tech-debt (error contract)
- **Planned at**: commit `a98b4aa7`, 2026-07-15

## Why this matters

The persistence layer builds a rich typed error model (`PersistenceError`,
`ProductNotFoundError`, `InvoiceNotFoundError`) — and then the Electron main
process throws it all away at the one boundary where the UI would branch on
it. `runStore` collapses every failure to `new Error(message)`, so the
renderer cannot distinguish "product not found" (show a 404 surface) from "the
local database failed" (show retry) from "invalid input" (fix the form). This
plan defines a serializable error contract in `@store/contracts` (the package
that owns the renderer/main data contract per the README) and threads it
through main → preload → renderer.

## Current state

- `apps/desktop/electron/main.ts:74-83` — the boundary that erases types:

```ts
const runStore = <A, E>(effect: Effect.Effect<A, E, OfflineStore>) => {
  if (!runtime) return Promise.reject(new Error("The local store is not ready"));
  return runtime.runPromise(effect).catch((cause: unknown) => {
    const message =
      typeof cause === "object" && cause !== null && "message" in cause
        ? String(cause.message)
        : String(cause);
    throw new Error(message);
  });
};
```

- **Electron constraint (the reason for the envelope design below):** when an
  `ipcMain.handle` handler rejects, Electron re-creates the error in the
  renderer keeping only `name`/`message` — custom fields and tags are lost.
  Structured errors must therefore travel in the _resolved_ value and be
  re-thrown on the renderer side.
- `apps/desktop/electron/preload.ts:58-73` — `offlineStore` bridge, one
  `ipcRenderer.invoke` per method, typed as `OfflineStoreApi`.
- `packages/contracts/src/offline-store.api.ts` — defines `OfflineStoreApi`
  (the promise-based surface the renderer sees).
- Error classes live in `packages/persistence/src/errors.ts`
  (`Schema.TaggedErrorClass` — after plan 001, `PersistenceError` includes
  `cause: Schema.optionalKey(Schema.Defect())`). The renderer must NOT import
  `@store/persistence` (it drags in PGlite/node deps); the renderer already
  depends on `@store/contracts`.
- Renderer error consumption today is string-only, e.g.
  `apps/desktop/src/components/invoices/invoice-create-context.tsx:214-216`:

```ts
} catch (error) {
  toast.error(error instanceof Error ? error.message : "Could not complete the sale.");
}
```

- Repo conventions: `effect/*` subpath imports; schemas in contracts are
  defined with `effect/Schema`; contracts exports are wired through
  `packages/contracts/package.json` `exports` and `src/index.ts`.

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |
| Run app   | `vp run dev` (root)    | desktop app boots   |

## Scope

**In scope**:

- `packages/contracts/src/store-errors.ts` (create) and `packages/contracts/src/index.ts` (export it)
- `packages/persistence/src/errors.ts` (re-define its classes in terms of the contracts schemas OR keep classes and add encode helpers — see Step 1)
- `apps/desktop/electron/main.ts` (`runStore` + handler return shape)
- `apps/desktop/electron/preload.ts` (unwrap envelope, rethrow)
- `packages/contracts/src/offline-store.api.ts` (only if the envelope changes its types — the goal is that `OfflineStoreApi` stays promise-of-value; rejection carries the tagged shape)
- `apps/desktop/src/lib/errors.ts` (create — renderer-side type guard/helpers)
- One consumer update to prove the contract: `apps/desktop/src/components/invoices/invoice-create-context.tsx` catch block

**Out of scope** (do NOT touch):

- `auth`/`server`/`window-controls` IPC channels — store channels only.
- Any renderer route/component beyond the single proof-of-contract consumer.
- `apps/api/**`.

## Git workflow

- Branch: `advisor/003-typed-ipc-error-contract`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Define the wire error schema in contracts

Create `packages/contracts/src/store-errors.ts` defining the store error
classes with `effect/Schema` exactly as they exist in
`packages/persistence/src/errors.ts` today (`PersistenceError` with
`operation`, `message`, optional `cause` defect; `ProductNotFoundError` and
`InvoiceNotFoundError` with `id`), plus:

```ts
export const StoreError = Schema.Union([
  PersistenceError,
  ProductNotFoundError,
  InvoiceNotFoundError,
]);
export type StoreError = typeof StoreError.Type;
export const encodeStoreError = Schema.encodeUnknownSync(StoreError);
export const decodeStoreError = Schema.decodeUnknownSync(StoreError);
```

(Exact union constructor per this beta: check how existing contracts files
build unions — e.g. `Schema.Union`/`Schema.Literals` usage in
`packages/contracts/src/sync.schema.ts` — and match it.)

Then make `packages/persistence/src/errors.ts` re-export these classes from
`@store/contracts` instead of defining its own duplicates, keeping
`persistenceError`, `mapPersistenceError`, `messageOf`, and
`SyncTransportError` (main-process-only, not part of the wire contract) where
they are. All persistence imports (`./errors`) keep working unchanged.

**Verify**: `vp check` → exit 0.

### Step 2: Return an envelope from the store IPC handlers

In `apps/desktop/electron/main.ts`, change `runStore` to resolve an envelope
instead of rejecting with a stringified error:

```ts
type StoreIpcResult<A> = { ok: true; value: A } | { ok: false; error: unknown };

const runStore = async <A, E>(
  effect: Effect.Effect<A, E, OfflineStore>,
): Promise<StoreIpcResult<A>> => {
  if (!runtime)
    return {
      ok: false,
      error: encodeStoreError(
        PersistenceError.make({ operation: "run store", message: "The local store is not ready" }),
      ),
    };
  try {
    return { ok: true, value: await runtime.runPromise(effect) };
  } catch (cause) {
    return { ok: false, error: encodeStoreErrorSafely(cause) };
  }
};
```

Where `encodeStoreErrorSafely` tries `encodeStoreError` and, for anything
outside the union (defects, `Schema.SchemaError` from input decoding), falls
back to an encoded `PersistenceError` built from the cause's message. Every
`ipcMain.handle("store:...")` registration keeps its current body — only
`runStore`'s return shape changes.

**Verify**: `vp check` → exit 0.

### Step 3: Unwrap in preload

In `apps/desktop/electron/preload.ts`, wrap the store invocations:

```ts
const invokeStore = async <A>(channel: string, input?: unknown): Promise<A> => {
  const result = (await ipcRenderer.invoke(channel, input)) as StoreIpcResult<A>;
  if (result.ok) return result.value;
  throw result.error; // plain structured-cloneable object with _tag + fields
};
```

and route all 14 `offlineStore` methods through it. The thrown value is the
_encoded_ error object — the preload does not import Schema (keeps the
sandboxed preload dependency-free).

**Verify**: `vp check` → exit 0.

### Step 4: Renderer helpers + one consumer

Create `apps/desktop/src/lib/errors.ts`:

- `decodeStoreError` re-export/wrapper from `@store/contracts` that safely
  attempts to decode an unknown rejection into a typed `StoreError`
  (returning `null` on failure), plus `storeErrorMessage(error: unknown): string`
  that prefers the decoded error's `message` and falls back to the current
  `instanceof Error` logic.

Update the catch in
`apps/desktop/src/components/invoices/invoice-create-context.tsx` to use it,
branching at least once on tag to prove the contract, e.g. a distinct toast
for `PersistenceError` ("Saving failed locally — your data is safe, try
again") vs. the generic message.

**Verify**: `vp check` → exit 0; `vp test` → pass.

### Step 5: Manual smoke test

Run `vp run dev`, open the app, create an invoice successfully (happy path
unchanged), and confirm the toast still shows on a forced failure if easy to
trigger (e.g. temporarily submitting with the dev tools while offline is NOT
required — a successful create + no console IPC errors is sufficient).

**Verify**: invoice create works; no `Error invoking remote method` regressions in the dev tools console.

## Test plan

- Contracts: add `packages/contracts/src/store-errors.test.ts` (if a test
  runner picks up contracts — check whether any `*.test.ts` exists in
  contracts first; if the package has no test wiring, put the round-trip test
  in `packages/persistence/src/errors.test.ts` instead, which plan 001
  created): encode → decode round-trip for each of the three error classes,
  including a `PersistenceError` carrying an `Error` cause.
- Persistence tests, `vp test`: all green (no behavior change inside the
  package).

## Done criteria

- [ ] `vp check` exits 0; `vp test` exits 0 with the round-trip test passing
- [ ] `grep -n "new Error(message)" apps/desktop/electron/main.ts` → no matches
- [ ] Store IPC handlers resolve `{ ok: ... }` envelopes; preload rethrows the encoded error
- [ ] Renderer has `storeErrorMessage` and at least one tag-branching consumer
- [ ] The renderer does not import `@store/persistence` (`grep -rn "@store/persistence" apps/desktop/src/` → no matches)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plans 001/004 have not landed (this plan assumes `cause` exists on
  `PersistenceError` and that `main.ts` no longer uses `program`).
- Moving the error classes to contracts creates a circular dependency
  (contracts must not import persistence — if the classes can't be cleanly
  relocated, STOP and propose keeping classes in persistence with a
  contracts-side plain-schema mirror instead).
- The encoded error object fails Electron's structured clone (it must be
  plain JSON-ish data; if `Schema.Defect` encoding produces something
  non-cloneable, report the encoded shape you observed).
- Any auth/server IPC channel appears to need the same change — note it,
  don't do it.

## Maintenance notes

- Future store IPC methods must return through `runStore` and the preload
  `invokeStore` helper — reviewers should reject hand-rolled channels.
- Follow-up deliberately deferred: adopting the typed errors in more renderer
  surfaces (product detail 404 view, sync status panel) — cheap once this
  contract exists.
- If the API Worker ever shares error shapes with the desktop, extend
  `store-errors.ts` in contracts rather than minting a new union.
