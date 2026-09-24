import { IR } from "@tanstack/db";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { UnsupportedSubsetQuery } from "./errors";
import { FILTER_COLUMNS, HISTORY_SOURCES, MAX_IN_VALUES, ORDER_COLUMNS } from "./sources";
import { ComparisonList, ComparisonScalar } from "./sqlite-row";
import type { InventorySubsetSpec, SubsetPredicate, SubsetScalar } from "./subset-spec";
import type {
  CompileSubsetInput,
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
} from "./types";

const unsupported = (reason: string): UnsupportedSubsetQuery =>
  new UnsupportedSubsetQuery({
    message: `Unsupported subset query: ${reason}`,
    reason,
  });

const fail = (reason: string): Effect.Effect<never, UnsupportedSubsetQuery> =>
  Effect.fail(unsupported(reason));

const parseScalar = (
  value: IR.Value["value"],
): Effect.Effect<SubsetScalar, UnsupportedSubsetQuery> =>
  Schema.decodeUnknownEffect(ComparisonScalar)(value).pipe(
    Effect.mapError(() => unsupported("comparison value is not a scalar")),
    Effect.flatMap((decoded) => {
      if (decoded instanceof Uint8Array) {
        return fail("binary comparison values are unsupported");
      }
      return Effect.succeed(decoded);
    }),
  );

const parseList = (
  value: IR.Value["value"],
): Effect.Effect<ReadonlyArray<SubsetScalar>, UnsupportedSubsetQuery> =>
  Schema.decodeUnknownEffect(ComparisonList)(value).pipe(
    Effect.mapError(() => unsupported("in requires a bounded value list")),
    Effect.flatMap((decoded) => {
      const scalars: Array<SubsetScalar> = [];
      for (const entry of decoded) {
        if (entry instanceof Uint8Array) {
          return fail("binary comparison values are unsupported");
        }
        scalars.push(entry);
      }
      return Effect.succeed(scalars);
    }),
  );

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
): Effect.Effect<SubsetPredicate, UnsupportedSubsetQuery> => {
  if (expression.type === "val") return fail("bare values are not predicates");
  if (expression.type === "ref") return fail("bare column references are not predicates");
  if (expression.type !== "func") return fail("functional predicates are unsupported");

  const name = expression.name;
  if (name === "and" || name === "or") {
    if (expression.args.length < 2) return fail(`${name} requires at least two operands`);
    return Effect.gen(function* () {
      const predicates: Array<SubsetPredicate> = [];
      for (const argument of expression.args) {
        predicates.push(yield* compileExpression(argument, columns));
      }
      return { _tag: name, predicates };
    });
  }

  if (name === "not") {
    const inner = expression.args[0];
    if (inner === undefined || expression.args.length !== 1) {
      return fail("not requires one operand");
    }
    return Effect.gen(function* () {
      return { _tag: "not" as const, predicate: yield* compileExpression(inner, columns) };
    });
  }

  if (name === "isNull") {
    const inner = expression.args[0];
    if (inner === undefined || expression.args.length !== 1) {
      return fail("isNull requires one column");
    }
    return Effect.gen(function* () {
      return { _tag: "isNull" as const, column: yield* columnFromRef(inner, columns) };
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
      const list = yield* parseList(values.value);
      if (list.length > MAX_IN_VALUES) {
        return yield* fail("in lists more values than the indexed bound");
      }
      return { _tag: "in" as const, column, values: list };
    });
  }

  if (name === "eq" || name === "gt" || name === "gte" || name === "lt" || name === "lte") {
    const field = expression.args[0];
    const value = expression.args[1];
    if (field === undefined || value === undefined || expression.args.length !== 2) {
      return fail(`${name} requires a column and a scalar`);
    }
    if (value.type !== "val") return fail("comparison value must be a scalar");
    return Effect.gen(function* () {
      return {
        _tag: "compare" as const,
        column: yield* columnFromRef(field, columns),
        op: name,
        value: yield* parseScalar(value.value),
      };
    });
  }

  return fail(`operator ${name} is not in the indexed grammar`);
};

const compileOrder = (
  orderBy: IR.OrderBy | undefined,
  columns: ReadonlySet<string>,
): Effect.Effect<
  ReadonlyArray<{ readonly column: string; readonly direction: "asc" | "desc" }>,
  UnsupportedSubsetQuery
> => {
  if (orderBy === undefined || orderBy.length === 0) return Effect.succeed([]);
  return Effect.gen(function* () {
    const clauses: Array<{ column: string; direction: "asc" | "desc" }> = [];
    for (const clause of orderBy) {
      clauses.push({
        column: yield* columnFromRef(clause.expression, columns),
        direction: clause.compareOptions.direction === "desc" ? "desc" : "asc",
      });
    }
    return clauses;
  });
};

export const analyzeInventorySubset = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  options: CompileSubsetInput,
): Effect.Effect<InventorySubsetSpec, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const filterColumns = FILTER_COLUMNS[descriptor.source];
    const orderColumns = ORDER_COLUMNS[descriptor.source];
    let where: SubsetPredicate | undefined;
    if (options.where) {
      where = yield* compileExpression(options.where, filterColumns);
    }
    if (options.cursor) {
      if (options.offset !== undefined) {
        return yield* fail("cursor and offset windows cannot be combined");
      }
      const cursorWhere = yield* compileExpression(options.cursor.whereFrom, filterColumns);
      where = where ? { _tag: "and", predicates: [where, cursorWhere] } : cursorWhere;
    }
    const orderBy = yield* compileOrder(options.orderBy, orderColumns);
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
    const spec: InventorySubsetSpec = {
      source: descriptor.source,
      orderBy,
      limit: boundedLimit,
      offset: options.offset ?? 0,
    };
    return where ? { ...spec, where } : spec;
  });
