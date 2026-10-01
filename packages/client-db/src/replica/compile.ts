import * as schema from "@store/db/replica.schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias, QueryBuilder, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { UnsupportedSubsetQuery } from "./errors";
import {
  DISTINCT_COLUMNS,
  FILTER_COLUMNS,
  MAX_DISTINCT_VALUES,
  ORDER_COLUMNS,
  type InventoryCollectionSource,
} from "./sources";
import {
  resolveSubsetOrder,
  type InventorySubsetSpec,
  type InventorySubsetSummarySpec,
  type SubsetPredicate,
  type SubsetScalar,
} from "./subset-spec";
import type { SqliteParameter } from "./types";
import { allowlisted, rejectColumn } from "./validate";

export { validateSummarySpec } from "./validate";

type SqliteSubsetStatement = {
  readonly sql: string;
  readonly parameters: ReadonlyArray<SqliteParameter>;
};

const queryBuilder = new QueryBuilder();

const toSqliteParameter = (value: SubsetScalar): SqliteParameter => {
  switch (value) {
    case true:
      return 1;
    case false:
      return 0;
    default:
      return value;
  }
};

const SOURCE_TABLES = {
  categories: schema.categories,
  products: schema.products,
  batches: schema.batches,
  invoices: schema.invoices,
  invoiceItems: schema.invoiceItems,
  stockMovements: schema.stockMovements,
  suppliers: schema.suppliers,
  purchaseOrders: schema.purchaseOrders,
  purchaseOrderItems: schema.purchaseOrderItems,
} satisfies Record<InventoryCollectionSource, SQLiteTable>;

const sequenceAfter = (later: SQLiteColumn, earlier: SQLiteColumn) =>
  sql`(length(${later}) > length(${earlier}) OR (length(${later}) = length(${earlier}) AND ${later} > ${earlier}))`;

const overlayCommand = alias(schema.commandOutbox, "overlay_command");
const absoluteCommand = alias(schema.commandOutbox, "absolute_command");

const overlaySum = (delta: SQLiteColumn) =>
  sql`coalesce(${queryBuilder
    .select({ total: sql`sum(${delta})` })
    .from(schema.stockOverlays)
    .leftJoin(overlayCommand, eq(overlayCommand.operationId, schema.stockOverlays.commandId))
    .where(
      and(
        eq(schema.stockOverlays.batchId, schema.batches.id),
        notExists(
          queryBuilder
            .select({ one: sql`1` })
            .from(schema.pendingRowMarks)
            .innerJoin(
              absoluteCommand,
              eq(absoluteCommand.operationId, schema.pendingRowMarks.operationId),
            )
            .where(
              and(
                eq(schema.pendingRowMarks.entity, "batch"),
                eq(schema.pendingRowMarks.entityId, schema.batches.id),
                not(sequenceAfter(overlayCommand.clientSequence, absoluteCommand.clientSequence)),
              ),
            ),
        ),
      ),
    )}, 0)`;

export const visibleBatches = queryBuilder.$with("visible_batches").as(
  queryBuilder
    .select({
      id: schema.batches.id,
      productId: schema.batches.productId,
      batchNumber: schema.batches.batchNumber,
      expiresAt: schema.batches.expiresAt,
      packQuantity:
        sql<number>`${schema.batches.packQuantity} + ${overlaySum(schema.stockOverlays.packDelta)}`.as(
          "packQuantity",
        ),
      unitQuantity:
        sql<number>`${schema.batches.unitQuantity} + ${overlaySum(schema.stockOverlays.unitDelta)}`.as(
          "unitQuantity",
        ),
      createdAt: schema.batches.createdAt,
      updatedAt: schema.batches.updatedAt,
      organizationId: schema.batches.organizationId,
      createdByUserId: schema.batches.createdByUserId,
      updatedByUserId: schema.batches.updatedByUserId,
      deviceId: schema.batches.deviceId,
      operationId: schema.batches.operationId,
      rowVersion: schema.batches.rowVersion,
    })
    .from(schema.batches),
);

const COMPARISONS = { eq, gt, gte, lt, lte } as const;

type TextSearchIndex = {
  readonly table: string;
  readonly rowid: SQL;
  readonly columns: ReadonlySet<string>;
};

const PRODUCT_SEARCH_INDEX = {
  table: "products_search",
  rowid: sql`${schema.products}.rowid`,
  columns: new Set(["name", "composition", "strength"]),
} satisfies TextSearchIndex;

const textSearchIndex = (source: InventoryCollectionSource): TextSearchIndex | undefined =>
  source === "products" ? PRODUCT_SEARCH_INDEX : undefined;

const MIN_TRIGRAM_CHARACTERS = 3;

const CONTAINED_TEXT = /^%([^%_]+)%$/u;

const containedText = (pattern: string): string | undefined => {
  const text = CONTAINED_TEXT.exec(pattern)?.[1];
  return text !== undefined && Array.from(text).length >= MIN_TRIGRAM_CHARACTERS ? text : undefined;
};

const textSearchMatch = (predicate: SubsetPredicate, index: TextSearchIndex) => {
  const leaves = predicate._tag === "or" ? predicate.predicates : [predicate];
  const columns: Array<string> = [];
  let text: string | undefined;
  for (const leaf of leaves) {
    if (leaf._tag !== "like" || !index.columns.has(leaf.column)) return undefined;
    const contained = containedText(leaf.pattern);
    if (contained === undefined || (text !== undefined && contained !== text)) return undefined;
    text = contained;
    columns.push(leaf.column);
  }
  if (text === undefined) return undefined;
  return `{${[...new Set(columns)].join(" ")}} : "${text.replaceAll('"', '""')}"`;
};

const lowerPredicate = (
  predicate: SubsetPredicate,
  columns: ReadonlySet<string>,
  lookup: Record<string, SQLiteColumn>,
  search?: TextSearchIndex,
): Effect.Effect<SQL, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const match = search ? textSearchMatch(predicate, search) : undefined;
    if (search && match !== undefined) {
      const exact = yield* lowerPredicate(predicate, columns, lookup);
      const table = sql.identifier(search.table);
      return sql`(${search.rowid} in (select rowid from ${table} where ${table} match ${match}) and ${exact})`;
    }
    const column = (name: string) =>
      allowlisted(name, columns).pipe(
        Effect.flatMap((allowed) => {
          const found = lookup[allowed];
          return found ? Effect.succeed(found) : Effect.fail(rejectColumn(allowed));
        }),
      );
    switch (predicate._tag) {
      case "and":
      case "or": {
        const inner = yield* Effect.forEach(predicate.predicates, (nested) =>
          lowerPredicate(nested, columns, lookup, search),
        );
        if (predicate._tag === "and") return and(...inner) ?? sql`1`;
        return or(...inner) ?? sql`0`;
      }
      case "not":
        return not(yield* lowerPredicate(predicate.predicate, columns, lookup)) ?? sql`0`;
      case "isNull":
        return isNull(yield* column(predicate.column));
      case "in": {
        const target = yield* column(predicate.column);
        if (predicate.values.length === 0) return sql`0`;
        return inArray(target, predicate.values.map(toSqliteParameter));
      }
      case "compare":
        return COMPARISONS[predicate.op](
          yield* column(predicate.column),
          toSqliteParameter(predicate.value),
        );
      case "like":
        return like(yield* column(predicate.column), predicate.pattern);
    }
  });

const SqliteParameterSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.BigInt,
  Schema.Null,
  Schema.Uint8Array,
]);

const decodeParameters = Schema.decodeUnknownSync(Schema.Array(SqliteParameterSchema));

export const toStatement = (query: { toSQL: () => { sql: string; params: Array<unknown> } }) => {
  const built = query.toSQL();
  return {
    sql: built.sql,
    parameters: decodeParameters(built.params),
  };
};

export const lowerSqliteSubset = (
  spec: InventorySubsetSpec,
): Effect.Effect<SqliteSubsetStatement, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const relation = spec.source === "batches" ? visibleBatches : SOURCE_TABLES[spec.source];
    const lookup: Record<string, SQLiteColumn> =
      spec.source === "batches"
        ? {
            id: visibleBatches.id,
            organizationId: visibleBatches.organizationId,
            productId: visibleBatches.productId,
            expiresAt: visibleBatches.expiresAt,
          }
        : getTableColumns(SOURCE_TABLES[spec.source]);
    const where = spec.where
      ? yield* lowerPredicate(
          spec.where,
          FILTER_COLUMNS[spec.source],
          lookup,
          textSearchIndex(spec.source),
        )
      : undefined;
    const orderBy = yield* Effect.forEach(resolveSubsetOrder(spec), (clause) =>
      allowlisted(clause.column, ORDER_COLUMNS[spec.source]).pipe(
        Effect.flatMap((name) => {
          const target = lookup[name];
          return target ? Effect.succeed(target) : Effect.fail(rejectColumn(name));
        }),
        Effect.map((target) => {
          const collated = clause.collation === "nocase" ? sql`${target} COLLATE NOCASE` : target;
          const directed = clause.direction === "desc" ? desc(collated) : asc(collated);
          const defaultNulls = clause.direction === "asc" ? "first" : "last";
          if (clause.nulls === defaultNulls) return directed;
          return sql`${directed} ${clause.nulls === "first" ? sql`NULLS FIRST` : sql`NULLS LAST`}`;
        }),
      ),
    );
    const base = queryBuilder
      .with(...(spec.source === "batches" ? [visibleBatches] : []))
      .select()
      .from(relation)
      .where(where)
      .orderBy(...orderBy)
      .limit(spec.limit);
    return toStatement(spec.offset > 0 ? base.offset(spec.offset) : base);
  });

type SqliteSummaryStatements = {
  readonly count: SqliteSubsetStatement;
  readonly distinct: ReadonlyArray<{
    readonly column: string;
    readonly statement: SqliteSubsetStatement;
  }>;
};

export const lowerSqliteSummary = (
  spec: InventorySubsetSummarySpec,
): Effect.Effect<SqliteSummaryStatements, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const table = SOURCE_TABLES[spec.source];
    const lookup: Record<string, SQLiteColumn> = getTableColumns(table);
    const where = spec.where
      ? yield* lowerPredicate(
          spec.where,
          FILTER_COLUMNS[spec.source],
          lookup,
          textSearchIndex(spec.source),
        )
      : undefined;
    const distinct = yield* Effect.forEach(spec.distinct, (column) =>
      allowlisted(column, DISTINCT_COLUMNS[spec.source]).pipe(
        Effect.flatMap((name) => {
          const target = lookup[name];
          return target ? Effect.succeed(target) : Effect.fail(rejectColumn(name));
        }),
        Effect.map((target) => ({
          column,
          statement: toStatement(
            queryBuilder
              .select({ value: sql<string>`min(trim(${target}))`.as("value") })
              .from(table)
              .where(and(where, isNotNull(target), sql`trim(${target}) <> ''`))
              .groupBy(sql`lower(trim(${target}))`)
              .orderBy(sql`value COLLATE NOCASE`)
              .limit(MAX_DISTINCT_VALUES),
          ),
        })),
      ),
    );
    return {
      count: toStatement(
        queryBuilder
          .select({ count: count().as("count") })
          .from(table)
          .where(where),
      ),
      distinct,
    };
  });
