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
import * as Schema from "effect/Schema";

import type { AnalyticsDatabase, AnalyticsParameter } from "./database";

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
const decodeTrend = Schema.decodeUnknownSync(DemandForecast.fields.trend);

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

const num = Schema.decodeUnknownSync(Schema.Number);
const NO_INSIGHTS: ReadonlyArray<ProductInsight> = [];

const jsonIds = (ids: ReadonlyArray<string>) => JSON.stringify(ids);

const escapeLike = (term: string) => term.replace(/[\\%_]/gu, (match) => `\\${match}`);

const isStockStatus = Schema.is(StockStatus);

const inList = (values: ReadonlyArray<string>) => values.map(() => "?").join(", ");

export const makeAnalyticsStore = (db: AnalyticsDatabase) => {
  const publishedRow = () =>
    db.get(
      `SELECT runId, revision, kind, completedAt, generatedAt, sourceGeneration, sourceVersion,
              policyVersion, algorithmVersion, today, utcOffsetMinutes, productCount
         FROM published WHERE id = 1`,
    );

  const publishedRun = (): AnalyticsRun | undefined => {
    const row = publishedRow();
    return row === undefined ? undefined : decodeRun(row);
  };

  const summaryReader = (runId: number): SummaryReader => ({
    runId,
    productCount: () =>
      num(db.get("SELECT count(*) AS n FROM product_insight WHERE runId = ?", [runId])?.["n"]),
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
      for (const row of db.all(
        "SELECT status, count(*) AS n FROM product_insight WHERE runId = ? GROUP BY status",
        [runId],
      )) {
        const status: unknown = row["status"];
        if (isStockStatus(status)) counts[status] = num(row["n"]);
      }
      return counts;
    },
    inventory: () => {
      const row =
        db.get(
          `SELECT coalesce(sum(valueAtCost), 0) AS valueAtCost,
                  coalesce(sum(valueAtRetail), 0) AS valueAtRetail,
                  coalesce(sum(deadStockValue), 0) AS deadStockValue,
                  coalesce(sum(expiryRiskValue), 0) AS expiryRiskValue,
                  coalesce(sum(expiredValue), 0) AS expiredValue,
                  coalesce(sum(reorderCost), 0) AS reorderCost,
                  coalesce(sum(hasOrder), 0) AS reorderCount,
                  coalesce(sum(missingCost), 0) AS missingCostCount
             FROM product_insight WHERE runId = ?`,
          [runId],
        ) ?? {};
      return {
        valueAtCost: num(row["valueAtCost"]),
        valueAtRetail: num(row["valueAtRetail"]),
        deadStockValue: num(row["deadStockValue"]),
        expiryRiskValue: num(row["expiryRiskValue"]),
        expiredValue: num(row["expiredValue"]),
        reorderCost: num(row["reorderCost"]),
        reorderCount: num(row["reorderCount"]),
        missingCostCount: num(row["missingCostCount"]),
      };
    },
    alertCandidates: (limit) => {
      const boundary = db.get(
        `SELECT severityRank, impact FROM insight_alert WHERE runId = ?
          ORDER BY severityRank, impact DESC LIMIT 1 OFFSET ?`,
        [runId, Math.max(0, limit - 1)],
      );
      const rows =
        boundary === undefined
          ? db.all(
              `SELECT alertJson FROM insight_alert WHERE runId = ?
                ORDER BY severityRank, impact DESC`,
              [runId],
            )
          : db.all(
              `SELECT alertJson FROM insight_alert
                WHERE runId = ? AND (severityRank < ? OR (severityRank = ? AND impact >= ?))
                ORDER BY severityRank, impact DESC LIMIT ?`,
              [
                runId,
                num(boundary["severityRank"]),
                num(boundary["severityRank"]),
                num(boundary["impact"]),
                ALERT_TIE_CAP + limit,
              ],
            );
      return rows.map((row) => decodeAlert(row["alertJson"]));
    },
    attention: (limit) => {
      const statuses = RESTOCK_VIEW_STATUSES.action;
      const filter = `runId = ? AND status IN (${inList(statuses)})`;
      const parameters: Array<AnalyticsParameter> = [runId, ...statuses];
      return {
        rows: db
          .all(
            `SELECT insightJson FROM product_insight WHERE ${filter}
              ORDER BY priority DESC, nameKey, productId LIMIT ?`,
            [...parameters, limit],
          )
          .map((row) => decodeProduct(row["insightJson"])),
        count: num(
          db.get(`SELECT count(*) AS n FROM product_insight WHERE ${filter}`, parameters)?.["n"],
        ),
      };
    },
    expiring: (limit) => ({
      rows: db
        .all(
          `SELECT batchJson FROM expiring_batch WHERE runId = ?
            ORDER BY expiresAt, productId, seq LIMIT ?`,
          [runId, limit],
        )
        .map((row) => decodeBatch(row["batchJson"])),
      count: num(
        db.get("SELECT count(*) AS n FROM expiring_batch WHERE runId = ?", [runId])?.["n"],
      ),
    }),
    periodProducts: function* (slot) {
      const revenue = ["periodRevenue7", "periodRevenue30", "periodRevenue90"][slot];
      const units = ["periodUnits7", "periodUnits30", "periodUnits90"][slot];
      for (const row of db.iterate(
        `SELECT productId, name, unitCost, trend, ${revenue} AS revenue, ${units} AS units
           FROM product_insight
          WHERE runId = ? AND (${revenue} > 0 OR ${units} > 0)
          ORDER BY productId`,
        [runId],
      )) {
        yield {
          productId: String(row["productId"]),
          name: String(row["name"]),
          revenue: num(row["revenue"]),
          units: num(row["units"]),
          unitCost: row["unitCost"] === null ? null : num(row["unitCost"]),
          trend: decodeTrend(row["trend"]),
        };
      }
    },
  });

  const insertAnalysis = (runId: number, analysis: ProductAnalysis) => {
    const { insight, contribution } = analysis;
    db.run(
      `INSERT OR REPLACE INTO product_insight (
         runId, productId, name, nameKey, status, abc, priority, hasOrder, revenue90d, unitCost, trend,
         periodRevenue7, periodUnits7, periodRevenue30, periodUnits30, periodRevenue90, periodUnits90,
         valueAtCost, valueAtRetail, deadStockValue, expiryRiskValue, expiredValue, reorderCost,
         missingCost, insightJson
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        insight.productId,
        insight.name,
        insight.name.toLowerCase(),
        insight.status,
        insight.abc,
        insight.priority,
        insight.order === null ? 0 : 1,
        insight.revenue90d,
        insight.unitCost,
        insight.demand.trend,
        analysis.periodRevenue[0],
        analysis.periodUnits[0],
        analysis.periodRevenue[1],
        analysis.periodUnits[1],
        analysis.periodRevenue[2],
        analysis.periodUnits[2],
        contribution.valueAtCost,
        contribution.valueAtRetail,
        contribution.deadStockValue,
        contribution.expiryRiskValue,
        contribution.expiredValue,
        contribution.reorderCost,
        contribution.missingCostCount,
        encodeProduct(insight),
      ],
    );
    for (const alert of analysis.alerts) {
      db.run(
        `INSERT OR REPLACE INTO insight_alert (runId, productId, kind, severityRank, impact, alertJson)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          runId,
          insight.productId,
          alert.kind,
          SEVERITY_RANK[alert.severity],
          alert.impact,
          encodeAlert(alert),
        ],
      );
    }
    analysis.expiring.forEach((batch, seq) => {
      db.run(
        `INSERT OR REPLACE INTO expiring_batch (runId, productId, seq, expiresAt, batchJson)
         VALUES (?, ?, ?, ?, ?)`,
        [runId, insight.productId, seq, batch.expiresAt, encodeBatch(batch)],
      );
    });
  };

  const insertSales = (runId: number, rows: ReadonlyArray<SalesRow>) => {
    for (const row of rows) {
      db.run(
        `INSERT OR REPLACE INTO work_sales (runId, productId, day, units, revenue)
         VALUES (?, ?, ?, ?, ?)`,
        [runId, row.productId, row.day, row.units, row.revenue],
      );
    }
  };

  const insertStaged = (runId: number, entries: ReadonlyArray<StagedProduct>) => {
    for (const entry of entries) {
      db.run(
        "INSERT OR REPLACE INTO work_product (runId, productId, stagedJson) VALUES (?, ?, ?)",
        [runId, entry.product.id, encodeStaged(entry)],
      );
    }
  };

  const deleteProducts = (runId: number, productIds: ReadonlyArray<string>) => {
    const ids = jsonIds(productIds);
    for (const table of ["product_insight", "insight_alert", "expiring_batch"]) {
      db.run(
        `DELETE FROM ${table} WHERE runId = ? AND productId IN (SELECT value FROM json_each(?))`,
        [runId, ids],
      );
    }
  };

  const filterClause = (runId: number, filters: RestockFilters) => {
    const statuses = RESTOCK_VIEW_STATUSES[filters.view];
    const clauses = [`runId = ?`, `status IN (${inList(statuses)})`];
    const parameters: Array<AnalyticsParameter> = [runId, ...statuses];
    if (filters.ordersOnly === true) clauses.push("hasOrder = 1");
    const term = filters.search?.trim().toLowerCase();
    if (term !== undefined && term.length > 0) {
      clauses.push("nameKey LIKE ? ESCAPE '\\'");
      parameters.push(`%${escapeLike(term)}%`);
    }
    return { where: clauses.join(" AND "), parameters };
  };

  return {
    published: (): PublishedRun | undefined => {
      const run = publishedRun();
      if (run === undefined) return undefined;
      const row = db.get("SELECT summaryJson FROM published WHERE id = 1");
      return row === undefined ? undefined : { run, summary: decodeSummary(row["summaryJson"]) };
    },
    publishedRun,
    allocateRun: (): number =>
      db.transaction(() => {
        db.run("INSERT INTO run_sequence DEFAULT VALUES");
        return num(db.get("SELECT last_insert_rowid() AS id")?.["id"]);
      }),
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
        db.run(
          `INSERT OR REPLACE INTO published (
             id, runId, revision, kind, completedAt, generatedAt, sourceGeneration, sourceVersion,
             policyVersion, algorithmVersion, today, utcOffsetMinutes, productCount, summaryJson
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            run.runId,
            run.revision,
            run.kind,
            run.completedAt,
            run.generatedAt,
            run.sourceGeneration,
            run.sourceVersion,
            run.policyVersion,
            run.algorithmVersion,
            run.today,
            run.utcOffsetMinutes,
            run.productCount,
            encodeSummary(summary),
          ],
        );
        return run;
      }),
    discardSuperseded: (input: {
      readonly keepResults: ReadonlyArray<number>;
      readonly keepWork: ReadonlyArray<number>;
      readonly limit: number;
    }): number =>
      db.transaction(() => {
        let removed = 0;
        const tables = [
          ["product_insight", "productId", input.keepResults],
          ["insight_alert", "productId, kind", input.keepResults],
          ["expiring_batch", "productId, seq", input.keepResults],
          ["work_sales", "productId, day", input.keepWork],
          ["work_product", "productId", input.keepWork],
        ] as const;
        for (const [table, key, keep] of tables) {
          db.run(
            `DELETE FROM ${table} WHERE (runId, ${key}) IN (
               SELECT runId, ${key} FROM ${table}
                WHERE runId NOT IN (SELECT value FROM json_each(?)) LIMIT ?)`,
            [JSON.stringify(keep), input.limit],
          );
          removed += num(db.get("SELECT changes() AS n")?.["n"]);
        }
        return removed;
      }),
    checkpoint: () => db.run("PRAGMA wal_checkpoint(TRUNCATE)"),
    products: (ids: ReadonlyArray<string>) => {
      const run = publishedRun();
      if (run === undefined) return { run: undefined, insights: NO_INSIGHTS };
      const found = new Map(
        db
          .all(
            `SELECT productId, insightJson FROM product_insight
              WHERE runId = ? AND productId IN (SELECT value FROM json_each(?))`,
            [run.runId, jsonIds(ids)],
          )
          .map((row) => [String(row["productId"]), decodeProduct(row["insightJson"])] as const),
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
      const { where, parameters } = filterClause(run.runId, query.filters);
      const cursor = query.cursor;
      let afterSql = "";
      const afterParameters: Array<AnalyticsParameter> = [];
      if (cursor !== null) {
        afterSql = ` AND (priority < ? OR (priority = ? AND (nameKey > ? OR (nameKey = ? AND productId > ?))))`;
        afterParameters.push(
          cursor.priority,
          cursor.priority,
          cursor.nameKey,
          cursor.nameKey,
          cursor.productId,
        );
      }
      const fetched = db.all(
        `SELECT insightJson FROM product_insight WHERE ${where}${afterSql}
          ORDER BY priority DESC, nameKey, productId LIMIT ?`,
        [...parameters, ...afterParameters, query.limit + 1],
      );
      const page = fetched.slice(0, query.limit);
      const rows = page.map((row) => decodeProduct(row["insightJson"]));
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
      const total =
        cursor === null
          ? num(
              db.get(`SELECT count(*) AS n FROM product_insight WHERE ${where}`, parameters)?.["n"],
            )
          : null;
      return { run, rows, nextCursor, total, cursorExpired: false };
    },
    workSales: {
      insert: (runId: number, rows: ReadonlyArray<SalesRow>) =>
        db.transaction(() => insertSales(runId, rows)),
      revenueRanking: (
        runId: number,
        firstDay: number,
        lastDay: number,
      ): ReadonlyArray<RevenueEntry> =>
        db
          .all(
            `SELECT productId AS id, sum(revenue) AS revenue
               FROM work_sales
              WHERE runId = ? AND day >= ? AND day <= ?
              GROUP BY productId
             HAVING sum(revenue) > 0
              ORDER BY sum(revenue) DESC, productId`,
            [runId, firstDay, lastDay],
          )
          .map((row) => ({ id: String(row["id"]), revenue: num(row["revenue"]) })),
      range: (runId: number, firstId: string, lastId: string): ReadonlyArray<SalesRow> =>
        db
          .all(
            `SELECT productId, day, units, revenue FROM work_sales
              WHERE runId = ? AND productId >= ? AND productId <= ?
              ORDER BY productId, day`,
            [runId, firstId, lastId],
          )
          .map((row) => ({
            productId: String(row["productId"]),
            day: num(row["day"]),
            units: num(row["units"]),
            revenue: num(row["revenue"]),
          })),
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
          const ids = jsonIds(input.productIds);
          for (const table of ["work_product", "work_sales"]) {
            db.run(
              `DELETE FROM ${table} WHERE runId = ? AND productId IN (SELECT value FROM json_each(?))`,
              [runId, ids],
            );
          }
          insertStaged(runId, input.entries);
          insertSales(runId, input.sales);
        }),
      count: (runId: number): number =>
        num(db.get("SELECT count(*) AS n FROM work_product WHERE runId = ?", [runId])?.["n"]),
      page: (runId: number, after: string, limit: number): ReadonlyArray<StagedProduct> =>
        db
          .all(
            `SELECT stagedJson FROM work_product WHERE runId = ? AND productId > ?
              ORDER BY productId LIMIT ?`,
            [runId, after, limit],
          )
          .map((row) => decodeStaged(row["stagedJson"])),
    },
    clearWork: (runId: number) =>
      db.transaction(() => {
        db.run("DELETE FROM work_sales WHERE runId = ?", [runId]);
        db.run("DELETE FROM work_product WHERE runId = ?", [runId]);
      }),
    rankingOf: (runId: number): ReadonlyArray<ClassifiedProduct> =>
      db
        .all(
          `SELECT productId, abc, revenue90d FROM product_insight
            WHERE runId = ? AND (revenue90d > 0 OR abc <> 'C')`,
          [runId],
        )
        .map((row) => ({
          productId: String(row["productId"]),
          abc: String(row["abc"]),
          revenue90d: num(row["revenue90d"]),
        })),
    storedProductIds: (runId: number, ids: ReadonlyArray<string>): ReadonlyArray<string> =>
      db
        .all(
          `SELECT productId FROM product_insight
            WHERE runId = ? AND productId IN (SELECT value FROM json_each(?))`,
          [runId, jsonIds(ids)],
        )
        .map((row) => String(row["productId"])),
  };
};

export type AnalyticsStore = ReturnType<typeof makeAnalyticsStore>;
