# Plan 020: Show the real store error in product toasts instead of a generic message

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- apps/desktop/src/lib/errors.ts apps/desktop/electron/preload.ts apps/desktop/src/components/products apps/desktop/src/routes/products`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

The typed-error work that already landed makes the Electron main process encode
`StoreError` values and send them across IPC, so the renderer can show the
actual cause of a failure. Five call sites throw that away.

`preload.ts:79-83` rejects with the **plain encoded object**, not an `Error`
instance. But five product-related catch blocks test `error instanceof Error`
before using `error.message`. That test is always false for a store error, so
every one of them falls through to a hardcoded generic string. A user who hits
`ProductNotFoundError`, or a persistence failure naming the exact failed
operation, sees only "Could not update the product."

The correct helper already exists and is already used in four other places. This
is a five-line mechanical substitution that recovers diagnostic information the
rest of the stack is already paying to produce.

## Current state

### Why `instanceof Error` never matches

`apps/desktop/electron/preload.ts:79-83` — the rejection value is the object
produced by `encodeStoreError`, not an `Error`:

```ts
const result = await ipcRenderer.invoke(channel, ...args);
if (result.ok) return result.value;
throw result.error;
```

### The helper that already handles this correctly

`apps/desktop/src/lib/errors.ts` in full:

```ts
import {
  decodeStoreError as decodeStoreErrorContract,
  type StoreError,
} from "@store/contracts/store-errors";

export const decodeStoreError = (error: unknown): StoreError | null => {
  try {
    return decodeStoreErrorContract(error);
  } catch {
    return null;
  }
};

export const storeErrorMessage = (error: unknown): string => {
  const decoded = decodeStoreError(error);
  if (decoded?._tag === "PersistenceError") return decoded.message;
  if (decoded?._tag === "ProductNotFoundError") return `Product ${decoded.id} could not be found.`;
  if (decoded?._tag === "InvoiceNotFoundError") return `Invoice ${decoded.id} could not be found.`;
  return error instanceof Error ? error.message : "The store operation could not be completed.";
};
```

Note its final line already provides the same generic fallback the five sites
hardcode — so substituting it cannot make any message _worse_.

### Sites already doing it right (use as the pattern)

- `apps/desktop/src/components/search-page.tsx:65`
- `apps/desktop/src/components/dashboard/home-page.tsx:46`
- `apps/desktop/src/components/products/category-field.tsx:86`
- `apps/desktop/src/components/invoices/create-context.tsx:221`

### The five sites to fix

Each currently reads `error instanceof Error ? error.message : "<generic>"`:

| File                                                  | Line | Current fallback string           |
| ----------------------------------------------------- | ---- | --------------------------------- |
| `apps/desktop/src/components/products/visibility.tsx` | 42   | `"Could not update visibility."`  |
| `apps/desktop/src/components/products/batches.tsx`    | 105  | `"Could not add the batch."`      |
| `apps/desktop/src/routes/products/$productId.tsx`     | 87   | `"Could not delete the product."` |
| `apps/desktop/src/components/products/form.tsx`       | 136  | `"Could not create the product."` |
| `apps/desktop/src/components/products/form.tsx`       | 166  | `"Could not update the product."` |

All five are inside `toastManager.add({ title: ..., type: "error" })` calls.

### Conventions

- Import as `import { storeErrorMessage } from "@/lib/errors";` — the `@/`
  alias is used throughout the renderer (see `category-field.tsx`).
- This is plain React/TypeScript. Do **not** introduce Effect in the renderer.
- Toast usage stays exactly as it is; only the `title` expression changes.

## Commands you will need

| Purpose               | Command         | Expected on success |
| --------------------- | --------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check` | exit 0              |
| Full tests            | `bunx vp test`  | exit 0              |
| Workspace checks      | `bun run check` | exit 0              |

## Scope

**In scope** (exactly four files):

- `apps/desktop/src/components/products/visibility.tsx`
- `apps/desktop/src/components/products/batches.tsx`
- `apps/desktop/src/components/products/form.tsx`
- `apps/desktop/src/routes/products/$productId.tsx`

**Out of scope** (do NOT touch):

- `apps/desktop/electron/preload.ts` — wrapping the rejection in a real
  `Error` (so stacks survive IPC) is a genuine improvement but changes the
  cross-boundary contract and would require re-checking every consumer. It is
  a separate plan. This plan adapts the callers to the contract as it is.
- `apps/desktop/src/lib/errors.ts` — the helper is correct; do not modify it.
- The `auth:*` and `server:uploads` IPC surfaces, which use two _different_
  error protocols (raw throws, and a regex-strip in `lib/auth.tsx:33-34`).
  Unifying all three onto one envelope is a separate, larger plan.
- Any `instanceof Error` check **outside** the five listed sites. Some are
  legitimately handling non-IPC errors. Do not sweep the codebase.

## Git workflow

- Branch: `advisor/020-renderer-typed-error-messages`
- A single commit is appropriate. Message style matches `git log` (short
  imperative, no prefix), e.g. `Show typed store errors in product toasts`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the five ternaries

In each of the four files, add the `storeErrorMessage` import if not already
present, then replace

```ts
error instanceof Error ? error.message : "<generic string>";
```

with

```ts
storeErrorMessage(error);
```

Delete the now-unused generic string literal — do **not** pass it as a second
argument; `storeErrorMessage` has no such parameter and already supplies an
equivalent fallback.

Change nothing else: not the toast `type`, not the surrounding control flow,
not the catch binding name.

**Verify**: `bunx vp check` → exit 0 (this also catches an unused import or a
now-unused variable, since lint runs type-aware).

### Step 2: Confirm the substitution is complete and correctly scoped

**Verify** both of these:

- `grep -rn 'instanceof Error' apps/desktop/src/components/products apps/desktop/src/routes/products`
  → **no matches**.
- `grep -rn 'storeErrorMessage' apps/desktop/src/components/products apps/desktop/src/routes/products`
  → 5 call sites across the 4 files (`form.tsx` has two).

### Step 3: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

No new automated tests. There is currently no renderer component test runner
(no jsdom environment is configured), so a test for a toast title would require
infrastructure that is deliberately out of scope here.

Verification is the two greps in Step 2 plus a type-aware `bunx vp check`,
which is strong for a change of this shape: the substitution is total, and any
mistake is a compile or lint error rather than a silent behaviour change.

Optional manual check, if the app is being run anyway: trigger a product update
against a deleted product and confirm the toast now names the product rather
than saying "Could not update the product."

## Done criteria

ALL must hold:

- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `bun run check` exits 0
- [ ] `grep -rn 'instanceof Error' apps/desktop/src/components/products apps/desktop/src/routes/products`
      → no matches
- [ ] The five generic string literals from the table above no longer appear in
      those files
- [ ] `apps/desktop/src/lib/errors.ts` and `apps/desktop/electron/preload.ts`
      are unmodified
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the five sites is not inside a `catch` handling an IPC store call —
  for example one turns out to handle a form-validation error where
  `instanceof Error` is genuinely correct. Skip that site and report it.
- Removing a generic string leaves an unused variable or import that lint
  flags and cannot be cleanly removed without touching out-of-scope code.
- `storeErrorMessage` is not exported from `@/lib/errors`, or the `@/` alias
  does not resolve in one of these files.
- You find more than five `instanceof Error` matches in the two in-scope
  directories — the file has drifted since this plan was written; re-check
  each against the table before substituting.

## Maintenance notes

- After this lands, `storeErrorMessage` is the single renderer entry point for
  turning an IPC rejection into user-facing text. New catch blocks around
  `window.offlineStore.*` calls should use it rather than inspecting the error
  directly.
- **Known related gap, still open**: `preload.ts` rejects with a plain object,
  so no stack trace survives the IPC boundary. Any store failure that fails to
  decode still degrades to the generic message with nothing to debug from.
  Wrapping the rejection in an `Error` carrying the encoded payload as `cause`
  is the proper fix and is the natural follow-up to this plan.
- The renderer still has **three** distinct IPC error protocols (typed store
  envelope, raw auth throws stripped by regex, and raw upload throws that reach
  the user with an `Error invoking remote method 'server:uploads':` prefix
  still attached). This plan fixes consumption on the one surface that already
  has a typed contract; the other two remain.
- A reviewer should confirm no site silently changed toast `type` from
  `"error"`, and that no message now leaks internal detail a user should not
  see — `PersistenceError.message` is operator-facing text and is already used
  this way elsewhere, so this is consistent, but it is worth a glance.
