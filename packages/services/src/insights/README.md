# Inventory insights

`analyzeInsights(facts, policy, now)` turns one replica's aggregated facts into a
prioritized report: per-product stock plans, ranked alerts, sales periods, and
inventory value.

## Inputs

The replica does the heavy lifting. `ReplicaHandle.readInsights(window)` returns
`ReplicaInsightsFacts` (`@store/contracts/sync/replica-insights`): compact product
and stocked-batch facts plus sales already grouped by product and local day, and
invoice totals by day and hour. SQLite aggregates with `GROUP BY` in the replica
worker; IndexedDB walks the `byCreatedAt` index once. Every list has a hard cap
and the read reports `truncated` instead of growing without bound. The window is
180 local days so the 90-day period has a comparable previous period.

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
- Orders are suggested only for products with demand, rounded up to whole packs
  for pack-tracking categories, costed from the purchase price.

## Limits

Zero-sale days while out of stock count as no demand, so a long stockout biases
the forecast down. There is no seasonality, supplier minimum, or open purchase
order model. Missing purchase prices leave products out of margin and value
totals, and the report says how many.
