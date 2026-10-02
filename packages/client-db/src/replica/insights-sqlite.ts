import {
  MAX_INSIGHTS_BATCHES,
  MAX_INSIGHTS_ON_ORDER,
  MAX_INSIGHTS_PRODUCTS,
  MAX_INSIGHTS_SALES,
  type ReplicaInsightsFacts,
  type ReplicaInsightsWindow,
} from "@store/contracts";
import type { SqliteReplicaHandle } from "@store/sync/sql-client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BatchFactRow,
  batchFacts,
  currentOrganization,
  DayFactRow,
  HourFactRow,
  invoiceDays,
  invoiceHours,
  OnOrderFactRow,
  onOrderFacts,
  productDaySales,
  ProductFactRow,
  productFacts,
  SaleFactRow,
  toProductFact,
  type InvoiceWindow,
} from "./replica-queries";

const decodeRows = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  rows: ReadonlyArray<unknown>,
) => Schema.decodeUnknownEffect(Schema.Array(schema))(rows);

export const readSqliteInsightsFacts = Effect.fn("ReplicaNodeSqlite.readInsightsFacts")(function* (
  handle: SqliteReplicaHandle,
  window: ReplicaInsightsWindow,
) {
  const { db } = handle;
  const scope: InvoiceWindow = {
    organization: currentOrganization,
    offset: window.utcOffsetMinutes * 60_000,
    since: window.since,
    until: window.until,
  };
  const productRows = yield* db.all(productFacts().limit(MAX_INSIGHTS_PRODUCTS + 1));
  const batchRows = yield* db.all(batchFacts().limit(MAX_INSIGHTS_BATCHES + 1));
  const saleRows = yield* db.all(
    productDaySales({ ...scope, visibleOnly: false }).limit(MAX_INSIGHTS_SALES + 1),
  );
  const onOrderRows = yield* db.all(
    onOrderFacts({ organization: currentOrganization }).limit(MAX_INSIGHTS_ON_ORDER + 1),
  );
  const dayRows = yield* db.all(invoiceDays(scope));
  const hourRows = yield* db.all(invoiceHours(scope));
  const products = yield* decodeRows(ProductFactRow, productRows.slice(0, MAX_INSIGHTS_PRODUCTS));
  const batches = yield* decodeRows(BatchFactRow, batchRows.slice(0, MAX_INSIGHTS_BATCHES));
  const sales = yield* decodeRows(SaleFactRow, saleRows.slice(0, MAX_INSIGHTS_SALES));
  const onOrder = yield* decodeRows(OnOrderFactRow, onOrderRows.slice(0, MAX_INSIGHTS_ON_ORDER));
  const days = yield* decodeRows(DayFactRow, dayRows);
  const hours = yield* decodeRows(HourFactRow, hourRows);
  const facts: ReplicaInsightsFacts = {
    window,
    products: products.map(toProductFact),
    batches,
    sales,
    onOrder,
    days,
    hours,
    truncated:
      productRows.length > MAX_INSIGHTS_PRODUCTS ||
      batchRows.length > MAX_INSIGHTS_BATCHES ||
      saleRows.length > MAX_INSIGHTS_SALES ||
      onOrderRows.length > MAX_INSIGHTS_ON_ORDER,
  };
  return facts;
});
