# Plan 017: Stop the dashboard from hard-failing once revenue exceeds the 32-bit integer limit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- packages/persistence/src/analytics-store.ts packages/persistence/src/analytics-store.test.ts packages/contracts/src/store.schema.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

Every money and quantity aggregate on the home dashboard is cast back to a
32-bit integer with `::int`. In PostgreSQL, `sum(integer)` returns `bigint`;
casting that back to `int4` raises `integer out of range` as soon as the sum
exceeds 2,147,483,647.

Money is stored as **integer paisa**, so that ceiling is about ₨21.47 million
of turnover in a single 30-day window — and for `topProductsQuery` the sum is
per product over 30 days, while `revenueByDayQuery` groups per day. The whole
`getDashboardAnalytics` call runs these six queries with `Effect.all`, so the
**first** aggregate to overflow fails the entire effect: the home screen shows
a `PersistenceError` and stays broken, with no partial degradation and no way
for the user to clear it. It then re-fails on every `offline-store:sync` event.

This is a latent hard-failure with a fixed, arithmetic trigger date determined
purely by how well the shop does. The fix is small and self-contained.

## Current state

### The failing casts

`packages/persistence/src/analytics-store.ts:44-70`:

```ts
const revenueByDayQuery = database.select({
  date: sql<string>`to_char((to_timestamp(${invoices.createdAt} / 1000.0) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
  revenue: sql<number>`coalesce(sum(${invoices.total}), 0)::int`,
  invoices: sql<number>`count(*)::int`,
});
```

```ts
const itemRevenue = sql`coalesce(sum(${invoiceItems.quantity} * ${invoiceItems.salePrice}), 0)`;
const topProductsQuery = database.select({
  productId: invoiceItems.productId,
  productName: sql<string>`max(${invoiceItems.productName})`,
  unitsSold: sql<number>`coalesce(sum(${invoiceItems.baseUnitQuantity}), 0)::int`,
  revenue: sql<number>`${itemRevenue}::int`,
});
```

`packages/persistence/src/analytics-store.ts:104-111`:

```ts
const liveBatch = sql`${batches.id} IS NOT NULL AND ${batches.deletedAt} IS NULL`;
const totalUnits = sql`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.packQuantity} * ${products.unitsPerPack} + ${batches.unitQuantity} ELSE 0 END), 0)`;
const lowStockQuery = database.select({
  productId: products.id,
  productName: products.name,
  packQuantity: sql<number>`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.packQuantity} ELSE 0 END), 0)::int`,
  unitQuantity: sql<number>`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.unitQuantity} ELSE 0 END), 0)::int`,
});
```

`packages/persistence/src/analytics-store.ts:147`:

```ts
      .select({ count: sql<number>`count(*)::int` })
```

### Which casts actually need changing

Not all of them. Classify before editing:

- **`sum(...)` over a money or quantity column → MUST change.** These are the
  overflow risks: `revenue` (`:47`), `unitsSold` (`:59`), `revenue` (`:60`),
  `packQuantity` (`:110`), `unitQuantity` (`:111`).
- **`count(*)` → leave as `::int`.** `count(*)` returns `bigint` too, but a row
  count large enough to overflow `int4` is not reachable in a local PGlite
  store, and changing it adds string-conversion noise for no benefit.
  Lines `:48` and `:147` stay as they are.
- **`totalUnits` (`:105`)** is used only inside a `HAVING` comparison and an
  `ORDER BY` — it is never selected, so it has no cast and needs none.

### The critical gotcha: `::bigint` returns a string

This is the part that will silently break if you skip it. The Postgres wire
protocol returns `bigint` as a **string** in JavaScript (drivers do this to
avoid silent precision loss), whereas `::int` comes back as a number. So
changing the cast also changes the JS type, and the `sql<number>` type
parameter would become a lie.

Every changed aggregate must therefore be typed `sql<string>` and converted
explicitly with `Number(...)` where the row is mapped.

`Number()` is safe here: JavaScript integers are exact up to 2^53, which is
about ₨90 trillion in paisa — far beyond any real turnover, and vastly beyond
the 2^31 ceiling this plan removes.

### The consumer contract (must not change)

`packages/contracts/src/store.schema.ts:154-207` declares `DashboardAnalytics`
with `Schema.Number` for every one of these fields. **The public contract stays
numeric** — the conversion happens inside the store, before the value reaches
the contract. Do not change the contract to accept strings.

The mapping happens in the `Effect.all([...]).pipe(Effect.map(...))` block
beginning at `analytics-store.ts:157`.

### Conventions to follow

This is Effect v4 code. Relevant house rules:

- The store is built by `makeAnalyticsStore(database, mutationContext)`
  returning a plain object — keep that shape.
- Errors map through the existing `mapPersistenceError("...")` helper
  (`packages/persistence/src/errors.ts`); do not introduce a new error type.
- The existing `Effect.all([...])` concurrency structure is correct — do not
  restructure it.
- Do not add `as` casts or non-null assertions to satisfy the type checker.
  If a type does not line up after the `sql<string>` change, fix the mapping,
  not the types.

### Test pattern

`packages/persistence/src/analytics-store.test.ts` is the model. It uses a real
PGlite instance in a temp directory:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, expect, test, vi } from "vitest";

import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";
```

```ts
vi.useFakeTimers({ toFake: ["Date"] });
const directory = await mkdtemp(path.join(tmpdir(), "store-analytics-"));
let organizationId = "org-a";
const runtime = ManagedRuntime.make(
  layer({
    dataDir: path.join(directory, "pglite"),
    migrationsFolder,
    mutationContext: () => ({ organizationId, userId: "tester", deviceId: "device-1" }),
  }),
);
```

Work is driven with `runtime.runPromise(store((s) => s.someMethod(...)))`.

## Commands you will need

| Purpose               | Command                             | Expected on success |
| --------------------- | ----------------------------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check`                     | exit 0              |
| Persistence tests     | `bunx vp test packages/persistence` | exit 0, all pass    |
| Full tests            | `bunx vp test`                      | exit 0              |
| Workspace checks      | `bun run check`                     | exit 0              |

Note: the persistence suite spins up real PGlite instances and takes roughly a
minute. That is normal.

## Scope

**In scope**:

- `packages/persistence/src/analytics-store.ts`
- `packages/persistence/src/analytics-store.test.ts`

**Out of scope** (do NOT touch):

- `packages/contracts/src/store.schema.ts` — `DashboardAnalytics` stays
  `Schema.Number` throughout. The conversion is an implementation detail of
  the store.
- `packages/db/src/shared/store.schema.ts` — **do not** widen
  `invoices.total` or `invoiceItems.salePrice` from `integer` to `bigint`.
  That is a schema migration affecting the sync payload, the server's
  `row-validation.ts`, and both migration sets. It is a separate, larger piece
  of work and is deliberately deferred (see Maintenance notes). A single
  invoice large enough to overflow a column is not the reachable failure; the
  **aggregate** is.
- `apps/desktop/src/components/dashboard/**` — the renderer receives numbers
  before and after this change.
- The `count(*)::int` casts at `:48` and `:147`.

## Git workflow

- Branch: `advisor/017-bigint-money-aggregates`
- Commit per step is fine. Message style matches `git log` (short imperative,
  no prefix), e.g. `Sum dashboard money aggregates as bigint`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a failing regression test first

Before changing any SQL, add a test to
`packages/persistence/src/analytics-store.test.ts` that seeds enough revenue to
cross the 32-bit ceiling, then calls `getDashboardAnalytics`.

Approach: create one product, then create invoices whose summed `total`
exceeds 2,147,483,647 paisa. You do not need many invoices — use a few with
large `salePrice` and quantity values. Keep every seeded timestamp inside the
30-day window (follow the existing `NOW` / `windowStart` helpers at the top of
the file).

Assert that `getDashboardAnalytics` resolves and that `totals.revenue30d`
equals the exact expected paisa sum.

**Verify**: `bunx vp test packages/persistence` → this new test **FAILS** with
a Postgres `integer out of range` error. If it passes, STOP — see STOP
conditions.

### Step 2: Change the five aggregate casts to `::bigint`

In `analytics-store.ts`, change exactly these five, and change their type
parameter from `sql<number>` to `sql<string>`:

- `:47` `revenue` in `revenueByDayQuery`
- `:59` `unitsSold` in `topProductsQuery`
- `:60` `revenue` in `topProductsQuery`
- `:110` `packQuantity` in `lowStockQuery`
- `:111` `unitQuantity` in `lowStockQuery`

Leave `count(*)::int` at `:48` and `:147` alone. Leave `totalUnits` at `:105`
alone.

**Verify**: `grep -n '::int' packages/persistence/src/analytics-store.ts` →
exactly two matches, both `count(*)::int`.

### Step 3: Convert the strings to numbers at the mapping boundary

In the `Effect.all([...]).pipe(Effect.map(...))` block starting around `:157`,
wrap every newly-stringified field in `Number(...)` as the rows are mapped
into the `DashboardAnalytics` shape. This includes any derived totals computed
from them (for example `revenue7d`, `revenue30d`, `revenueToday`, and
`averageInvoice30d`, which are aggregated in TypeScript from the day series).

Be careful with the derived totals: summing strings with `+` concatenates.
Convert **before** any arithmetic, not after.

**Verify**: `bunx vp check` → exit 0 (the typechecker will flag any place a
`string` still flows into a `number` field).

### Step 4: Confirm the regression test now passes

**Verify**: `bunx vp test packages/persistence` → exit 0, including the new
large-revenue test, and every pre-existing analytics assertion still passing
with unchanged expected values.

### Step 5: Guard against string concatenation bugs

Extend the new test (or add a second one) asserting that a **derived** total is
numerically correct and not a concatenation — for example, seed two days of
revenue and assert `totals.revenue30d` equals the arithmetic sum, and assert
`typeof totals.revenue30d === "number"`.

Add the same `typeof` assertion for one `topProducts` entry's `revenue` and one
`lowStock` entry's `packQuantity`.

**Verify**: `bunx vp test packages/persistence` → exit 0.

### Step 6: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

New tests in `packages/persistence/src/analytics-store.test.ts` (the existing
file — do not create a new one):

1. Revenue above 2^31 paisa in the 30-day window: `getDashboardAnalytics`
   resolves and `totals.revenue30d` is exact. **This is the regression test**
   and must fail before Step 2.
2. Derived totals are numeric, not concatenated: assert both the arithmetic
   value and `typeof === "number"`.
3. `topProducts[].revenue`, `topProducts[].unitsSold`, and
   `lowStock[].packQuantity` are numbers.

Structural pattern: the existing test in the same file.

All pre-existing assertions must continue to pass **with unchanged expected
values** — this change must not alter any result at normal magnitudes.

## Done criteria

ALL must hold:

- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `grep -n '::int' packages/persistence/src/analytics-store.ts` → exactly
      2 matches, both `count(*)::int`
- [ ] `grep -c '::bigint' packages/persistence/src/analytics-store.ts` → 5
- [ ] A test seeding >2^31 paisa exists and passes
- [ ] `grep -n 'as number\|as unknown' packages/persistence/src/analytics-store.ts`
      → no new matches
- [ ] `packages/contracts/src/store.schema.ts` is unmodified
      (`git diff --stat` shows it absent)
- [ ] `bun run check` exits 0
- [ ] `git status --short` lists only the two in-scope files
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **The Step 1 test passes before you change anything.** That means either
  PGlite does not enforce the `int4` cast range the way server PostgreSQL does,
  or the seeding did not actually cross the threshold. Either way the premise
  needs re-checking before you change production SQL — report what you
  observed.
- After Step 2, the driver returns **numbers** rather than strings for the
  `::bigint` columns. Then the `sql<string>` typing and the `Number()` wrapping
  are wrong for this driver; report it rather than leaving a mismatched type.
- Any pre-existing analytics assertion changes value. This change must be
  behaviour-preserving at normal magnitudes; a changed expectation means
  something was converted twice or in the wrong place.
- You find yourself needing to modify `packages/contracts` or `packages/db` to
  make it typecheck. Both are out of scope; report instead.
- Seeding the large-revenue fixture requires bypassing `createInvoice`
  validation (for example inserting rows directly). Prefer going through the
  public store API; if that is genuinely impossible within the validation
  limits, report before hand-rolling inserts.

## Maintenance notes

- **Deliberately deferred**: `invoices.total` and `invoiceItems.salePrice` are
  still `integer` columns (`packages/db/src/shared/store.schema.ts:126,176`).
  A _single_ invoice above ₨21.47m would still overflow on insert. That is a
  much rarer trigger than the aggregate, and widening those columns to
  `bigint` touches the local and remote migration sets, the sync payload
  shape, and the server's hand-written `row-validation.ts`. Track it
  separately; do not smuggle it into this plan.
- Any new aggregate added to `analytics-store.ts` must follow the same rule:
  `sum()` over a money or quantity column is `::bigint` + `sql<string>` +
  `Number()` at the mapping boundary. Consider a short comment at the top of
  the file recording this so the next person does not reintroduce `::int`.
- A reviewer should check specifically that no arithmetic happens on a value
  before it is passed through `Number()` — string concatenation would produce
  plausible-looking but wildly wrong totals, and the type system will not
  catch it once a value is typed `number`.
- Related known gap, out of scope: `invoice_items` has no
  `(organization_id, created_at)` index, so `topProductsQuery` scans every
  invoice line ever written on each dashboard load. That is a performance item
  in the backlog, not a correctness one.
