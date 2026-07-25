# Plan 007: Make invoice-upload apply atomic — one transactional bulk import, one outbox operation, safe retry

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- apps/desktop/src/components/uploads/upload-context.tsx packages/persistence/src/product-store.ts packages/persistence/src/service.ts packages/contracts/src apps/desktop/electron/main.ts apps/desktop/electron/preload.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (see "Coordination with plans 003/004" below)
- **Category**: bug (with a perf win)
- **Planned at**: commit `fe1891d6`, 2026-07-19

## Why this matters

The invoice-upload "Apply" flow loops over extracted changes in the renderer,
issuing one `createProduct` and/or one `createBatch` IPC call per line. Two
concrete problems:

1. **Retry double-applies stock (data corruption).** Each per-line call
   commits its own local transaction. If the loop fails midway, or the
   post-loop `sync()` reports an error, the `catch` resets the UI to `"ready"`
   **without clearing `changes`**, and the Apply button is enabled again. The
   de-dupe map is local to each attempt and `change.productId` is stale, so a
   second click re-creates already-created products (duplicates) and re-runs
   `createBatch` (double-counted inventory). A transient sync failure — the
   most likely failure — leaves all local writes committed and invites exactly
   this retry.
2. **2N sequential roundtrips.** Importing M lines serializes up to 2M
   IPC + PGlite transactions + 2M individual outbox operations for what is
   logically one import.

The fix for both is the same: one store method that performs the whole import
in a single PGlite transaction with a single outbox operation. Failure then
rolls back everything (retry is safe), and a sync error after a successful
local commit must NOT be treated as an apply failure — the outbox retries it.

## Current state

- `apps/desktop/src/components/uploads/upload-context.tsx:216-265` — the
  buggy apply loop (abridged):

```tsx
const applyChanges = async () => {
  ...
  setPhase("syncing");
  try {
    const generalCategory =
      categories.find((category) => category.id === "general") ?? categories[0];
    if (!generalCategory) throw new Error("Create a category before importing inventory.");
    const createdProducts = new Map<string, string>();
    for (const change of changes) {
      const productKey = change.name.trim().toLocaleLowerCase();
      const productId =
        change.productId ??
        createdProducts.get(productKey) ??
        (await window.offlineStore.createProduct({ name: change.name, categoryId: generalCategory.id, ... })).id;
      if (!change.productId) createdProducts.set(productKey, productId);
      if (change.packQuantity + change.unitQuantity > 0)
        await window.offlineStore.createBatch({ productId, batchNumber: change.batchNumber, ... });
    }
    const syncStatus = await window.offlineStore.sync();
    if (syncStatus.phase === "error") throw new Error(syncStatus.message);   // ← bug: local commit already happened
    toast.success(`${changes.length} inventory changes applied locally.`);
    await router.invalidate();
    setChanges([]); setFiles([]); setPhase("idle");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not apply changes.");
    setPhase("ready");   // ← bug: changes kept, Apply clickable again over committed writes
  }
};
```

- The `changes` items have this shape (defined at `upload-context.tsx:16-24`,
  type `Extraction["lines"][number]` plus `type`/`productId` added during
  analyse): `{ name, batchNumber, expiresAt (string | null), unitsPerPack,
packQuantity, unitQuantity, packPrice, type: "add_inventory" | "create_product",
productId?: string }`.
- `packages/persistence/src/product-store.ts` — the store implementation.
  `createProduct` (`:172`) and `createBatch` (`:318`) each open
  `database.transaction(...)`, insert rows with full actor attribution
  (`organizationId`, `createdByUserId`, `deviceId`, `operationId`,
  `rowVersion: 1`, timestamps), insert a `stock_in` stock movement (batch
  path), and call `enqueueOperation(transaction, actor, operationId,
occurredAt, [...changes])` from `./outbox`. **Read both methods fully before
  writing the new one — the new method must produce identical row shapes.**
- `packages/persistence/src/service.ts:31-53` — `OfflineStore` is a
  `Context.Service` class listing every store method;
  `:65-70` spreads `makeProductStore(...)` into `OfflineStore.of({...})`.
- `packages/contracts/src/offline-store.api.ts:17-31` — `OfflineStoreApi`,
  the renderer-facing promise interface (one entry per IPC channel).
- `packages/contracts/src/store.schema.ts` — input schemas
  (`CreateProductInput`, `CreateBatchInput`, ...) as Effect `Schema.Struct`s
  with same-name interfaces. Follow this file's existing pattern for the new
  `ImportInventoryInput`.
- `apps/desktop/electron/main.ts:92-151` — `registerStoreIpc` registers
  `store:*` handlers; each decodes input with
  `Schema.decodeUnknownEffect(...)` then calls the store through `runStore`.
- `apps/desktop/electron/preload.ts:76-91` — `offlineStore` bridge maps
  `OfflineStoreApi` methods to `ipcRenderer.invoke("store:...")` channels.
- Repo Effect conventions (from `.claude/skills/effect/SKILL.md`, binding
  here): service methods use `Effect.fn("OfflineStore.importInventory")`;
  typed failures use the existing `PersistenceError` /
  `Schema.TaggedErrorClass` classes from `packages/persistence/src/errors.ts`;
  no `as any`, no non-null assertions; decode untrusted IPC input with
  `Schema.decodeUnknownEffect`.

## Commands you will need

| Purpose   | Command                | Expected on success  |
| --------- | ---------------------- | -------------------- |
| Install   | `vp install`           | exit 0               |
| Check all | `vp check` (repo root) | exit 0 (see note)    |
| Tests     | `vp test` (repo root)  | all pass (28+ tests) |

Note: at planning time `vp check` fails only on formatting of untracked
`.agents/skills/effect/*.md` files. That failure is pre-existing and out of
scope; judge your work by the absence of NEW failures (or run
`vp check apps packages` if the CLI supports path scoping).

## Scope

**In scope** (the only files you should modify):

- `packages/contracts/src/store.schema.ts` (add `ImportInventoryInput`, `ImportInventoryResult`)
- `packages/contracts/src/offline-store.api.ts` (add `importInventory`)
- `packages/contracts/src/index.ts` (export the new schema types if this file re-exports schemas explicitly)
- `packages/persistence/src/product-store.ts` (add the `importInventory` method)
- `packages/persistence/src/service.ts` (add `importInventory` to the service shape; if the `program` accessor object still exists at `service.ts:76-97`, add a matching entry — plan 004 may have removed it)
- `packages/persistence/src/product-store.test.ts` OR a new `packages/persistence/src/inventory-import.test.ts` (tests)
- `apps/desktop/electron/main.ts` (register `store:inventory:import`)
- `apps/desktop/electron/preload.ts` (bridge method)
- `apps/desktop/src/components/uploads/upload-context.tsx` (call the new method; fix the retry/sync-error semantics)

**Out of scope** (do NOT touch, even though they look related):

- `packages/persistence/src/outbox.ts`, `sync-engine.ts` — the outbox and
  sync machinery already support multi-change operations; do not modify them.
- `apps/api/**` — the server applies operations generically; no server change
  is needed or allowed here.
- `upload-proposed-changes.tsx` and the other upload components — only the
  context changes.
- The existing `createProduct`/`createBatch` methods — leave their behavior
  untouched; other callers depend on them.

## Git workflow

- Branch: `advisor/007-transactional-bulk-inventory-import`
- Commit per step; short imperative messages (repo history mixes
  `feat: ...` and plain imperatives — either is acceptable).
- Do NOT push or open a PR unless the operator instructed it.

## Coordination with plans 003/004

Plans 003 and 004 (see `plans/README.md`) rewrite the `store:*` handler
region of `apps/desktop/electron/main.ts`. This plan only ADDS one handler.
Match whatever accessor style is live in `main.ts` when you execute (either
`program.x` or a `withStore((s) => s.x)` helper). If the file looks mid-
refactor (both styles present), STOP and report.

## Steps

### Step 1: Define the contract

In `packages/contracts/src/store.schema.ts`, following the file's existing
`Schema.Struct` + same-name-interface pattern, add:

```ts
export const ImportInventoryLine = Schema.Struct({
  name: Schema.String,
  batchNumber: Schema.String,
  expiresAt: Schema.NullOr(Schema.Number), // epoch ms, already validated by the renderer's validTimestamp
  unitsPerPack: Schema.NullOr(Schema.Number),
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  packPrice: Schema.NullOr(Schema.Number),
  productId: Schema.NullOr(Schema.String), // null → find-or-create by name
});
export const ImportInventoryInput = Schema.Struct({
  categoryId: Schema.String,
  lines: Schema.Array(ImportInventoryLine),
});
```

(Adapt field optionality/types to the exact `CreateProductInput` /
`CreateBatchInput` definitions in the same file — the persistence layer must
receive the same shapes it already inserts. If those schemas use branded or
derived drizzle types, reuse them.) Add a result type: at minimum
`{ createdProducts: number; createdBatches: number }` as a `Schema.Struct`.

Add `readonly importInventory: (input: ImportInventoryInput) => Promise<ImportInventoryResult>;`
to `OfflineStoreApi` in `offline-store.api.ts`.

**Verify**: `vp check` → no new errors (desktop will fail to compile until
Steps 3–4 wire the bridge — if the API interface change breaks `preload.ts`
compilation, proceed to Step 3 before checking).

### Step 2: Implement `importInventory` in the store

In `packages/persistence/src/product-store.ts`, add a method built with
`Effect.fn("OfflineStore.importInventory")` that:

1. Reads `mutationContext()` once; generates ONE `operationId` and one
   `occurredAt` for the whole import (mirroring `createBatch:337-338`).
2. Opens ONE `database.transaction(...)`.
3. Inside the transaction, for each line:
   - Resolves the product: if `productId` is set, verify it exists (reuse the
     lookup style of `createBatch:333-336`, but query inside the
     transaction); otherwise look up an existing non-deleted product by
     normalized name (`trim().toLocaleLowerCase()` comparison — query with
     `lower(name) =` or filter in memory from one pre-loaded product list)
     within the actor's organization, and create it only if absent. Track
     created products in a local Map keyed by normalized name so duplicate
     lines in one import share one product.
   - If `packQuantity + unitQuantity > 0`, inserts the batch row and its
     `stock_in` stock movement with exactly the same column population as
     `createBatch` (`product-store.ts:342-384`), including the shared
     `operationId`.
   - Validates quantities with the same rules as `createBatch:319-331`
     (non-negative integers, at least 1 unit of stock) — fail the whole
     import with `PersistenceError` on violation.
4. Collects every inserted/created row into ONE
   `enqueueOperation(transaction, actor, operationId, occurredAt, [...])`
   call — products first, then batches, then stock movements (the server
   sorts changes, but keep the natural dependency order the existing methods
   use).
5. Returns the counts.

**Verify**: `vp check` → no new errors in `packages/persistence`.

### Step 3: Wire IPC

- `service.ts`: add `importInventory` to the `OfflineStore` service shape and
  it will flow through the `...productStore` spread (confirm `makeProductStore`
  returns it in the object literal at `product-store.ts:427-440`).
- `main.ts`, inside `registerStoreIpc`, next to the existing
  `store:batches:create` handler:

```ts
ipcMain.handle("store:inventory:import", (_event, input: unknown) =>
  runStore(
    Schema.decodeUnknownEffect(ImportInventoryInput)(input).pipe(
      Effect.flatMap(/* match the live accessor style — see Coordination */),
    ),
  ),
);
```

- `preload.ts`: add
  `importInventory: (input) => ipcRenderer.invoke("store:inventory:import", input),`
  to the `offlineStore` object.

**Verify**: `vp check` → no new errors anywhere.

### Step 4: Fix the renderer semantics

In `upload-context.tsx`, replace the body of `applyChanges` (lines 216-265):

1. Keep the offline guard and the `generalCategory` resolution.
2. Map `changes` to `ImportInventoryInput.lines` (convert `expiresAt` with the
   existing `validTimestamp` helper; pass `productId: change.productId ?? null`).
3. Make ONE call: `await window.offlineStore.importInventory({ categoryId: generalCategory.id, lines })`.
   If it throws → toast the error, `setPhase("ready")` and KEEP `changes`
   (retry is now safe: nothing was committed).
4. On success, immediately clear the proposal — `setChanges([]); setFiles([]);`
   then `await router.invalidate()` — BEFORE syncing.
5. Then call `await window.offlineStore.sync()`. If `syncStatus.phase ===
"error"`, show a NON-fatal warning toast (e.g. "Inventory imported locally;
   sync will retry automatically.") — do NOT rethrow, do NOT restore the
   proposal. Finish with `setPhase("idle")` in both sync outcomes.

**Verify**: `vp check` → no new errors.

### Step 5: Full suite

**Verify**: `vp test` → all pass, including the new tests from the Test plan.

## Test plan

New tests in `packages/persistence/src/inventory-import.test.ts`, modeled
structurally on `packages/persistence/src/sync-engine.test.ts` (tmpdir PGlite,
`ManagedRuntime.make(layer({ dataDir, migrationsFolder }))`, `readOutbox`
from `./test-support`):

1. **Happy path**: import 2 lines (one brand-new product with stock, one
   `productId`-targeted add) → products/batches/movements exist, and
   `readOutbox` shows exactly ONE new operation (beyond the bootstrap
   operation) containing all changes.
2. **Duplicate names in one import** share a single created product.
3. **Atomic failure**: an import whose second line has invalid quantities
   (e.g. `packQuantity: -1`) fails AND leaves no product/batch/outbox row
   from the first line (assert row counts unchanged).
4. **Idempotent retry surface**: after a successful import, importing the same
   lines again with `productId: null` reuses the existing products by name
   (no duplicate products; new batches only).

**Verification**: `vp test` → all pass; the four new tests are listed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `vp check` — no failures other than the pre-existing untracked
      `.agents/skills/effect/*.md` formatting complaint
- [ ] `vp test` exits 0 with ≥4 new inventory-import tests passing
- [ ] `grep -n "createProduct\|createBatch" apps/desktop/src/components/uploads/upload-context.tsx` → no matches (the loop is gone)
- [ ] `grep -c "enqueueOperation" packages/persistence/src/product-store.ts` → exactly one more than before your change (one bulk call added, none removed)
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `main.ts`'s store handler region doesn't match either accessor style
  described in "Coordination with plans 003/004".
- The `CreateBatchInput`/`CreateProductInput` schemas in `store.schema.ts`
  use derivation machinery (drizzle-derived structs) you cannot mirror for
  `ImportInventoryInput` without casts — report the exact type error instead
  of using `as`.
- Test 3 (atomicity) fails because `database.transaction` semantics differ
  from the assumption that a failed Effect inside the callback rolls back the
  transaction — verify against how `createInvoice` handles
  `invalidInvoice` failures (`invoice-store.ts:157-175`) and report.
- You find another caller of the removed renderer loop pattern.

## Maintenance notes

- Future "import from CSV/AI" surfaces should reuse `importInventory` rather
  than composing per-row calls — reviewers should reject new renderer loops
  over `createProduct`/`createBatch`.
- The sync-error-is-not-apply-error semantics in Step 4 is deliberate; a
  reviewer seeing the removed `if (syncStatus.phase === "error") throw`
  should not restore it.
- Plan 009 (typed decoding of server responses) touches the same
  `upload-context.tsx` file earlier in the flow (`analyse`); no ordering
  requirement, but expect a small merge if both are in flight.
