import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const published = sqliteTable(
  "published",
  {
    id: integer({ mode: "number" }).primaryKey(),
    runId: integer({ mode: "number" }).notNull(),
    revision: integer({ mode: "number" }).notNull(),
    kind: text().notNull(),
    completedAt: integer({ mode: "number" }).notNull(),
    generatedAt: integer({ mode: "number" }).notNull(),
    sourceGeneration: text().notNull(),
    sourceVersion: integer({ mode: "number" }).notNull(),
    policyVersion: text().notNull(),
    algorithmVersion: integer({ mode: "number" }).notNull(),
    today: integer({ mode: "number" }).notNull(),
    utcOffsetMinutes: integer({ mode: "number" }).notNull(),
    productCount: integer({ mode: "number" }).notNull(),
    summaryJson: text().notNull(),
  },
  (table) => [check("published_singleton", sql`${table.id} = 1`)],
);

export const runSequence = sqliteTable("run_sequence", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
});

export const productInsight = sqliteTable(
  "product_insight",
  {
    runId: integer({ mode: "number" }).notNull(),
    productId: text().notNull(),
    name: text().notNull(),
    nameKey: text().notNull(),
    status: text().notNull(),
    abc: text().notNull(),
    priority: real().notNull(),
    hasOrder: integer({ mode: "number" }).notNull(),
    revenue90d: real().notNull(),
    unitCost: real(),
    trend: text().notNull(),
    periodRevenue7: real().notNull(),
    periodUnits7: real().notNull(),
    periodRevenue30: real().notNull(),
    periodUnits30: real().notNull(),
    periodRevenue90: real().notNull(),
    periodUnits90: real().notNull(),
    valueAtCost: integer({ mode: "number" }).notNull(),
    valueAtRetail: integer({ mode: "number" }).notNull(),
    deadStockValue: integer({ mode: "number" }).notNull(),
    expiryRiskValue: integer({ mode: "number" }).notNull(),
    expiredValue: integer({ mode: "number" }).notNull(),
    reorderCost: integer({ mode: "number" }).notNull(),
    missingCost: integer({ mode: "number" }).notNull(),
    insightJson: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.productId] }),
    index("product_insight_restock_idx").on(
      table.runId,
      sql`${table.priority} DESC`,
      table.nameKey,
      table.productId,
      table.status,
      table.hasOrder,
    ),
  ],
);

export const insightAlert = sqliteTable(
  "insight_alert",
  {
    runId: integer({ mode: "number" }).notNull(),
    productId: text().notNull(),
    kind: text().notNull(),
    severityRank: integer({ mode: "number" }).notNull(),
    impact: real().notNull(),
    alertJson: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.productId, table.kind] }),
    index("insight_alert_rank_idx").on(table.runId, table.severityRank, sql`${table.impact} DESC`),
  ],
);

export const expiringBatch = sqliteTable(
  "expiring_batch",
  {
    runId: integer({ mode: "number" }).notNull(),
    productId: text().notNull(),
    seq: integer({ mode: "number" }).notNull(),
    expiresAt: integer({ mode: "number" }).notNull(),
    batchJson: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.productId, table.seq] }),
    index("expiring_batch_expiry_idx").on(table.runId, table.expiresAt, table.productId, table.seq),
  ],
);

export const workSales = sqliteTable(
  "work_sales",
  {
    runId: integer({ mode: "number" }).notNull(),
    productId: text().notNull(),
    day: integer({ mode: "number" }).notNull(),
    units: real().notNull(),
    revenue: real().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.productId, table.day] })],
);

export const workProduct = sqliteTable(
  "work_product",
  {
    runId: integer({ mode: "number" }).notNull(),
    productId: text().notNull(),
    stagedJson: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.productId] })],
);
