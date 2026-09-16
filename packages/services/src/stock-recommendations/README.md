# Stock recommendations

`StockRecommendationService.analyze` accepts one organization's decoded catalog, undeleted invoices,
and planning policy. It returns an explainable report from those inputs. It does not place orders.
The web and Electron dashboard call this shared Effect service through the catalog-owned runtime.

## Effect implementation

The implementation follows the repository's [Effect skill](../../../../../.agents/skills/effect/SKILL.md)
and the installed `effect@4.0.0-rc.111` source. `Context.Service` has an explicit layer. The named
`Effect.fn` operation decodes policy with `Schema.decodeUnknownEffect`, rejects invalid stock and
mixed organization inputs with `Schema.TaggedError`, and reads time with `Clock.currentTimeMillis`.
Deterministic demand and stock arithmetic stays in pure functions inside the service module.

The catalog owns one `ManagedRuntime`, reused for each calculation and disposed when the catalog
closes. React aborts superseded requests and only renders a result whose input references match the
current products, invoices, policy, and catalog. Expected errors stay in `Result`; defects are reported.
Service tests use `@effect/vitest` and `TestClock`.

## Demand and evidence

- Sum invoice items' saved `baseUnitQuantity`, so later pack-size edits do not rewrite historical sales.
- Keep up to 90 trailing 24-hour buckets. Ignore future invoices and invoices at or before the window.
- With 44 days of product age, compare 7-day and 30-day moving averages on 14 held-out days. Each
  held-out prediction uses only earlier buckets. Select the smaller mean absolute error; ties use 30 days.
- With less history, use the 30-day mean divided by the product's observed days, capped at 30.
- Show the chosen average and its daily held-out error. This error is not a confidence interval or an
  estimate of accuracy over the longer purchasing horizon.
- Require 14 days of product age and sales on 5 distinct UTC days in the last 30 days before suggesting
  a quantity. These are explicit evidence cutoffs, not statistically calibrated confidence levels.
- Compare the last 7 days' daily sales with the preceding 23 days. A 25% change marks rising or falling
  sales; insufficient comparison history produces no trend label.

The model comparison follows [rolling-origin time-series cross-validation](https://otexts.com/fpp3/tscv.html).
The two candidate averages, validation length, and evidence cutoffs are application policy choices.

## Purchasing rules

Use unexpired batch stock in base units. Allocate predicted consumption to the earliest expiry first.
Subtract units expected to expire unsold within the planning horizon from stock coverage. Report both
already-expired units and projected expiry losses so the buyer can review batches.

- Reorder point: `max(minimum units, ceil(daily demand * (delivery days + safety days)))`.
- Target stock: `max(minimum units, ceil(daily demand * (delivery days + coverage days + safety days)))`.
- Suggested buy: target minus usable stock, only when at/below the reorder point, demand is positive,
  and the evidence requirement is met. Round up to whole packs for pack-tracking categories.
- No unexpired stock means out of stock. Low stock includes forecast expiry loss and demand, so a
  product can need replenishment even above the fixed minimum.
- Stock with no sales in 30 days, or over 90 days of estimated coverage, is flagged as slow moving.
- Sort out-of-stock products first, then low stock, prioritizing actionable buys and shorter coverage.
- Estimated cost uses the recorded purchase price. Missing prices remain unknown.

Delivery, safety, coverage, and minimum-stock values are editable assumptions for the current visit.
The CSV exports all suggested buys, regardless of the active view or pagination, and escapes cells
that spreadsheet applications might interpret as formulas.

## Data limits

The report reflects the local catalog replica, including local sales. No-sales periods count as zero
observed sales; the model cannot recover demand lost during stockouts or distinguish missing history
from genuine inactivity. It does not model seasonality, promotions, supplier delivery performance,
minimum supplier orders, or outstanding purchase orders. Product age is an observation proxy, not
proof of complete history. Buyers should review the report against existing supplier orders before
purchasing. None of these missing facts is inferred or presented as known.
