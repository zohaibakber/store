import * as Effect from "effect/Effect";

import { analyzeInventorySubset, type SubsetPredicate, type SubsetScalar } from "./subset-ir";
import type { CompileSqliteSubset, SqliteParameter } from "./types";

type CompiledPredicateSql = {
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

const compilePredicate = (predicate: SubsetPredicate): CompiledPredicateSql => {
  switch (predicate._tag) {
    case "and":
    case "or": {
      const fragments = predicate.predicates.map(compilePredicate);
      const joiner = predicate._tag === "and" ? " AND " : " OR ";
      return {
        sql: `(${fragments.map((fragment) => fragment.sql).join(joiner)})`,
        parameters: fragments.flatMap((fragment) => fragment.parameters),
      };
    }
    case "not": {
      const inner = compilePredicate(predicate.predicate);
      return { sql: `NOT (${inner.sql})`, parameters: inner.parameters };
    }
    case "isNull":
      return { sql: `"${predicate.column}" IS NULL`, parameters: [] };
    case "in": {
      if (predicate.values.length === 0) return { sql: "0", parameters: [] };
      const parameters = predicate.values.map(toSqliteParameter);
      return {
        sql: `"${predicate.column}" IN (${parameters.map(() => "?").join(", ")})`,
        parameters,
      };
    }
    case "compare": {
      const operator =
        predicate.op === "eq"
          ? "="
          : predicate.op === "gt"
            ? ">"
            : predicate.op === "gte"
              ? ">="
              : predicate.op === "lt"
                ? "<"
                : "<=";
      return {
        sql: `"${predicate.column}" ${operator} ?`,
        parameters: [toSqliteParameter(predicate.value)],
      };
    }
  }
};

export const compileSqliteSubset: CompileSqliteSubset = (descriptor, options) =>
  Effect.gen(function* () {
    const spec = yield* analyzeInventorySubset(descriptor, options);
    const where = spec.where ? compilePredicate(spec.where) : undefined;
    const whereSql = where ? ` WHERE ${where.sql}` : "";
    const orderSql =
      spec.orderBy.length === 0
        ? ""
        : ` ORDER BY ${spec.orderBy
            .map((clause) => `"${clause.column}" ${clause.direction === "desc" ? "DESC" : "ASC"}`)
            .join(", ")}`;
    const offsetSql = spec.offset > 0 ? " OFFSET ?" : "";
    const offsetParameters: ReadonlyArray<SqliteParameter> = spec.offset > 0 ? [spec.offset] : [];
    return {
      source: descriptor.source,
      sql: `SELECT * FROM "${spec.table}"${whereSql}${orderSql} LIMIT ?${offsetSql}`,
      parameters: [...(where?.parameters ?? []), spec.limit, ...offsetParameters],
      maximumRows: descriptor.maximumRows,
    };
  });

export { analyzeInventorySubset } from "./subset-ir";
export type { InventorySubsetSpec, SubsetPredicate, SubsetScalar } from "./subset-ir";
