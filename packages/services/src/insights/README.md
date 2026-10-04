# Inventory insights

`analyzeInsights(facts, policy, now)` turns one replica's aggregated facts into a
prioritized report: per-product stock plans, ranked alerts, sales periods, and
inventory value.

## Inputs

The replica does the heavy lifting. `ReplicaHandle.readInsights(window)` returns
`ReplicaInsightsFacts` (`@store/contracts/sync/replica-insights`): compact product
and stocked-batch facts plus sales already grouped by product and local day,
units on order grouped by product, and invoice totals by day and hour. SQLite
aggregates with `GROUP BY` in the replica worker. Every list has a hard cap and the read reports
`truncated` instead of growing without bound. The window is 180 local days so
the 90-day period has a comparable previous period.

## On order

`onOrder` holds, per product, the base units still to arrive on open purchase
orders: `purchaseOrderLineRemaining` summed over the lines of every order whose
status is in `INSIGHTS_ON_ORDER_STATUSES`. Products with nothing left to arrive
have no fact.

- Open means draft or sent (`isPurchaseOrderOpen`). A draft counts, so a product
  already put on an order is not suggested again while the order waits to be
  sent. Cancelling the draft or removing the line releases the units. This is
  the same number `useProductsOnOrder` shows.
- A line that received more than it ordered counts as zero, not negative.
- Both reads use that one definition. SQLite joins open orders to their lines in
  one grouped query (`onOrderFacts`), and the Electron analytics worker runs the
  same `onOrderFacts` against its read-only replica connection.

The analytics worker refreshes on `purchaseOrder` and `purchaseOrderItem`
commit notices. It does not resolve those keys to products, because a deleted
line or a line moved to another product no longer names the product it left.
Each incremental run instead compares the current facts with the
`onOrderUnits` stored for the published run and re-analyzes every product whose
number changed. A full run reads the facts once, at the stamp it settles on.

## Demand

Each visible product gets up to 90 complete local days of history, starting at
its creation day. Today is excluded because it is partial.

- Pattern: Syntetos–Boylan classification from ADI (average days between sales,
  cutoff 1.32) and CV² of non-zero sizes (cutoff 0.49). Fewer than three selling
  days is `sparse` and uses the plain average.
- Model: simple exponential smoothing for smooth and erratic demand; SBA
  (Croston with the `1 − α/2` bias correction) for intermittent and lumpy demand.
  The smoothing weight is picked by one-step-ahead mean absolute error.
- Deviation: RMSE of those one-step errors, floored at the Poisson `√rate`.
- Trend: last 14 days against up to 42 baseline days as two Poisson rates. A
  trend needs `|z| ≥ 2` and at least a 25% (rising) or 20% (falling) change.

## Stock plan

- Class: ABC by 90-day revenue (A until 80% cumulative, B until 95%). Service
  level is the policy target, +2 points for A and −5 for C.
- Safety stock `z·σ·√L`; reorder point `rate·L + SS`, never below the minimum
  unless usable stock already covers a full order cycle;
  order-up-to `rate·(L+R) + z·σ·√(L+R)` where `R` is the cover period.
- Expiry: sell first-expiry-first-out against the forecast. Units that cannot
  sell before their batch expires inside the horizon are at risk and do not
  count as usable stock.
- Status, in order: `out` (nothing sellable, and it sells), `critical` (cover
  shorter than lead time), `dead` (no sale for the dead-stock period), `low` (at
  or under the reorder point), `overstock`, `healthy`, `inactive`.
- Orders are suggested only for products with demand. The quantity is
  order-up-to minus usable stock minus `onOrderUnits`; nothing is suggested when
  that is zero or less. It is rounded up to whole packs for pack-tracking
  categories and costed from the purchase price.
- Units on order change the suggestion only. Status, days of cover and priority
  describe the shelf, so a product that is out stays `out` until the delivery is
  received. When the units on order cover the whole shortfall, its alert says
  how much is on order instead of asking for an order.

## Limits

Zero-sale days while out of stock count as no demand, so a long stockout biases
the forecast down. There is no seasonality or supplier minimum. Units on order
count in full whatever the order's expected date, so an order due after the
cover period still lowers the suggestion, and a draft nobody sends keeps doing
so until it is cancelled. Missing purchase prices leave products out of margin
and value totals, and the report says how many.
