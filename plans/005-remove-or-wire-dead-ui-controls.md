# Plan 005: Wire up the product delete action and remove the other dead UI controls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a98b4aa7..HEAD -- apps/desktop/src/routes/products/\$productId.tsx apps/desktop/src/components/settings-page.tsx apps/desktop/src/routes/products/index.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UX correctness)
- **Planned at**: commit `a98b4aa7`, 2026-07-15

## Why this matters

Several shipped controls do nothing when clicked: a **trash/delete button on
the product detail page** (a destructive affordance that silently no-ops), two
settings switches, up/down chevron buttons, and a "Download Products" menu
item. Users read these as broken. The delete button is the worst case — the
backing mutation (`window.offlineStore.deleteProduct`) already exists
end-to-end, so this plan implements it with a confirmation dialog, and removes
the other placeholders until they have real backing features.

## Current state

- `apps/desktop/src/routes/products/$productId.tsx:87-97` — three handler-less buttons:

```tsx
<PageAction>
  <Button variant="ghost" size="icon">
    <HugeiconsIcon icon={ChevronUp} />
  </Button>
  <Button variant="ghost" size="icon">
    <HugeiconsIcon icon={ChevronDown} />
  </Button>
  <Button variant="ghost" size="icon">
    <HugeiconsIcon icon={Trash2} />
  </Button>
</PageAction>
```

(The icons are imported from `@hugeicons/core-free-icons` under local aliases
near the top of the file — check the actual import names before editing.)

- The delete mutation already exists everywhere it needs to:
  - renderer API: `window.offlineStore.deleteProduct` (see
    `apps/desktop/electron/preload.ts:65`, typed by
    `packages/contracts/src/offline-store.api.ts`); input shape is `{ id: string }`.
  - main handler `store:products:delete` → `OfflineStore.deleteProduct`
    (`apps/desktop/electron/main.ts:116-122`), which fails with
    `ProductNotFoundError` if missing.
- `apps/desktop/src/components/settings-page.tsx:105-132` — the whole
  "Application" card contains only two `<Switch>`es ("Desktop notifications",
  "Launch on startup") with **no `checked`, no `onCheckedChange`, no state**,
  and the page description even says "This route is ready for your persistent
  Electron settings."
- `apps/desktop/src/routes/products/index.tsx:59-62` — dead menu item:

```tsx
<DropdownMenuItem>
  <HugeiconsIcon icon={Download01Icon} />
  Download Products
</DropdownMenuItem>
```

- Confirmation dialog primitive available: `apps/desktop/src/components/ui/alert-dialog.tsx` (shadcn). Toasts via `sonner`'s `toast` (used across routes). Router: TanStack Router — this route already uses `Route.useLoaderData()`; navigation pattern to copy exists in `apps/desktop/src/components/invoices/invoice-create-context.tsx:213` (`useNavigate` + `router.invalidate()` is used in `apps/desktop/src/routes/products/upload.tsx:262`).
- Repo UI conventions: Tailwind v4, max font-weight 500 (AGENTS.md), icons without `strokeWidth` prop.

## Commands you will need

| Purpose   | Command                | Expected on success |
| --------- | ---------------------- | ------------------- |
| Install   | `vp install`           | exit 0              |
| Check all | `vp check` (repo root) | exit 0              |
| Tests     | `vp test` (repo root)  | all pass            |
| Run app   | `vp run dev` (root)    | desktop app boots   |

## Scope

**In scope** (the only files you should modify):

- `apps/desktop/src/routes/products/$productId.tsx`
- `apps/desktop/src/components/settings-page.tsx`
- `apps/desktop/src/routes/products/index.tsx`

**Out of scope** (do NOT touch):

- Implementing notifications / launch-on-startup / product export — those are
  features, not this fix. Removal only.
- `packages/persistence/**`, `apps/desktop/electron/**` — the delete mutation
  already exists; no backend change.
- Reordering products (the chevrons' presumed intent) — no ordering model
  exists in the schema; remove the buttons.

## Git workflow

- Branch: `advisor/005-remove-or-wire-dead-ui-controls`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Product detail — implement delete, remove chevrons

In `routes/products/$productId.tsx`:

1. Remove the ChevronUp and ChevronDown buttons (and their icon imports if now
   unused).
2. Replace the bare trash button with an `AlertDialog` flow (import from
   `@/components/ui/alert-dialog`, follow that file's exported parts):
   trigger = the existing ghost icon button (add `aria-label="Delete product"`);
   content = title "Delete product?", description naming `product.name` and
   stating stock/batches for it will no longer appear; destructive action
   button "Delete".
3. On confirm:

```ts
const navigate = useNavigate();
const router = useRouter();
const deleteProduct = async () => {
  try {
    await window.offlineStore.deleteProduct({ id: product.id });
    toast.success(`${product.name} deleted`);
    await navigate({ to: "/products" });
    await router.invalidate();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not delete the product.");
  }
};
```

Match surrounding import style (`@tanstack/react-router` hooks are already in
use in sibling routes; `toast` from `sonner`).

**Verify**: `vp check` → exit 0.

### Step 2: Settings — remove the placeholder Application card

In `components/settings-page.tsx`, delete the entire second `<Card>` (the
"Application" card, lines ~105–132) including its two `<Switch>` labels and
now-unused imports (`Switch`, possibly `Separator` if unused after removal —
keep `Separator` if still used inside the Organization card).

**Verify**: `vp check` → exit 0; `grep -n "Switch" apps/desktop/src/components/settings-page.tsx` → no matches.

### Step 3: Products list — remove "Download Products"

In `routes/products/index.tsx`, delete the handler-less `DropdownMenuItem`
(and the `Download01Icon` import if now unused). Keep the "Upload Invoices"
item — it has a real `render={<Link …/>}`.

**Verify**: `vp check` → exit 0.

### Step 4: Manual smoke test

`vp run dev`: open a product detail page → delete flow shows the dialog,
cancel works, confirm deletes and lands on `/products` with the product gone
from the table. Settings page renders without the Application card.

**Verify**: behaviors above observed; no console errors.

## Test plan

No component test harness exists in `apps/desktop` (no `*.test.tsx` — verify
with `find apps/desktop/src -name "*.test.*"`); verification is `vp check` +
the Step 4 manual smoke test. Do not introduce a new test framework in this
plan.

## Done criteria

- [ ] `vp check` exits 0; `vp test` exits 0
- [ ] `$productId.tsx` has no button without a handler; delete flow uses `AlertDialog` + `window.offlineStore.deleteProduct`
- [ ] `settings-page.tsx` contains no `<Switch>`
- [ ] `products/index.tsx` contains no "Download Products" item
- [ ] Manual smoke test performed (note results in the status row / commit message)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `window.offlineStore.deleteProduct` rejects on a product that has invoices
  referencing it and the error message is unhelpful — implement nothing extra;
  report the observed message so a follow-up can decide on cascade semantics.
- The chevron buttons turn out to have an intended, partially-built feature
  behind them (search the repo for product ordering before deleting — if you
  find one, STOP and ask).
- The AlertDialog primitive's API doesn't match shadcn conventions — read
  `ui/alert-dialog.tsx` and any existing usage (`grep -rn "AlertDialog" apps/desktop/src --include="*.tsx"`) before wiring it.

## Maintenance notes

- When real desktop settings land (notifications, launch-on-startup), they
  need main-process persistence (e.g. the `conf` package already used in
  `packages/auth`) plus IPC — re-add the card then, wired.
- "Download Products" (CSV export) is a plausible small feature: the data is
  already in the loader; a follow-up plan could serialize `products` to CSV
  client-side. Deliberately deferred.
- Reviewers: check the delete dialog copy against how the org handles
  soft-vs-hard delete in `packages/persistence/src/product-store.ts`
  (`deleteProduct`) — the toast wording should not promise more than the
  mutation does.
