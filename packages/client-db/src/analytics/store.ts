import type { SQLInputValue } from "node:sqlite";

import {
  AnalyticsRun,
  DemandForecast,
  InsightAlert,
  InsightsSummary,
  ExpiringBatch,
  ProductInsight,
  RESTOCK_VIEW_STATUSES,
  StockStatus,
  type InsightsBatchFact,
  type InsightsProductFact,
  type RestockCursor,
  type RestockFilters,
  type StockStatusCounts,
  type InsightsInventoryTotals,
} from "@store/contracts";
import {
  expiringBatch,
  insightAlert,
  productInsight,
  published,
  runSequence,
  workProduct,
  workSales,
} from "@store/db/analytics.schema";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  is,
  isNoop,
  lt,
  lte,
  ne,
  or,
  Param,
  Placeholder,
  sql,
  type Assume,
  type InferSelectModel,
  type Query,
  type SQL,
} from "drizzle-orm";
import type {
  SQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
  SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";

import type { AnalyticsDatabase } from "./database";

const SEVERITY_RANK = { critical: 0, warning: 1, positive: 2, info: 3 } as const;
const ALERT_TIE_CAP = 2_000;

const productJson = Schema.fromJsonString(ProductInsight);
const alertJson = Schema.fromJsonString(InsightAlert);
const batchJson = Schema.fromJsonString(ExpiringBatch);
const summaryJson = Schema.fromJsonString(InsightsSummary);
const encodeProduct = Schema.encodeSync(productJson);
const encodeAlert = Schema.encodeSync(alertJson);
const encodeBatch = Schema.encodeSync(batchJson);
const encodeSummary = Schema.encodeSync(summaryJson);
const decodeProduct = Schema.decodeUnknownSync(productJson);
const decodeAlert = Schema.decodeUnknownSync(alertJson);
const decodeBatch = Schema.decodeUnknownSync(batchJson);
const decodeSummary = Schema.decodeUnknownSync(summaryJson);
const decodeRun = Schema.decodeUnknownSync(AnalyticsRun);

const stagedJson = Schema.fromJsonString(
  Schema.Struct({
    product: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      categoryId: Schema.String,
      categoryName: Schema.NullOr(Schema.String),
      tracksPacks: Schema.Boolean,
      unitsPerPack: Schema.Number,
      purchasePrice: Schema.NullOr(Schema.Number),
      retailPrice: Schema.NullOr(Schema.Number),
      unitPrice: Schema.NullOr(Schema.Number),
      visible: Schema.Boolean,
      createdAt: Schema.Number,
    }),
    batches: Schema.Array(
      Schema.Struct({
        productId: Schema.String,
        batchNumber: Schema.NullOr(Schema.String),
        packQuantity: Schema.Number,
        unitQuantity: Schema.Number,
        expiresAt: Schema.NullOr(Schema.Number),
      }),
    ),
  }),
);
const encodeStaged = Schema.encodeSync(stagedJson);
const decodeStaged = Schema.decodeUnknownSync(stagedJson);

export type StagedProduct = {
  readonly product: InsightsProductFact;
  readonly batches: ReadonlyArray<InsightsBatchFact>;
};

type ProductContribution = {
  readonly valueAtCost: number;
  readonly valueAtRetail: number;
  readonly deadStockValue: number;
  readonly expiryRiskValue: number;
  readonly expiredValue: number;
  readonly reorderCost: number;
  readonly missingCostCount: number;
};

export type ProductAnalysis = {
  readonly insight: ProductInsight;
  readonly alerts: ReadonlyArray<InsightAlert>;
  readonly expiring: ReadonlyArray<ExpiringBatch>;
  readonly periodRevenue: readonly [number, number, number];
  readonly periodUnits: readonly [number, number, number];
  readonly contribution: ProductContribution;
};

type PeriodProductRow = {
  readonly productId: string;
  readonly name: string;
  readonly revenue: number;
  readonly units: number;
  readonly unitCost: number | null;
  readonly trend: ProductInsight["demand"]["trend"];
};

export type SummaryReader = {
  readonly runId: number;
  readonly productCount: () => number;
  readonly statusCounts: () => StockStatusCounts;
  readonly inventory: () => InsightsInventoryTotals;
  readonly alertCandidates: (limit: number) => ReadonlyArray<InsightAlert>;
  readonly attention: (limit: number) => {
    readonly rows: ReadonlyArray<ProductInsight>;
    readonly count: number;
  };
  readonly expiring: (limit: number) => {
    readonly rows: ReadonlyArray<ExpiringBatch>;
    readonly count: number;
  };
  readonly periodProducts: (slot: 0 | 1 | 2) => Iterable<PeriodProductRow>;
};

type PublishInput = {
  readonly runId: number;
  readonly kind: "full" | "incremental";
  readonly generatedAt: number;
  readonly completedAt: number;
  readonly sourceGeneration: string;
  readonly sourceVersion: number;
  readonly policyVersion: string;
  readonly algorithmVersion: number;
  readonly today: number;
  readonly utcOffsetMinutes: number;
  readonly replace?: {
    readonly productIds: ReadonlyArray<string>;
    readonly analyses: ReadonlyArray<ProductAnalysis>;
  };
  readonly summarize: (reader: SummaryReader, run: AnalyticsRun) => InsightsSummary;
};

type PublishedRun = {
  readonly run: AnalyticsRun;
  readonly summary: InsightsSummary;
};

type RestockPageQuery = {
  readonly filters: RestockFilters;
  readonly cursor: RestockCursor | null;
  readonly limit: number;
};

type RestockPageResult = {
  readonly run: AnalyticsRun;
  readonly rows: ReadonlyArray<ProductInsight>;
  readonly nextCursor: RestockCursor | null;
  readonly total: number | null;
  readonly cursorExpired: boolean;
};

export type SalesRow = {
  readonly productId: string;
  readonly day: number;
  readonly units: number;
  readonly revenue: number;
};

type RevenueEntry = { readonly id: string; readonly revenue: number };

type ClassifiedProduct = {
  readonly productId: string;
  readonly abc: string;
  readonly revenue90d: number;
};

const NO_INSIGHTS: ReadonlyArray<ProductInsight> = [];

const NO_INVENTORY: InsightsInventoryTotals = {
  valueAtCost: 0,
  valueAtRetail: 0,
  deadStockValue: 0,
  expiryRiskValue: 0,
  expiredValue: 0,
  reorderCost: 0,
  reorderCount: 0,
  missingCostCount: 0,
};

const PeriodProductRow = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  unitCost: Schema.NullOr(Schema.Number),
  trend: DemandForecast.fields.trend,
  revenue: Schema.Number,
  units: Schema.Number,
});
const decodePeriodProduct = Schema.decodeUnknownSync(PeriodProductRow);

const PERIOD_COLUMNS = [
  [productInsight.periodRevenue7, productInsight.periodUnits7],
  [productInsight.periodRevenue30, productInsight.periodUnits30],
  [productInsight.periodRevenue90, productInsight.periodUnits90],
] as const;

const escapeLike = (term: string) => term.replace(/[\\%_]/gu, (match) => `\\${match}`);

const isStockStatus = Schema.is(StockStatus);

const inJson = (column: SQLiteColumn, values: ReadonlyArray<string | number>) =>
  sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

const notInJson = (column: SQLiteColumn, values: ReadonlyArray<string | number>) =>
  sql`${column} NOT IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

const total = (column: SQLiteColumn) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

const placeholderKeys = (query: Query) =>
  query.params.map((param) => {
    if (
      is(param, Param) &&
      is(param.value, Placeholder) &&
      param.codec === undefined &&
      isNoop(param.encoder.mapToDriverValue) === true
    ) {
      return param.value.name;
    }
    throw new Error("Analytics upserts bind only placeholders of unencoded columns.");
  });

const upsert = <T extends SQLiteTable>(
  db: AnalyticsDatabase,
  table: T,
  target: ReadonlyArray<SQLiteColumn>,
) => {
  const columns = Object.entries(getTableColumns(table));
  const query = db.orm
    .insert(table)
    .values(
      // SAFETY: every column of the table is bound to the placeholder named after its key.
      Object.fromEntries(
        columns.map(([key]) => [key, sql.placeholder(key)]),
      ) as SQLiteInsertValue<T>,
    )
    .onConflictDoUpdate({
      target: [...target],
      // SAFETY: every non-key column of the table is set to its excluded value.
      set: Object.fromEntries(
        columns
          .filter(([, column]) => !target.includes(column))
          .map(([key, column]) => [key, sql`excluded.${sql.identifier(column.name)}`]),
      ) as SQLiteUpdateSetSource<Assume<T, SQLiteTable>>,
    })
    .toSQL();
  const statement = db.statement(query.sql);
  const keys = placeholderKeys(query);
  return (row: InferSelectModel<T>) => {
    const values: Record<string, SQLInputValue> = row;
    statement.run(...keys.map((key) => values[key] ?? null));
  };
};

export const makeAnalyticsStore = (db: AnalyticsDatabase) => {
  const { orm } = db;

  const publishedRunQuery = orm
    .select({
      runId: published.runId,
      revision: published.revision,
      kind: published.kind,
      completedAt: published.completedAt,
      generatedAt: published.generatedAt,
      sourceGeneration: published.sourceGeneration,
      sourceVersion: published.sourceVersion,
      policyVersion: published.policyVersion,
      algorithmVersion: published.algorithmVersion,
      today: published.today,
      utcOffsetMinutes: published.utcOffsetMinutes,
      productCount: published.productCount,
    })
    .from(published)
    .where(eq(published.id, 1))
    .prepare();

  const upsertInsight = upsert(db, productInsight, [
    productInsight.runId,
    productInsight.productId,
  ]);
  const upsertAlert = upsert(db, insightAlert, [
    insightAlert.runId,
    insightAlert.productId,
    insightAlert.kind,
  ]);
  const upsertBatch = upsert(db, expiringBatch, [
    expiringBatch.runId,
    expiringBatch.productId,
    expiringBatch.seq,
  ]);
  const upsertSales = upsert(db, workSales, [workSales.runId, workSales.productId, workSales.day]);
  const upsertStaged = upsert(db, workProduct, [workProduct.runId, workProduct.productId]);
  const upsertPublished = upsert(db, published, [published.id]);

  const publishedRun = (): AnalyticsRun | undefined => {
    const row = publishedRunQuery.get();
    return row === undefined ? undefined : decodeRun(row);
  };

  const countWhere = (table: SQLiteTable, where: SQL | undefined) =>
    orm.select({ n: count() }).from(table).where(where).get()?.n ?? 0;

  const summaryReader = (runId: number): SummaryReader => ({
    runId,
    productCount: () => countWhere(productInsight, eq(productInsight.runId, runId)),
    statusCounts: () => {
      const counts = {
        out: 0,
        critical: 0,
        low: 0,
        dead: 0,
        overstock: 0,
        healthy: 0,
        inactive: 0,
      } satisfies Record<StockStatus, number>;
      for (const row of orm
        .select({ status: productInsight.status, n: count() })
        .from(productInsight)
        .where(eq(productInsight.runId, runId))
        .groupBy(productInsight.status)
        .all()) {
        if (isStockStatus(row.status)) counts[row.status] = row.n;
      }
      return counts;
    },
    inventory: () =>
      orm
        .select({
          valueAtCost: total(productInsight.valueAtCost),
          valueAtRetail: total(productInsight.valueAtRetail),
          deadStockValue: total(productInsight.deadStockValue),
          expiryRiskValue: total(productInsight.expiryRiskValue),
          expiredValue: total(productInsight.expiredValue),
          reorderCost: total(productInsight.reorderCost),
          reorderCount: total(productInsight.hasOrder),
          missingCostCount: total(productInsight.missingCost),
        })
        .from(productInsight)
        .where(eq(productInsight.runId, runId))
        .get() ?? NO_INVENTORY,
    alertCandidates: (limit) => {
      const boundary = orm
        .select({ severityRank: insightAlert.severityRank, impact: insightAlert.impact })
        .from(insightAlert)
        .where(eq(insightAlert.runId, runId))
        .orderBy(insightAlert.severityRank, desc(insightAlert.impact))
        .limit(1)
        .offset(Math.max(0, limit - 1))
        .get();
      const ranked = orm
        .select({ alertJson: insightAlert.alertJson })
        .from(insightAlert)
        .$dynamic();
      const rows =
        boundary === undefined
          ? ranked
              .where(eq(insightAlert.runId, runId))
              .orderBy(insightAlert.severityRank, desc(insightAlert.impact))
              .all()
          : ranked
              .where(
                and(
                  eq(insightAlert.runId, runId),
                  or(
                    lt(insightAlert.severityRank, boundary.severityRank),
                    and(
                      eq(insightAlert.severityRank, boundary.severityRank),
                      gte(insightAlert.impact, boundary.impact),
                    ),
                  ),
                ),
              )
              .orderBy(insightAlert.severityRank, desc(insightAlert.impact))
              .limit(ALERT_TIE_CAP + limit)
              .all();
      return rows.map((row) => decodeAlert(row.alertJson));
    },
    attention: (limit) => {
      const filter = and(
        eq(productInsight.runId, runId),
        inArray(productInsight.status, RESTOCK_VIEW_STATUSES.action),
      );
      return {
        rows: orm
          .select({ insightJson: productInsight.insightJson })
          .from(productInsight)
          .where(filter)
          .orderBy(desc(productInsight.priority), productInsight.nameKey, productInsight.productId)
          .limit(limit)
          .all()
          .map((row) => decodeProduct(row.insightJson)),
        count: countWhere(productInsight, filter),
      };
    },
    expiring: (limit) => ({
      rows: orm
        .select({ batchJson: expiringBatch.batchJson })
        .from(expiringBatch)
        .where(eq(expiringBatch.runId, runId))
        .orderBy(expiringBatch.expiresAt, expiringBatch.productId, expiringBatch.seq)
        .limit(limit)
        .all()
        .map((row) => decodeBatch(row.batchJson)),
      count: countWhere(expiringBatch, eq(expiringBatch.runId, runId)),
    }),
    periodProducts: function* (slot) {
      const [revenue, units] = PERIOD_COLUMNS[slot];
      const query = orm
        .select({
          productId: productInsight.productId,
          name: productInsight.name,
          unitCost: productInsight.unitCost,
          trend: productInsight.trend,
          revenue: sql<number>`${revenue}`.as("revenue"),
          units: sql<number>`${units}`.as("units"),
        })
        .from(productInsight)
        .where(and(eq(productInsight.runId, runId), or(gt(revenue, 0), gt(units, 0))))
        .orderBy(productInsight.productId)
        .toSQL();
      for (const row of db.iterate(query)) yield decodePeriodProduct(row);
    },
  });

  const insertAnalysis = (runId: number, analysis: ProductAnalysis) => {
    const { insight, contribution } = analysis;
    upsertInsight({
      runId,
      productId: insight.productId,
      name: insight.name,
      nameKey: insight.name.toLowerCase(),
      status: insight.status,
      abc: insight.abc,
      priority: insight.priority,
      hasOrder: insight.order === null ? 0 : 1,
      revenue90d: insight.revenue90d,
      unitCost: insight.unitCost,
      trend: insight.demand.trend,
      periodRevenue7: analysis.periodRevenue[0],
      periodUnits7: analysis.periodUnits[0],
      periodRevenue30: analysis.periodRevenue[1],
      periodUnits30: analysis.periodUnits[1],
      periodRevenue90: analysis.periodRevenue[2],
      periodUnits90: analysis.periodUnits[2],
      valueAtCost: contribution.valueAtCost,
      valueAtRetail: contribution.valueAtRetail,
      deadStockValue: contribution.deadStockValue,
      expiryRiskValue: contribution.expiryRiskValue,
      expiredValue: contribution.expiredValue,
      reorderCost: contribution.reorderCost,
      missingCost: contribution.missingCostCount,
      insightJson: encodeProduct(insight),
    });
    for (const alert of analysis.alerts) {
      upsertAlert({
        runId,
        productId: insight.productId,
        kind: alert.kind,
        severityRank: SEVERITY_RANK[alert.severity],
        impact: alert.impact,
        alertJson: encodeAlert(alert),
      });
    }
    analysis.expiring.forEach((batch, seq) => {
      upsertBatch({
        runId,
        productId: insight.productId,
        seq,
        expiresAt: batch.expiresAt,
        batchJson: encodeBatch(batch),
      });
    });
  };

  const insertSales = (runId: number, rows: ReadonlyArray<SalesRow>) => {
    for (const row of rows) {
      upsertSales({
        runId,
        productId: row.productId,
        day: row.day,
        units: row.units,
        revenue: row.revenue,
      });
    }
  };

  const insertStaged = (runId: number, entries: ReadonlyArray<StagedProduct>) => {
    for (const entry of entries) {
      upsertStaged({ runId, productId: entry.product.id, stagedJson: encodeStaged(entry) });
    }
  };

  const deleteProducts = (runId: number, productIds: ReadonlyArray<string>) => {
    for (const table of [productInsight, insightAlert, expiringBatch]) {
      orm
        .delete(table)
        .where(and(eq(table.runId, runId), inJson(table.productId, productIds)))
        .run();
    }
  };

  const filterClause = (runId: number, filters: RestockFilters) => {
    const term = filters.search?.trim().toLowerCase();
    return and(
      eq(productInsight.runId, runId),
      inArray(productInsight.status, RESTOCK_VIEW_STATUSES[filters.view]),
      filters.ordersOnly === true ? eq(productInsight.hasOrder, 1) : undefined,
      term !== undefined && term.length > 0
        ? sql`${productInsight.nameKey} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`
        : undefined,
    );
  };

  const afterCursor = (cursor: RestockCursor) =>
    or(
      lt(productInsight.priority, cursor.priority),
      and(
        eq(productInsight.priority, cursor.priority),
        or(
          gt(productInsight.nameKey, cursor.nameKey),
          and(
            eq(productInsight.nameKey, cursor.nameKey),
            gt(productInsight.productId, cursor.productId),
          ),
        ),
      ),
    );

  const supersededTables = [
    { table: productInsight, key: [productInsight.runId, productInsight.productId], results: true },
    {
      table: insightAlert,
      key: [insightAlert.runId, insightAlert.productId, insightAlert.kind],
      results: true,
    },
    {
      table: expiringBatch,
      key: [expiringBatch.runId, expiringBatch.productId, expiringBatch.seq],
      results: true,
    },
    {
      table: workSales,
      key: [workSales.runId, workSales.productId, workSales.day],
      results: false,
    },
    { table: workProduct, key: [workProduct.runId, workProduct.productId], results: false },
  ] as const;

  return {
    published: (): PublishedRun | undefined => {
      const run = publishedRun();
      if (run === undefined) return undefined;
      const row = orm
        .select({ summaryJson: published.summaryJson })
        .from(published)
        .where(eq(published.id, 1))
        .get();
      return row === undefined ? undefined : { run, summary: decodeSummary(row.summaryJson) };
    },
    publishedRun,
    allocateRun: (): number =>
      db.transaction(
        () => orm.insert(runSequence).values({}).returning({ id: runSequence.id }).get().id,
      ),
    writeProducts: (runId: number, analyses: ReadonlyArray<ProductAnalysis>) =>
      db.transaction(() => {
        for (const analysis of analyses) insertAnalysis(runId, analysis);
      }),
    publish: (input: PublishInput): AnalyticsRun =>
      db.transaction(() => {
        const previous = publishedRun();
        if (input.replace !== undefined) {
          deleteProducts(input.runId, input.replace.productIds);
          for (const analysis of input.replace.analyses) insertAnalysis(input.runId, analysis);
        }
        const reader = summaryReader(input.runId);
        const run = decodeRun({
          runId: input.runId,
          revision: (previous?.revision ?? 0) + 1,
          kind: input.kind,
          completedAt: input.completedAt,
          generatedAt: input.generatedAt,
          sourceGeneration: input.sourceGeneration,
          sourceVersion: input.sourceVersion,
          policyVersion: input.policyVersion,
          algorithmVersion: input.algorithmVersion,
          today: input.today,
          utcOffsetMinutes: input.utcOffsetMinutes,
          productCount: reader.productCount(),
        });
        const summary = input.summarize(reader, run);
        upsertPublished({ id: 1, ...run, summaryJson: encodeSummary(summary) });
        return run;
      }),
    discardSuperseded: (input: {
      readonly keepResults: ReadonlyArray<number>;
      readonly keepWork: ReadonlyArray<number>;
      readonly limit: number;
    }): number =>
      db.transaction(() => {
        let removed = 0;
        for (const { table, key, results } of supersededTables) {
          const columns = sql.join([...key], sql`, `);
          const { changes } = orm
            .delete(table)
            .where(
              sql`(${columns}) IN (SELECT ${columns} FROM ${table} WHERE ${notInJson(
                table.runId,
                results ? input.keepResults : input.keepWork,
              )} LIMIT ${input.limit})`,
            )
            .run();
          removed += Number(changes);
        }
        return removed;
      }),
    checkpoint: () => db.checkpoint(),
    products: (ids: ReadonlyArray<string>) => {
      const run = publishedRun();
      if (run === undefined) return { run: undefined, insights: NO_INSIGHTS };
      const found = new Map(
        orm
          .select({ productId: productInsight.productId, insightJson: productInsight.insightJson })
          .from(productInsight)
          .where(and(eq(productInsight.runId, run.runId), inJson(productInsight.productId, ids)))
          .all()
          .map((row) => [row.productId, decodeProduct(row.insightJson)] as const),
      );
      return {
        run,
        insights: ids.flatMap((id) => {
          const insight = found.get(id);
          return insight === undefined ? [] : [insight];
        }),
      };
    },
    restockPage: (query: RestockPageQuery): RestockPageResult | undefined => {
      const run = publishedRun();
      if (run === undefined) return undefined;
      if (
        query.cursor !== null &&
        (query.cursor.runId !== run.runId || query.cursor.revision !== run.revision)
      ) {
        return { run, rows: [], nextCursor: null, total: null, cursorExpired: true };
      }
      const filter = filterClause(run.runId, query.filters);
      const cursor = query.cursor;
      const fetched = orm
        .select({ insightJson: productInsight.insightJson })
        .from(productInsight)
        .where(cursor === null ? filter : and(filter, afterCursor(cursor)))
        .orderBy(desc(productInsight.priority), productInsight.nameKey, productInsight.productId)
        .limit(query.limit + 1)
        .all();
      const page = fetched.slice(0, query.limit);
      const rows = page.map((row) => decodeProduct(row.insightJson));
      const last = rows.at(-1);
      const nextCursor: RestockCursor | null =
        fetched.length > query.limit && last !== undefined
          ? {
              runId: run.runId,
              revision: run.revision,
              priority: last.priority,
              nameKey: last.name.toLowerCase(),
              productId: last.productId,
            }
          : null;
      const total = cursor === null ? countWhere(productInsight, filter) : null;
      return { run, rows, nextCursor, total, cursorExpired: false };
    },
    workSales: {
      insert: (runId: number, rows: ReadonlyArray<SalesRow>) =>
        db.transaction(() => insertSales(runId, rows)),
      revenueRanking: (
        runId: number,
        firstDay: number,
        lastDay: number,
      ): ReadonlyArray<RevenueEntry> => {
        const revenue = sql<number>`sum(${workSales.revenue})`.mapWith(Number);
        return orm
          .select({ id: workSales.productId, revenue })
          .from(workSales)
          .where(
            and(
              eq(workSales.runId, runId),
              gte(workSales.day, firstDay),
              lte(workSales.day, lastDay),
            ),
          )
          .groupBy(workSales.productId)
          .having(gt(revenue, 0))
          .orderBy(desc(revenue), workSales.productId)
          .all();
      },
      range: (runId: number, firstId: string, lastId: string): ReadonlyArray<SalesRow> =>
        orm
          .select({
            productId: workSales.productId,
            day: workSales.day,
            units: workSales.units,
            revenue: workSales.revenue,
          })
          .from(workSales)
          .where(
            and(
              eq(workSales.runId, runId),
              gte(workSales.productId, firstId),
              lte(workSales.productId, lastId),
            ),
          )
          .orderBy(workSales.productId, workSales.day)
          .all(),
    },
    staged: {
      write: (runId: number, entries: ReadonlyArray<StagedProduct>) =>
        db.transaction(() => insertStaged(runId, entries)),
      replace: (
        runId: number,
        input: {
          readonly productIds: ReadonlyArray<string>;
          readonly entries: ReadonlyArray<StagedProduct>;
          readonly sales: ReadonlyArray<SalesRow>;
        },
      ) =>
        db.transaction(() => {
          for (const table of [workProduct, workSales]) {
            orm
              .delete(table)
              .where(and(eq(table.runId, runId), inJson(table.productId, input.productIds)))
              .run();
          }
          insertStaged(runId, input.entries);
          insertSales(runId, input.sales);
        }),
      count: (runId: number): number => countWhere(workProduct, eq(workProduct.runId, runId)),
      page: (runId: number, after: string, limit: number): ReadonlyArray<StagedProduct> =>
        orm
          .select({ stagedJson: workProduct.stagedJson })
          .from(workProduct)
          .where(and(eq(workProduct.runId, runId), gt(workProduct.productId, after)))
          .orderBy(workProduct.productId)
          .limit(limit)
          .all()
          .map((row) => decodeStaged(row.stagedJson)),
    },
    clearWork: (runId: number) =>
      db.transaction(() => {
        orm.delete(workSales).where(eq(workSales.runId, runId)).run();
        orm.delete(workProduct).where(eq(workProduct.runId, runId)).run();
      }),
    rankingOf: (runId: number): ReadonlyArray<ClassifiedProduct> =>
      orm
        .select({
          productId: productInsight.productId,
          abc: productInsight.abc,
          revenue90d: productInsight.revenue90d,
        })
        .from(productInsight)
        .where(
          and(
            eq(productInsight.runId, runId),
            or(gt(productInsight.revenue90d, 0), ne(productInsight.abc, "C")),
          ),
        )
        .all(),
    storedProductIds: (runId: number, ids: ReadonlyArray<string>): ReadonlyArray<string> =>
      orm
        .select({ productId: productInsight.productId })
        .from(productInsight)
        .where(and(eq(productInsight.runId, runId), inJson(productInsight.productId, ids)))
        .all()
        .map((row) => row.productId),
  };
};

export type AnalyticsStore = ReturnType<typeof makeAnalyticsStore>;
