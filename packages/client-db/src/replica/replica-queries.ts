import {
  INSIGHTS_DAY_MILLIS,
  INSIGHTS_HOUR_MILLIS,
  INSIGHTS_ON_ORDER_STATUSES,
} from "@store/contracts";
import {
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  replicaState,
} from "@store/db/replica.schema";
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
  sum,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { QueryBuilder, type SQLiteColumn } from "drizzle-orm/sqlite-core";

import { visibleBatches } from "./compile";

export const replicaQueryBuilder = new QueryBuilder();

type Bound = number | SQLWrapper;

const singleton = eq(replicaState.id, "singleton");

export const replicaStampQuery = replicaQueryBuilder
  .select({
    organizationId: replicaState.organizationId,
    generation: replicaState.activeGeneration.as("generation"),
    version: replicaState.localCommitVersion.as("version"),
  })
  .from(replicaState)
  .where(singleton);

export const currentOrganization = replicaQueryBuilder
  .select({ organizationId: replicaState.organizationId })
  .from(replicaState)
  .where(singleton);

export const inJsonList = (column: SQLiteColumn, list: SQLWrapper) =>
  sql`${column} IN (SELECT value FROM json_each(${list}))`;

type FactScope = {
  readonly organization?: SQLWrapper;
  readonly where?: SQL;
};

export const productFacts = ({
  organization,
  visibleOnly = false,
  where,
}: FactScope & { readonly visibleOnly?: boolean } = {}) =>
  replicaQueryBuilder
    .select({
      id: products.id.as("id"),
      name: products.name.as("name"),
      categoryId: products.categoryId.as("categoryId"),
      categoryName: categories.name.as("categoryName"),
      tracksPacks: sql<number>`coalesce(${categories.tracksPacks}, 1)`.as("tracksPacks"),
      unitsPerPack: sql<number>`max(${products.unitsPerPack}, 1)`.as("unitsPerPack"),
      purchasePrice: products.purchasePrice.as("purchasePrice"),
      retailPrice: products.retailPrice.as("retailPrice"),
      unitPrice: products.unitPrice.as("unitPrice"),
      visible: products.visible.as("visible"),
      createdAt: products.createdAt.as("createdAt"),
    })
    .from(products)
    .leftJoin(
      categories,
      and(
        organization === undefined
          ? undefined
          : eq(categories.organizationId, products.organizationId),
        eq(categories.id, products.categoryId),
      ),
    )
    .where(
      and(
        organization === undefined ? undefined : eq(products.organizationId, organization),
        visibleOnly ? eq(products.visible, true) : undefined,
        where,
      ),
    )
    .orderBy(products.id);

export const batchFacts = ({ organization, where }: FactScope = {}) =>
  replicaQueryBuilder
    .with(visibleBatches)
    .select({
      productId: visibleBatches.productId,
      batchNumber: visibleBatches.batchNumber,
      packQuantity: visibleBatches.packQuantity,
      unitQuantity: visibleBatches.unitQuantity,
      expiresAt: visibleBatches.expiresAt,
    })
    .from(visibleBatches)
    .where(
      and(
        organization === undefined ? undefined : eq(visibleBatches.organizationId, organization),
        where,
        or(ne(visibleBatches.packQuantity, 0), ne(visibleBatches.unitQuantity, 0)),
      ),
    )
    .orderBy(visibleBatches.productId, visibleBatches.expiresAt);

export const onOrderFacts = ({ organization, where }: FactScope = {}) =>
  replicaQueryBuilder
    .select({
      productId: purchaseOrderItems.productId,
      units:
        sql<number>`sum(${purchaseOrderItems.baseUnitQuantity} - ${purchaseOrderItems.receivedBaseUnits})`.as(
          "units",
        ),
    })
    .from(purchaseOrders)
    .crossJoin(purchaseOrderItems)
    .where(
      and(
        organization === undefined ? undefined : eq(purchaseOrders.organizationId, organization),
        inArray(purchaseOrders.status, INSIGHTS_ON_ORDER_STATUSES),
        eq(purchaseOrderItems.organizationId, purchaseOrders.organizationId),
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id),
        gt(purchaseOrderItems.baseUnitQuantity, purchaseOrderItems.receivedBaseUnits),
        where,
      ),
    )
    .groupBy(purchaseOrderItems.productId)
    .orderBy(purchaseOrderItems.productId);

export type InvoiceWindow = {
  readonly organization: SQLWrapper;
  readonly offset: Bound;
  readonly since: Bound;
  readonly until: Bound;
};

const localTime = (offset: Bound) => sql`(${invoices.createdAt} + cast(${offset} as integer))`;

const dayBucket = (offset: Bound) =>
  sql<number>`${localTime(offset)} / ${sql.raw(String(INSIGHTS_DAY_MILLIS))}`.as("day");

const windowed = (window: InvoiceWindow) => [
  eq(invoices.organizationId, window.organization),
  gte(invoices.createdAt, window.since),
  lt(invoices.createdAt, window.until),
];

const invoiceRevenue = sql<number>`coalesce(sum(${invoices.total}), 0)`.as("revenue");

export const invoiceDays = (window: InvoiceWindow) => {
  const day = dayBucket(window.offset);
  return replicaQueryBuilder
    .select({ day, invoices: count().as("invoices"), revenue: invoiceRevenue })
    .from(invoices)
    .where(and(...windowed(window)))
    .groupBy(day)
    .orderBy(day);
};

export const invoiceHours = (window: InvoiceWindow) => {
  const hour =
    sql<number>`(${localTime(window.offset)} % ${sql.raw(String(INSIGHTS_DAY_MILLIS))}) / ${sql.raw(String(INSIGHTS_HOUR_MILLIS))}`.as(
      "hour",
    );
  return replicaQueryBuilder
    .select({ hour, invoices: count().as("invoices"), revenue: invoiceRevenue })
    .from(invoices)
    .where(and(...windowed(window)))
    .groupBy(hour)
    .orderBy(hour);
};

export const productDaySales = (
  window: InvoiceWindow & { readonly visibleOnly: boolean; readonly where?: SQL },
) => {
  const day = dayBucket(window.offset);
  const lines = replicaQueryBuilder
    .select({
      productId: invoiceItems.productId,
      day,
      units: sum(invoiceItems.baseUnitQuantity).as("units"),
      revenue:
        sql<number>`coalesce(sum(${invoiceItems.quantity} * ${invoiceItems.salePrice}), 0)`.as(
          "revenue",
        ),
    })
    .from(invoices)
    .crossJoin(invoiceItems)
    .$dynamic();
  const joined = window.visibleOnly ? lines.crossJoin(products) : lines;
  return joined
    .where(
      and(
        eq(invoiceItems.organizationId, invoices.organizationId),
        eq(invoiceItems.invoiceId, invoices.id),
        ...(window.visibleOnly
          ? [
              eq(products.organizationId, invoiceItems.organizationId),
              eq(products.id, invoiceItems.productId),
              eq(products.visible, true),
            ]
          : []),
        ...windowed(window),
        window.where,
      ),
    )
    .groupBy(invoiceItems.productId, day);
};
