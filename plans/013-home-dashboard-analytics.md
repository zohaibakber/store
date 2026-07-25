# Plan 013: Replace the homepage with an analytics dashboard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Skills (mandatory)**:
>
> - `effect-ts` — all code in `packages/*` follows the repo's Effect
>   patterns; read the existing stores before writing the analytics store.
> - `dataviz` — read it BEFORE writing any chart/stat-tile code.
> - `coss` / `coss-particles` — for all renderer components (this plan
>   assumes plan 012 landed; if it hasn't, build with the current shadcn
>   components instead — the data layer is identical either way).
>
> **Drift check (run first)**:
> `git diff --stat 39de419d..HEAD -- packages/contracts/src packages/persistence/src apps/desktop/electron apps/desktop/src/components/home-page.tsx`
> If the IPC surface changed since this plan was written, re-verify the
> "Current state" excerpts before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MEDIUM (new read-only IPC method + new UI; no mutations)
- **Depends on**: 012 (visual layer only — can run before it using current components)
- **Category**: feature
- **Planned at**: commit `39de419d`, 2026-07-24

## Why this matters

The current homepage (`apps/desktop/src/components/home-page.tsx`, 144 lines)
shows only a sync-status card and a "Open products" link — no information a
store operator actually needs at a glance. The local PGlite database already
holds everything for a useful dashboard: invoices (revenue), invoice items
(top sellers), batches (stock levels + expiry — this is a pharmacy-style FEFO
inventory, so expiring stock is a first-class concern).

## Current state

- **Schema** (`packages/db/src/shared/store.schema.ts`): `products` (name,
  categoryId, unitsPerPack, packPrice, unitPrice, visible), `batches`
  (productId, batchNumber, expiresAt epoch-ms nullable, packQuantity,
  unitQuantity), `invoices` (invoiceNumber, customerName, total int,
  createdAt), `invoiceItems` (invoiceId, productId, productName, quantity,
  quantityType, baseUnitQuantity, salePrice). Money is integer paisa;
  `lib/format.ts` formats with `Intl.NumberFormat("en-PK", { currency: "PKR" })`
  — reuse it, never hand-roll currency formatting.
- **IPC pattern** (add one method end-to-end by copying this chain):
  1. `packages/contracts/src/store.schema.ts` — Effect Schema for the payload.
  2. `packages/contracts/src/offline-store.api.ts` — method on
     `OfflineStoreApi` (line ~19).
  3. `packages/persistence/src/invoice-store.ts` — store implementation
     pattern: `Effect.suspend`, `mutationContext()` for `organizationId`
     scoping, drizzle query, `mapPersistenceError("...")`. Soft-delete filter
     `deletedAt: { isNull: true }` is required on every table.
  4. `packages/persistence/src/service.ts` — wires stores into the service.
  5. `apps/desktop/electron/main.ts:168-244` —
     `ipcMain.handle("store:<domain>:<action>", () => runStore(withStore(...)))`.
  6. `apps/desktop/electron/preload.ts` — expose on `window.offlineStore`.
  7. Plans 003 and 009 are DONE: typed store errors and boundary decoding
     are live — the new method must decode its response and surface typed
     errors exactly like the existing `store:*` methods do.
- **Homepage**: `routes/index.tsx` → `components/home-page.tsx`; uses
  `PageLayout/PageHeader/PageContent` from `components/page-layout.tsx`;
  polls `window.offlineStore.getSyncStatus()` and listens for the
  `offline-store:sync` window event.
- **Charts**: `components/ui/chart.tsx` (shadcn recharts wrapper) exists but
  is unused by any page today; `recharts` is installed; `--chart-1..5`
  tokens are defined in `styles.css`.

## Design

### New IPC method: `getDashboardAnalytics`

One method, one round-trip. Contract shape (Effect Schema in
`store.schema.ts`, named `DashboardAnalytics`):

```ts
{
  totals: {
    revenueToday: number;
    revenue7d: number;
    revenue30d: number;
    invoicesToday: number;
    invoices30d: number;
    averageInvoice30d: number; // 0 when no invoices
    activeProducts: number; // visible, not deleted
  }
  revenueByDay: Array<{ date: string; revenue: number; invoices: number }>;
  // last 30 days, YYYY-MM-DD, zero-filled
  topProducts: Array<{
    productId: string;
    productName: string;
    unitsSold: number;
    revenue: number;
  }>; // top 5, 30d
  expiringBatches: Array<{
    productId: string;
    productName: string;
    batchNumber: string | null;
    expiresAt: number;
    packQuantity: number;
    unitQuantity: number;
  }>;
  // expiresAt within next 90 days, soonest first, max 8
  lowStock: Array<{
    productId: string;
    productName: string;
    packQuantity: number;
    unitQuantity: number;
  }>;
  // total units (pack*unitsPerPack+unit) <= threshold 10,
  // visible products only, max 8
  recentInvoices: Array<{
    id: string;
    invoiceNumber: number;
    customerName: string | null;
    total: number;
    createdAt: number;
  }>; // latest 5
}
```

Implementation notes:

- New file `packages/persistence/src/analytics-store.ts` mirroring
  `invoice-store.ts` structure; register in `service.ts`.
- Use drizzle aggregations (`sum`, `count`, `sql` date_trunc on createdAt)
  rather than loading all rows into JS. `createdAt` is epoch ms — bucket in
  SQL with `to_timestamp(created_at / 1000)::date` (verify the timestamps
  helper's actual column type in `store.schema.ts` before writing SQL).
- Zero-fill `revenueByDay` in TypeScript after the query (SQL gap-filling is
  not worth it in PGlite).
- All queries organization-scoped via `mutationContext()` and soft-delete
  filtered, exactly like `listInvoices`.
- IPC channel name: `store:analytics:dashboard`.

### Homepage layout (top to bottom)

Read the `dataviz` skill before building any of this. Compose from coss
primitives (Card/Frame, Badge, Table, Empty, Skeleton, Separator) and the
existing `chart.tsx` recharts wrapper with `--chart-*` tokens.

1. **Header row** — `PageHeading` "Dashboard" + compact sync-status badge
   (fold the current sync card into a small badge/inline strip with
   last-synced tooltip; keep the existing `offline-store:sync` event listener
   and error alert behavior).
2. **Stat tiles** (4-up grid, collapses to 2-up when narrow): Revenue today,
   Revenue 30 days, Invoices 30 days (with avg invoice as the secondary
   line), Active products. PKR-formatted via `lib/format.ts`.
3. **Revenue chart** (full width) — area chart of `revenueByDay`, 30 days,
   single series, `--chart-1`; tooltip shows date + revenue + invoice count.
   Zero-revenue days render as 0, not gaps.
4. **Two-column row**:
   - **Top products (30d)** — horizontal bar chart, top 5 by revenue, value
     labels formatted PKR.
   - **Recent invoices** — compact table (invoice #, customer, total,
     relative time), each row links to the invoice; "View all →" to
     `/invoices`.
5. **Two-column row (inventory health)**:
   - **Expiring soon** — list with product name, batch number, quantity, and
     a Badge colored by urgency (<30d destructive, <90d warning). Links to
     the product. Empty state: "No batches expiring in the next 90 days."
   - **Low stock** — list with product name + remaining units, link to
     product. Empty state via `Empty` component.
6. Every section handles the loading state (Skeleton) and the
   fresh-database state (Empty components with links to create products /
   invoices) — a brand-new install must look intentional, not broken.

Data fetching: one `getDashboardAnalytics()` call on mount + re-fetch on the
`offline-store:sync` event (same pattern as the current `refresh`). Keep the
error alert path. Split the page into small components under
`components/dashboard/` (e.g. `stat-tiles.tsx`, `revenue-chart.tsx`,
`top-products.tsx`, `inventory-health.tsx`, `recent-invoices.tsx`) with
`home-page.tsx` as the composition root — match the composition conventions
in `components/invoices/`.

## Steps

1. Contracts: add `DashboardAnalytics` schema + `getDashboardAnalytics` to
   `OfflineStoreApi`. `vp check` in `packages/contracts`.
2. Persistence: `analytics-store.ts` + `service.ts` wiring. Add
   `analytics-store.test.ts` following `product-store.test.ts` /
   `test-support.ts` patterns: seed products/batches/invoices across dates,
   assert totals, bucketing (incl. zero-fill boundary), top-products
   ordering, expiring window edges (null expiresAt excluded; day 90
   inclusive/exclusive — pick one and test it), low-stock threshold, and
   org isolation (second org's data invisible).
3. Electron: `main.ts` handler + `preload.ts` exposure (+ boundary decode if
   plan 009's pattern is in place).
4. Renderer: build `components/dashboard/*` and rewrite `home-page.tsx`.
5. Verify: `vp check` clean; `vp test` — baseline plus the new analytics
   tests, all passing. Run the app: fresh/empty database shows empty states;
   after creating a product, batch (one expiring soon), and an invoice, every
   tile/chart/list reflects it; sync event refreshes the dashboard; dark mode
   charts legible.

## STOP conditions

- The IPC boundary pattern in `main.ts`/`preload.ts` has materially changed
  from the excerpts above (e.g. plan 003/009 landed a different error/decode
  contract) — reconcile with the live pattern first; if ambiguous, stop.
- PGlite rejects the SQL date bucketing approach and no drizzle-compatible
  alternative works — report rather than falling back to loading all
  invoices into JS silently.
- Any existing test regresses.

## Out of scope

- Date-range pickers / configurable periods (fixed today/7d/30d/90d windows).
- Stock-movement or category analytics (future iteration).
- Server-side (remote) analytics — everything reads the local database.
- Configurable low-stock threshold (hardcode 10; note it as a constant).
