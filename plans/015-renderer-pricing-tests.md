# Plan 015: Cover the renderer's pricing math with tests, and stop the runner from silently skipping `.tsx` tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- vite.config.ts apps/desktop/src/components/invoices/create-context.tsx`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

Two compounding problems.

First, the renderer decides **what the customer is charged**. `lineSalePrice`,
`discountedSalePrice` and `lineTotal` in `create-context.tsx` convert rupees to
paisa, apply a percentage discount, then compound a bulk discount — with
`Math.round` at two separate stages. None of it is tested. The persistence
layer cannot catch an error here: `invoice-store.ts:112` only validates that
`salePrice` is a non-negative integer, so a wrong-but-well-formed price is
accepted and written to the ledger.

Second, the test runner cannot collect `.tsx` tests at all. `vite.config.ts:23`
globs only `*.test.ts`. A developer (or agent) who adds
`create-context.test.tsx` would see it pass locally when run directly and
never notice CI silently skips it. That trap must be removed before anyone
writes renderer tests, or this plan's own work could rot invisibly.

After this plan the pricing helpers live in a pure, importable module with
table-driven tests, and `.tsx` tests are actually collected.

## Current state

### The runner glob

`vite.config.ts:22-25`:

```ts
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 15_000,
  },
```

No `.tsx` pattern. CI runs `bunx vp test` (`.github/workflows/ci.yml`), which
uses exactly these globs.

### The pricing helpers

`apps/desktop/src/components/invoices/create-context.tsx:96-124` — note that
`lineSalePrice` and `discountedSalePrice` are **module-private**; only
`lineTotal` is exported:

```ts
const lineSalePrice = (line: SaleLine) => {
  if (line.pricingMode === "price") {
    if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0)
      return null;
    return Math.round(line.salePrice * 100);
  }

  const basePrice = suggestedPrice(line.product, line.quantityUnit);
  if (basePrice == null || line.discount == null || line.discount < 0 || line.discount > 100)
    return null;
  return Math.round(basePrice * (1 - line.discount / 100));
};

const discountedSalePrice = (line: SaleLine, bulkDiscount: number) => {
  const price = lineSalePrice(line);
  return price == null ? null : Math.round(price * (1 - bulkDiscount / 100));
};

const lineTotal = (line: SaleLine, bulkDiscount = 0) => {
  const price = discountedSalePrice(line, bulkDiscount);
  if (
    line.quantity == null ||
    !Number.isInteger(line.quantity) ||
    line.quantity < 1 ||
    price == null
  )
    return null;
  return line.quantity * price;
};
```

`suggestedPrice` is defined at `:57-60` and takes `(product: Product,
quantityUnit: SaleLine["quantityUnit"])`. `SaleLine` is declared at `:11`.

The current export block, `create-context.tsx:267-276`:

```ts
export {
  AUTO_BATCH,
  InvoiceCreateProvider,
  lineTotal,
  paisaToRupees,
  suggestedPrice,
  useInvoiceCreate,
  type SaleLine,
};
```

### Conventions to follow

- **Test style**: model the new test file on `apps/desktop/src/lib/format.test.ts`
  — plain `vitest` (`import { describe, expect, it } from "vitest"`), a small
  local helper if it aids readability, and one `describe` per function with
  behaviour-named `it` blocks. That file is the only existing desktop test.
- **Money**: all prices are **integer paisa** in the domain; `salePrice` on a
  `SaleLine` is in _rupees_ as typed by the user, and `lineSalePrice`
  multiplies by 100. Keep that boundary explicit in test names.
- This is plain TypeScript, not Effect code — do not introduce Effect here.

## Commands you will need

| Purpose               | Command                     | Expected on success |
| --------------------- | --------------------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check`             | exit 0              |
| Full test run         | `bunx vp test`              | exit 0, all pass    |
| Just these tests      | `bunx vp test apps/desktop` | exit 0              |
| Workspace checks      | `bun run check`             | exit 0              |

## Scope

**In scope**:

- `vite.config.ts` (the `test.include` array only)
- `apps/desktop/src/components/invoices/pricing.ts` (create)
- `apps/desktop/src/components/invoices/pricing.test.ts` (create)
- `apps/desktop/src/components/invoices/create-context.tsx` (remove the moved
  helpers, import them instead — no behaviour change)

**Out of scope** (do NOT touch):

- `apps/desktop/vite.config.ts` — it has its own `staged` block; the **root**
  `vite.config.ts` owns the test globs. Do not add test config to the desktop one.
- The two non-null assertions at `create-context.tsx:212`
  (`discountedSalePrice(line, bulkDiscount!)!`). They are a real smell but
  changing submit-path behaviour is a separate plan. Leave them, and leave
  `completeSale` alone entirely.
- `packages/persistence/src/invoice-store.ts` — server-side validation is not
  part of this plan.
- Do not add a jsdom environment or React Testing Library. This plan tests
  **pure functions only**; the glob fix is groundwork for later component
  tests, not an invitation to write one now.

## Git workflow

- Branch: `advisor/015-renderer-pricing-tests`
- Commit per step is fine. Message style matches `git log` (short imperative,
  no prefix), e.g. `Extract and test invoice pricing helpers`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Widen the test glob

In the **root** `vite.config.ts`, change `test.include` to:

```ts
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
    ],
```

**Verify**: `bunx vp test` → exit 0, and the reported test-file count is the
same as before this change (there are no `.tsx` test files yet, so nothing new
should be collected). Record the count; you will compare against it in Step 4.

### Step 2: Extract the pricing helpers into a pure module

Create `apps/desktop/src/components/invoices/pricing.ts` containing
`suggestedPrice`, `lineSalePrice`, `discountedSalePrice`, and `lineTotal`,
moved **verbatim** — do not "improve" the logic, including the rounding order.
This plan characterizes current behaviour; changing it would defeat the
purpose.

The module needs the `SaleLine` type. Move the `SaleLine` interface declaration
into `pricing.ts` and re-export it from `create-context.tsx` so existing
importers keep working. Export all four functions plus `type SaleLine`.

`pricing.ts` must contain **no JSX and no React imports** — it should be
importable by a plain `.test.ts`.

**Verify**: `bunx vp check` → exit 0 (typecheck proves the move is type-clean).

### Step 3: Update `create-context.tsx` to import them

Delete the four moved function bodies and the moved `SaleLine` interface from
`create-context.tsx`; import them from `./pricing` instead. Keep the existing
public export block working — `lineTotal`, `suggestedPrice` and
`type SaleLine` must still be exported from `create-context.tsx`, because
other modules import them from there.

Do not change any call site or any behaviour.

**Verify**: `bunx vp check` → exit 0, and
`bunx vp test` → exit 0 (no regressions).

### Step 4: Write the table-driven tests

Create `apps/desktop/src/components/invoices/pricing.test.ts`, modelled on
`apps/desktop/src/lib/format.test.ts`. Build a small `makeLine(overrides)`
factory returning a valid `SaleLine` so each case states only what it varies.

Cover, at minimum:

`lineSalePrice`:

- price mode: rupees→paisa conversion (e.g. `12.34` → `1234`)
- price mode: a sub-paisa input rounds (e.g. `0.005` → `1`, documenting the
  `Math.round` half-up behaviour)
- price mode: `null`, negative, and non-finite `salePrice` each return `null`
- discount mode: 0% discount returns the base price unchanged
- discount mode: 100% discount returns `0`
- discount mode: discount `< 0` or `> 100` returns `null`
- discount mode: `null` discount returns `null`

`discountedSalePrice`:

- a bulk discount compounds on top of the line discount (assert the exact
  paisa result for a case where compounding differs from adding the two
  percentages — this is the behaviour most likely to be "fixed" by mistake later)
- a `null` line price propagates as `null`

`lineTotal`:

- quantity × discounted price
- `quantity` of `0`, a negative, a non-integer, and `null` each return `null`
- a `null` price propagates as `null`

**Verify**: `bunx vp test apps/desktop` → exit 0, and the run reports the new
`pricing.test.ts` file with all its cases passing. The total file count from
Step 1 must have increased by exactly 1.

### Step 5: Prove the glob fix actually works

Temporarily rename `pricing.test.ts` to `pricing.test.tsx` and run
`bunx vp test apps/desktop`. It must still be collected and still pass. Then
rename it **back** to `pricing.test.ts` and re-run.

This is the only direct evidence that Step 1 did what it claims.

**Verify**: both runs exit 0 and both report the file. Final state on disk is
`pricing.test.ts` (`.ts`, not `.tsx`).

### Step 6: Full verification

**Verify**: `bunx vp check` → exit 0; `bunx vp test` → exit 0;
`bun run check` → exit 0.

## Test plan

Covered by Step 4 above. Structural pattern: `apps/desktop/src/lib/format.test.ts`.

Expected outcome: one new test file, roughly 15–20 assertions, all passing,
and the existing suite unchanged (same number of pre-existing tests passing as
before the branch).

These are **characterization** tests: they lock in what the code does today,
including its rounding. If a case reveals behaviour that looks like a bug (for
example double-rounding losing a paisa), write the test asserting the **current**
behaviour, add a `// NOTE:` comment describing the concern, and report it —
do not change the implementation in this plan.

## Done criteria

ALL must hold:

- [ ] `bunx vp check` exits 0
- [ ] `bunx vp test` exits 0
- [ ] `apps/desktop/src/components/invoices/pricing.ts` exists and contains no
      `import ... react` and no JSX
- [ ] `apps/desktop/src/components/invoices/pricing.test.ts` exists and passes
- [ ] `grep -n 'test.tsx' vite.config.ts` → matches (glob widened)
- [ ] `grep -n 'const lineSalePrice' apps/desktop/src/components/invoices/create-context.tsx`
      → no matches (helper was moved, not copied)
- [ ] `bun run check` exits 0
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Moving `SaleLine` into `pricing.ts` creates an import cycle (`pricing.ts`
  needing something from `create-context.tsx`). If so, report the cycle rather
  than restructuring the context file.
- `bunx vp test` collects **fewer** tests after Step 1 than before — the glob
  change broke collection rather than widening it.
- Any existing test starts failing after Step 3. The extraction is meant to be
  behaviour-preserving; a failure means something was changed in the move.
- A pricing case you write fails against your own expectation and you are
  tempted to edit `pricing.ts` to make it pass. Assert current behaviour,
  comment, and report instead.
- `suggestedPrice` turns out to depend on React state or context rather than
  being pure — then it cannot move and the plan needs revising.

## Maintenance notes

- `pricing.ts` is now the single home for sale-price arithmetic. Any new
  discount type, tax, or rounding rule belongs there with a test, not inline
  in the provider.
- The `.tsx` glob is now open. The next person writing an actual **component**
  test will still need a jsdom environment and a React testing library, which
  this plan deliberately did not add — expect that to be its own plan.
- A reviewer should scrutinize the Step 2 diff specifically for accidental
  logic changes: the functions must be byte-identical apart from the `export`
  keyword and the moved `SaleLine`.
- The two non-null assertions at the old `create-context.tsx:212` are still
  there and still unprotected. Now that `discountedSalePrice` is exported and
  tested, narrowing them is a cheap follow-up.
- Known related gap, deliberately out of scope: `packages/services` has no
  `test` script at all, and the Electron IPC boundary
  (`apps/desktop/electron/main.ts`) has zero tests.
