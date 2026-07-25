# Plan 004: Remove the `program` accessor wrappers from @store/persistence

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- packages/persistence/src apps/desktop/electron/main.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (revised 2026-07-19 — was S; the seven persistence test files are consumers too)
- **Risk**: LOW
- **Depends on**: none (but land BEFORE plan 003, which edits the same `main.ts` region)
- **Category**: tech-debt
- **Planned at**: commit `a98b4aa7`, 2026-07-15; scope revised at `fe1891d6`, 2026-07-19

> **Scope revision (2026-07-19)**: the first execution attempt stopped
> correctly on discovering that seven persistence test files also import
> `program` from `./index` (`database.test.ts`, `errors.test.ts` (check),
> `inventory-allocation.test.ts`, `mutation-attribution.test.ts`,
> `pack-units.test.ts`, `product-search.test.ts`, `product-store.test.ts`,
> `sync-engine.test.ts` — confirm the exact list with the grep in "Current
> state"). This revision brings those files into scope via a shared
> test-support helper (Step 1b). The original STOP condition "another
> consumer besides main.ts" is superseded: test files ARE expected
> consumers now; any consumer outside `main.ts` and `packages/persistence`
> remains a STOP.

## Why this matters

`packages/persistence/src/service.ts` exports a `program` object that is 16
one-line forwarders of the shape `Effect.flatMap(OfflineStore, (store) =>
store.method(...))` — one per service method. This is the exact anti-pattern
the repo's Effect guidelines call out ("avoid exporting trivial accessor
wrappers that only forward to one service method"): it duplicates the entire
service surface as a second public API, so every new store method must be
added in three places (service shape, store implementation, `program`). Its
only consumer is the Electron main process, which can access the service
directly.

## Current state

- `packages/persistence/src/service.ts:76-97` — the accessor wall (excerpt):

```ts
export const program = {
  listCategories: Effect.flatMap(OfflineStore, (store) => store.listCategories),
  listProducts: Effect.flatMap(OfflineStore, (store) => store.listProducts),
  searchProducts: (input: SearchProductsInput) =>
    Effect.flatMap(OfflineStore, (store) => store.searchProducts(input)),
  // ... 11 more of the same ...
  getSyncStatus: Effect.flatMap(OfflineStore, (store) => store.getSyncStatus),
  sync: Effect.flatMap(OfflineStore, (store) => store.sync),
};
```

- `packages/persistence/src/index.ts:8` — `export { OfflineStore, layer, program } from "./service";`
- The ONLY consumer: `apps/desktop/electron/main.ts` — imports `program`
  (line 16) and uses it in `registerStoreIpc()` (lines 85–152). Handler shapes
  today:

```ts
// main.ts:86-94
ipcMain.handle("store:categories:list", () => runStore(program.listCategories));
ipcMain.handle("store:products:search", (_event, input: unknown) =>
  runStore(
    Schema.decodeUnknownEffect(SearchProductsInput)(input).pipe(
      Effect.flatMap(program.searchProducts),
    ),
  ),
);
```

- `runStore` accepts `Effect.Effect<A, E, OfflineStore>` (main.ts:74), so
  effects that access the service directly type-check unchanged.
- `OfflineStore` is a `Context.Service` class (`service.ts:31-53`) — usable
  directly as a tag in `Effect.flatMap(OfflineStore, ...)`.
- Enumerate all consumers of `program`:
  `grep -rln "program" --include="*.ts" apps packages | grep -v node_modules` —
  expected: `apps/desktop/electron/main.ts`, `packages/persistence/src/service.ts`
  (the definition), and the persistence `*.test.ts` files. Anything else is a
  STOP condition.
- Test usage shape (e.g. `sync-engine.test.ts:28-35`):
  `await runtime.runPromise(program.createProduct({ ... }))` against a
  `ManagedRuntime.make(layer({ dataDir, migrationsFolder }))`.
- `packages/persistence/src/test-support.ts` — shared test helpers
  (`migrationsFolder`, `readOutbox`); the natural home for the replacement
  helper in Step 1b.

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |

## Scope

**In scope** (the only files you should modify):

- `packages/persistence/src/service.ts` (delete `program`)
- `packages/persistence/src/index.ts` (drop the `program` export)
- `apps/desktop/electron/main.ts` (rewrite the 14 handler bodies)
- `packages/persistence/src/test-support.ts` (add the `store` helper)
- The persistence `*.test.ts` files that import `program` (mechanical call-site rewrite only — do NOT change any assertion)

**Out of scope** (do NOT touch):

- The `OfflineStore` service shape and the store implementations.
- `runStore` itself (plan 003 changes it — keep this plan mechanical).
- `preload.ts`, contracts, renderer code.

## Git workflow

- Branch: `advisor/004-remove-program-accessors`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a single generic accessor at the IPC edge

In `apps/desktop/electron/main.ts`, replace the `program` import with
`OfflineStore` (already imported) and add ONE local helper next to `runStore`:

```ts
type OfflineStoreShape = Context.Tag.Service<typeof OfflineStore>;
const withStore = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);
```

(If `Context.Tag.Service` isn't the right type extractor on this beta, use
`Effect.Effect.Success<typeof OfflineStore>` or derive the shape from how
`OfflineStore.of({...})` is typed in `service.ts:65` — verify against the
vendored source `.repos/effect/packages/effect/src/Context.ts` rather than
guessing. Import `Context` via `import * as Context from "effect/Context";`.)

Rewrite the handlers, e.g.:

```ts
ipcMain.handle("store:categories:list", () => runStore(withStore((s) => s.listCategories)));
ipcMain.handle("store:products:search", (_event, input: unknown) =>
  runStore(
    Schema.decodeUnknownEffect(SearchProductsInput)(input).pipe(
      Effect.flatMap((input) => withStore((s) => s.searchProducts(input))),
    ),
  ),
);
```

Apply the same shape to all 14 `store:*` handlers (lines 86–151).

**Verify**: `vp check` → exit 0.

### Step 1b: Migrate the test files

Add to `packages/persistence/src/test-support.ts` the same generic accessor
(import `OfflineStore` from `./service`):

```ts
export const store = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);
```

(Use the same service-shape type extractor as Step 1 — resolve it once,
reuse in both places.) Then rewrite every test call site mechanically:
`program.createProduct({...})` → `store((s) => s.createProduct({...}))`,
`program.sync` → `store((s) => s.sync)`, etc. Do not alter any assertion,
fixture value, or test name.

**Verify**: `vp test` → all pass, same test count as before the change.

### Step 2: Delete `program`

Remove `service.ts:76-97` (the whole `program` object) and remove `program`
from the `index.ts` export list.

**Verify**:

- `vp check` → exit 0
- `grep -rn "program" packages/persistence/src apps/desktop/electron --include="*.ts"` → no remaining references to the deleted export.

### Step 3: Full suite

**Verify**: `vp test` → all pass (no behavioral change expected — this is a
pure call-path refactor).

## Test plan

No new tests: the change is mechanical and covered by the typechecker plus the
existing persistence test suite. The IPC handlers have no test harness today
(noted in Maintenance notes).

## Done criteria

- [ ] `vp check` exits 0; `vp test` exits 0
- [ ] `service.ts` no longer exports `program`; `index.ts` export list updated
- [ ] `main.ts` uses one generic `withStore` helper; all 14 `store:*` handlers still registered with identical channel names (compare `grep -c "ipcMain.handle(\"store:" apps/desktop/electron/main.ts` → 14 before and after)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep` in "Current state" reveals a consumer of `program` outside
  `apps/desktop/electron/main.ts` and `packages/persistence`.
- You cannot find a correct type extractor for the service shape from the
  vendored Effect source — do not fall back to `any` or an `as` cast (both
  are banned by repo conventions).
- Channel names or handler counts would change.

## Maintenance notes

- New `OfflineStore` methods now require exactly two touches: the service
  shape in `service.ts` and the store implementation — reviewers should
  reject reintroduction of forwarding wrappers.
- Plan 003 rewrites `runStore`'s return shape in this same file; land this
  plan first to keep both diffs readable.
