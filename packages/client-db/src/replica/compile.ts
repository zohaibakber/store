import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";
import {
  CASE_INSENSITIVE_ORDER_COLUMNS,
  DISTINCT_COLUMNS,
  FILTER_COLUMNS,
  MAX_DISTINCT_VALUES,
  ORDER_COLUMNS,
  SOURCE_TABLE,
} from "./sources";
import type {
  InventorySubsetSpec,
  InventorySubsetSummarySpec,
  SubsetPredicate,
  SubsetScalar,
} from "./subset-spec";
import type { SqliteParameter } from "./types";

type SqliteSubsetStatement = {
  readonly sql: string;
  readonly parameters: ReadonlyArray<SqliteParameter>;
};

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

const COMPARISON_SQL = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

const rejectColumn = (column: string) =>
  new UnsupportedSubsetQuery({
    message: `Unsupported subset query: column ${column} is not allowlisted`,
    reason: `column ${column} is not allowlisted`,
  });

const allowlisted = (
  column: string,
  columns: ReadonlySet<string>,
): Effect.Effect<string, UnsupportedSubsetQuery> =>
  columns.has(column) ? Effect.succeed(`"${column}"`) : Effect.fail(rejectColumn(column));

const lowerPredicate = (
  predicate: SubsetPredicate,
  columns: ReadonlySet<string>,
): Effect.Effect<SqliteSubsetStatement, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    switch (predicate._tag) {
      case "and":
      case "or": {
        const fragments = yield* Effect.forEach(predicate.predicates, (inner) =>
          lowerPredicate(inner, columns),
        );
        const joiner = predicate._tag === "and" ? " AND " : " OR ";
        return {
          sql: `(${fragments.map((fragment) => fragment.sql).join(joiner)})`,
          parameters: fragments.flatMap((fragment) => fragment.parameters),
        };
      }
      case "not": {
        const inner = yield* lowerPredicate(predicate.predicate, columns);
        return { sql: `NOT (${inner.sql})`, parameters: inner.parameters };
      }
      case "isNull":
        return { sql: `${yield* allowlisted(predicate.column, columns)} IS NULL`, parameters: [] };
      case "in": {
        const column = yield* allowlisted(predicate.column, columns);
        if (predicate.values.length === 0) return { sql: "0", parameters: [] };
        const parameters = predicate.values.map(toSqliteParameter);
        return {
          sql: `${column} IN (${parameters.map(() => "?").join(", ")})`,
          parameters,
        };
      }
      case "compare":
        return {
          sql: `${yield* allowlisted(predicate.column, columns)} ${COMPARISON_SQL[predicate.op]} ?`,
          parameters: [toSqliteParameter(predicate.value)],
        };
      case "like":
        return {
          sql: `${yield* allowlisted(predicate.column, columns)} LIKE ?`,
          parameters: [predicate.pattern],
        };
    }
  });

export const lowerSqliteSubset = (
  spec: InventorySubsetSpec,
): Effect.Effect<SqliteSubsetStatement, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const where = spec.where
      ? yield* lowerPredicate(spec.where, FILTER_COLUMNS[spec.source])
      : undefined;
    const orderBy = yield* Effect.forEach(spec.orderBy, (clause) =>
      allowlisted(clause.column, ORDER_COLUMNS[spec.source]).pipe(
        Effect.map((column) => {
          const collation = CASE_INSENSITIVE_ORDER_COLUMNS[spec.source].has(clause.column)
            ? " COLLATE NOCASE"
            : "";
          return `${column}${collation} ${clause.direction === "desc" ? "DESC" : "ASC"}`;
        }),
      ),
    );
    const whereSql = where ? ` WHERE ${where.sql}` : "";
    const orderSql = orderBy.length === 0 ? "" : ` ORDER BY ${orderBy.join(", ")}`;
    const offsetSql = spec.offset > 0 ? " OFFSET ?" : "";
    const offsetParameters: ReadonlyArray<SqliteParameter> = spec.offset > 0 ? [spec.offset] : [];
    return {
      sql: `SELECT * FROM "${SOURCE_TABLE[spec.source]}"${whereSql}${orderSql} LIMIT ?${offsetSql}`,
      parameters: [...(where?.parameters ?? []), spec.limit, ...offsetParameters],
    };
  });

export type SqliteSummaryStatements = {
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
    const table = `"${SOURCE_TABLE[spec.source]}"`;
    const where = spec.where
      ? yield* lowerPredicate(spec.where, FILTER_COLUMNS[spec.source])
      : undefined;
    const whereSql = where ? ` WHERE ${where.sql}` : "";
    const whereParameters = where?.parameters ?? [];
    const distinct = yield* Effect.forEach(spec.distinct, (column) =>
      allowlisted(column, DISTINCT_COLUMNS[spec.source]).pipe(
        Effect.map((quoted) => ({
          column,
          statement: {
            sql: `SELECT min(trim(${quoted})) AS value FROM ${table}${whereSql}${
              where ? " AND" : " WHERE"
            } ${quoted} IS NOT NULL AND trim(${quoted}) <> '' GROUP BY lower(trim(${quoted})) ORDER BY value COLLATE NOCASE LIMIT ?`,
            parameters: [...whereParameters, MAX_DISTINCT_VALUES],
          },
        })),
      ),
    );
    return {
      count: {
        sql: `SELECT count(*) AS count FROM ${table}${whereSql}`,
        parameters: whereParameters,
      },
      distinct,
    };
  });

const predicateColumns = (predicate: SubsetPredicate): ReadonlyArray<string> => {
  switch (predicate._tag) {
    case "and":
    case "or":
      return predicate.predicates.flatMap(predicateColumns);
    case "not":
      return predicateColumns(predicate.predicate);
    case "compare":
    case "in":
    case "isNull":
    case "like":
      return [predicate.column];
  }
};

export const validateSummarySpec = (
  spec: InventorySubsetSummarySpec,
): Effect.Effect<InventorySubsetSummarySpec, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const filters = spec.where ? predicateColumns(spec.where) : [];
    yield* Effect.forEach(filters, (column) => allowlisted(column, FILTER_COLUMNS[spec.source]));
    yield* Effect.forEach(spec.distinct, (column) =>
      allowlisted(column, DISTINCT_COLUMNS[spec.source]),
    );
    return spec;
  });
