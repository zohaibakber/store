import { IR } from "@tanstack/db";
import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";
import {
  FILTER_COLUMNS,
  HISTORY_SOURCES,
  MAX_IN_VALUES,
  ORDER_COLUMNS,
  SOURCE_TABLE,
} from "./sources";
import { decodeComparisonList, decodeComparisonScalar, type ComparisonScalar } from "./sqlite-row";
import type { CompileSqliteSubset, SqliteParameter } from "./types";

const sqlComparison = (name: string): string | undefined => {
  switch (name) {
    case "eq":
      return "=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    default:
      return undefined;
  }
};

type SqlFragment = {
  readonly sql: string;
  readonly parameters: ReadonlyArray<SqliteParameter>;
};

const fail = (reason: string): Effect.Effect<never, UnsupportedSubsetQuery> =>
  Effect.fail(
    new UnsupportedSubsetQuery({
      message: `Unsupported subset query: ${reason}`,
      reason,
    }),
  );

const toSqliteParameter = (value: ComparisonScalar): SqliteParameter => {
  switch (value) {
    case true:
      return 1;
    case false:
      return 0;
    default:
      return value;
  }
};

const parseScalar = (
  value: IR.Value["value"],
): Effect.Effect<SqliteParameter, UnsupportedSubsetQuery> =>
  Effect.try({
    try: () => toSqliteParameter(decodeComparisonScalar(value)),
    catch: () =>
      new UnsupportedSubsetQuery({
        message: "Unsupported subset query: comparison value is not a SQLite scalar",
        reason: "comparison value is not a SQLite scalar",
      }),
  });

const parseList = (
  value: IR.Value["value"],
): Effect.Effect<ReadonlyArray<SqliteParameter>, UnsupportedSubsetQuery> =>
  Effect.try({
    try: () => decodeComparisonList(value).map(toSqliteParameter),
    catch: () =>
      new UnsupportedSubsetQuery({
        message: "Unsupported subset query: in requires a bounded value list",
        reason: "in requires a bounded value list",
      }),
  });

const columnFromRef = (
  expression: IR.BasicExpression,
  columns: ReadonlySet<string>,
): Effect.Effect<string, UnsupportedSubsetQuery> => {
  if (expression.type !== "ref") return fail("expected a direct column reference");
  const path = expression.path;
  if (path.length === 0 || path.length > 2)
    return fail("nested property references are unsupported");
  const column = path.length === 2 ? path[1] : path[0];
  if (column === undefined) return fail("column reference is empty");
  if (path.length === 2) {
    const aliasOrColumn = path[0];
    if (aliasOrColumn !== undefined && columns.has(aliasOrColumn) && aliasOrColumn !== column) {
      return fail("nested property references are unsupported");
    }
  }
  if (!columns.has(column)) return fail(`column ${column} is not allowlisted`);
  return Effect.succeed(column);
};

const compileExpression = (
  expression: IR.BasicExpression,
  columns: ReadonlySet<string>,
): Effect.Effect<SqlFragment, UnsupportedSubsetQuery> => {
  if (expression.type === "val") return fail("bare values are not predicates");
  if (expression.type === "ref") return fail("bare column references are not predicates");
  if (expression.type !== "func") return fail("functional predicates are unsupported");

  const name = expression.name;
  if (name === "and" || name === "or") {
    if (expression.args.length < 2) return fail(`${name} requires at least two operands`);
    return Effect.gen(function* () {
      const fragments: Array<SqlFragment> = [];
      for (const argument of expression.args) {
        fragments.push(yield* compileExpression(argument, columns));
      }
      const joiner = name === "and" ? " AND " : " OR ";
      return {
        sql: `(${fragments.map((fragment) => fragment.sql).join(joiner)})`,
        parameters: fragments.flatMap((fragment) => fragment.parameters),
      };
    });
  }

  if (name === "not") {
    const inner = expression.args[0];
    if (inner === undefined || expression.args.length !== 1) {
      return fail("not requires one operand");
    }
    return Effect.gen(function* () {
      const fragment = yield* compileExpression(inner, columns);
      return { sql: `NOT (${fragment.sql})`, parameters: fragment.parameters };
    });
  }

  if (name === "isNull") {
    const inner = expression.args[0];
    if (inner === undefined || expression.args.length !== 1) {
      return fail("isNull requires one column");
    }
    return Effect.gen(function* () {
      const column = yield* columnFromRef(inner, columns);
      return { sql: `"${column}" IS NULL`, parameters: [] };
    });
  }

  if (name === "in") {
    const field = expression.args[0];
    const values = expression.args[1];
    if (field === undefined || values === undefined || expression.args.length !== 2) {
      return fail("in requires a column and a list");
    }
    if (values.type !== "val") return fail("in requires a bounded value list");
    return Effect.gen(function* () {
      const column = yield* columnFromRef(field, columns);
      const parameters = yield* parseList(values.value);
      if (parameters.length === 0) return { sql: "0", parameters: [] };
      if (parameters.length > MAX_IN_VALUES) {
        return yield* fail("in lists more values than the indexed bound");
      }
      const placeholders = parameters.map(() => "?").join(", ");
      return { sql: `"${column}" IN (${placeholders})`, parameters };
    });
  }

  const operator = sqlComparison(name);
  if (operator !== undefined) {
    const field = expression.args[0];
    const value = expression.args[1];
    if (field === undefined || value === undefined || expression.args.length !== 2) {
      return fail(`${name} requires a column and a scalar`);
    }
    if (value.type !== "val") return fail("comparison value must be a scalar");
    return Effect.gen(function* () {
      const column = yield* columnFromRef(field, columns);
      const parameter = yield* parseScalar(value.value);
      return { sql: `"${column}" ${operator} ?`, parameters: [parameter] };
    });
  }

  return fail(`operator ${name} is not in the indexed grammar`);
};

const compileOrder = (
  orderBy: IR.OrderBy | undefined,
  columns: ReadonlySet<string>,
): Effect.Effect<string, UnsupportedSubsetQuery> => {
  if (orderBy === undefined || orderBy.length === 0) return Effect.succeed("");
  return Effect.gen(function* () {
    const clauses: Array<string> = [];
    for (const clause of orderBy) {
      const column = yield* columnFromRef(clause.expression, columns);
      const direction = clause.compareOptions.direction === "desc" ? "DESC" : "ASC";
      clauses.push(`"${column}" ${direction}`);
    }
    return ` ORDER BY ${clauses.join(", ")}`;
  });
};

export const compileSqliteSubset: CompileSqliteSubset = (descriptor, options) =>
  Effect.gen(function* () {
    const table = SOURCE_TABLE[descriptor.source];
    const filterColumns = FILTER_COLUMNS[descriptor.source];
    const orderColumns = ORDER_COLUMNS[descriptor.source];
    const predicates: Array<SqlFragment> = [];

    if (options.where) {
      predicates.push(yield* compileExpression(options.where, filterColumns));
    }
    if (options.cursor) {
      if (options.offset !== undefined) {
        return yield* fail("cursor and offset windows cannot be combined");
      }
      predicates.push(yield* compileExpression(options.cursor.whereFrom, filterColumns));
    }

    const whereSql =
      predicates.length === 0
        ? ""
        : ` WHERE ${predicates.map((predicate) => predicate.sql).join(" AND ")}`;
    const parameters = predicates.flatMap((predicate) => predicate.parameters);
    const orderSql = yield* compileOrder(options.orderBy, orderColumns);

    const history = HISTORY_SOURCES.has(descriptor.source);
    const limit = options.limit;
    if (history && (limit === undefined || limit < 1)) {
      return yield* fail("history sources require a bounded limit");
    }
    const boundedLimit = limit ?? descriptor.maximumRows;
    if (boundedLimit < 1) return yield* fail("limit must be a positive bound");
    if (boundedLimit > descriptor.maximumRows) {
      return yield* fail("limit exceeds the collection row bound");
    }
    if (options.offset !== undefined && options.offset < 0) {
      return yield* fail("offset must be zero or greater");
    }

    const offsetSql = options.offset === undefined ? "" : " OFFSET ?";
    const offsetParameters: ReadonlyArray<SqliteParameter> =
      options.offset === undefined ? [] : [options.offset];

    return {
      source: descriptor.source,
      sql: `SELECT * FROM "${table}"${whereSql}${orderSql} LIMIT ?${offsetSql}`,
      parameters: [...parameters, boundedLimit, ...offsetParameters],
      maximumRows: descriptor.maximumRows,
    };
  });
