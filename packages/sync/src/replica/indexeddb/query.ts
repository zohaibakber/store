import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ReplicaQueryBuilder } from "./schema";

export type IndexedDbEntityTable =
  | "categories"
  | "products"
  | "batches"
  | "invoices"
  | "invoice_items"
  | "stock_movements";

export type IndexedDbScan =
  | { readonly _tag: "primaryEquals"; readonly id: string }
  | {
      readonly _tag: "indexEquals";
      readonly index:
        | "byName"
        | "byCategory"
        | "byProduct"
        | "byCreatedAt"
        | "byOperation"
        | "byInvoice";
      readonly value: string | number;
    }
  | {
      readonly _tag: "indexPrefix";
      readonly index:
        | "byCreatedAt"
        | "byName"
        | "byCategory"
        | "byProduct"
        | "byOperation"
        | "byInvoice";
      readonly reverse: boolean;
    }
  | { readonly _tag: "generationPrefix"; readonly reverse: boolean };

export type IndexedDbResidualPredicate =
  | {
      readonly _tag: "compare";
      readonly column: string;
      readonly op: "eq" | "gt" | "gte" | "lt" | "lte";
      readonly value: string | number | boolean | null;
    }
  | {
      readonly _tag: "in";
      readonly column: string;
      readonly values: ReadonlyArray<string | number | boolean | null>;
    }
  | { readonly _tag: "isNull"; readonly column: string }
  | { readonly _tag: "like"; readonly column: string; readonly pattern: string }
  | {
      readonly _tag: "and";
      readonly predicates: ReadonlyArray<IndexedDbResidualPredicate>;
    }
  | {
      readonly _tag: "or";
      readonly predicates: ReadonlyArray<IndexedDbResidualPredicate>;
    }
  | { readonly _tag: "not"; readonly predicate: IndexedDbResidualPredicate };

export type IndexedDbSubsetPlan = {
  readonly table: IndexedDbEntityTable;
  readonly scan: IndexedDbScan;
  readonly residual: IndexedDbResidualPredicate | undefined;
  readonly orderBy: ReadonlyArray<{
    readonly column: string;
    readonly direction: "asc" | "desc";
  }>;
  readonly limit: number;
  readonly offset: number;
};

const IndexedDbCellValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
type IndexedDbCellValue = typeof IndexedDbCellValue.Type;

export type IndexedDbSubsetRow = {
  readonly [column: string]: IndexedDbCellValue;
};

const decodeNumber = Schema.decodeUnknownOption(Schema.Number);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);

const cell = (row: IndexedDbSubsetRow, column: string): IndexedDbCellValue | undefined =>
  Object.hasOwn(row, column) ? row[column] : undefined;

const stringifyCell = (value: IndexedDbCellValue): string => {
  const asString = decodeString(value);
  if (Option.isSome(asString)) return asString.value;
  const asNumber = decodeNumber(value);
  if (Option.isSome(asNumber)) return `${asNumber.value}`;
  const asBoolean = decodeBoolean(value);
  if (Option.isSome(asBoolean)) return asBoolean.value ? "true" : "false";
  return "";
};

const compareValues = (
  left: IndexedDbCellValue | undefined,
  right: IndexedDbCellValue | undefined,
): number => {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  const leftNumber = decodeNumber(left);
  const rightNumber = decodeNumber(right);
  if (Option.isSome(leftNumber) && Option.isSome(rightNumber)) {
    return leftNumber.value - rightNumber.value;
  }
  return stringifyCell(left).localeCompare(stringifyCell(right));
};

const matchesCompare = (
  actual: IndexedDbCellValue | undefined,
  op: "eq" | "gt" | "gte" | "lt" | "lte",
  expected: IndexedDbCellValue,
): boolean => {
  const ranking = compareValues(actual, expected);
  switch (op) {
    case "eq":
      return ranking === 0;
    case "gt":
      return ranking > 0;
    case "gte":
      return ranking >= 0;
    case "lt":
      return ranking < 0;
    case "lte":
      return ranking <= 0;
  }
};

const foldAsciiCase = (value: string): string =>
  value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\/]/u;

const likeExpression = (pattern: string): RegExp => {
  let source = "";
  for (const character of foldAsciiCase(pattern)) {
    if (character === "%") source += "[\\s\\S]*";
    else if (character === "_") source += "[\\s\\S]";
    else source += REGEXP_SPECIALS.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${source}$`, "u");
};

const likeExpressions = new Map<string, RegExp>();

const likeExpressionFor = (pattern: string): RegExp => {
  const cached = likeExpressions.get(pattern);
  if (cached) return cached;
  const compiled = likeExpression(pattern);
  if (likeExpressions.size >= 64) likeExpressions.clear();
  likeExpressions.set(pattern, compiled);
  return compiled;
};

const matchesLike = (value: IndexedDbCellValue | undefined, pattern: string): boolean => {
  if (value === null || value === undefined) return false;
  return likeExpressionFor(pattern).test(foldAsciiCase(stringifyCell(value)));
};

const matchesResidual = (
  row: IndexedDbSubsetRow,
  predicate: IndexedDbResidualPredicate | undefined,
): boolean => {
  if (!predicate) return true;
  switch (predicate._tag) {
    case "compare":
      return matchesCompare(cell(row, predicate.column), predicate.op, predicate.value);
    case "in":
      return predicate.values.some(
        (value) => compareValues(cell(row, predicate.column), value) === 0,
      );
    case "isNull":
      return cell(row, predicate.column) === null || cell(row, predicate.column) === undefined;
    case "like":
      return matchesLike(cell(row, predicate.column), predicate.pattern);
    case "and":
      return predicate.predicates.every((part) => matchesResidual(row, part));
    case "or":
      return predicate.predicates.some((part) => matchesResidual(row, part));
    case "not":
      return !matchesResidual(row, predicate.predicate);
  }
};

const IndexedDbStoredRow = Schema.Record(Schema.String, IndexedDbCellValue);
type IndexedDbStoredRow = typeof IndexedDbStoredRow.Type;

const stripGeneration = (row: IndexedDbStoredRow) => {
  const entries: Array<[string, IndexedDbCellValue]> = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === "generation") continue;
    entries.push([key, value]);
  }
  return Object.fromEntries(entries) satisfies IndexedDbSubsetRow;
};

export const generationBounds = (generation: number): [[number], [number, []]] => [
  [generation],
  [generation, []],
];

const selectRows = (api: ReplicaQueryBuilder, plan: IndexedDbSubsetPlan, generation: number) => {
  const [lower, upper] = generationBounds(generation);
  const table = plan.table;
  const scan = plan.scan;

  const fromPrimary = () => {
    switch (table) {
      case "categories":
        return api.from("categories").select();
      case "products":
        return api.from("products").select();
      case "batches":
        return api.from("batches").select();
      case "invoices":
        return api.from("invoices").select();
      case "invoice_items":
        return api.from("invoice_items").select();
      case "stock_movements":
        return api.from("stock_movements").select();
    }
  };

  if (scan._tag === "primaryEquals") {
    return fromPrimary().equals([generation, scan.id]);
  }

  if (scan._tag === "indexEquals") {
    switch (table) {
      case "categories":
        if (scan.index === "byName") {
          return api
            .from("categories")
            .select("byName")
            .equals([generation, String(scan.value)]);
        }
        break;
      case "products":
        if (scan.index === "byCategory") {
          return api
            .from("products")
            .select("byCategory")
            .equals([generation, String(scan.value)]);
        }
        break;
      case "batches":
        if (scan.index === "byProduct") {
          return api
            .from("batches")
            .select("byProduct")
            .equals([generation, String(scan.value)]);
        }
        break;
      case "invoices":
        if (scan.index === "byOperation") {
          return api
            .from("invoices")
            .select("byOperation")
            .equals([generation, String(scan.value)]);
        }
        if (scan.index === "byCreatedAt") {
          return api
            .from("invoices")
            .select("byCreatedAt")
            .equals([generation, Number(scan.value)]);
        }
        break;
      case "invoice_items":
        if (scan.index === "byInvoice") {
          return api
            .from("invoice_items")
            .select("byInvoice")
            .equals([generation, String(scan.value)]);
        }
        break;
      case "stock_movements":
        if (scan.index === "byProduct") {
          return api
            .from("stock_movements")
            .select("byProduct")
            .equals([generation, String(scan.value)]);
        }
        break;
    }
  }

  if (scan._tag === "indexPrefix") {
    switch (table) {
      case "categories": {
        const query = api.from("categories").select("byName").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "products": {
        const query = api.from("products").select("byCategory").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "batches": {
        const query = api.from("batches").select("byProduct").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "invoices": {
        const query =
          scan.index === "byCreatedAt"
            ? api.from("invoices").select("byCreatedAt").between(lower, upper)
            : api.from("invoices").select("byOperation").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "invoice_items": {
        const query = api.from("invoice_items").select("byInvoice").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "stock_movements": {
        const query = api.from("stock_movements").select("byProduct").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
    }
  }

  const prefix = fromPrimary().between(lower, upper);
  return scan._tag === "generationPrefix" && scan.reverse ? prefix.reverse() : prefix;
};

const orderMatchesScan = (plan: IndexedDbSubsetPlan): boolean => {
  if (plan.orderBy.length !== 1) return plan.orderBy.length === 0;
  const clause = plan.orderBy[0];
  if (!clause) return true;
  if (plan.scan._tag === "indexPrefix") {
    if (plan.scan.index === "byCreatedAt" && clause.column === "createdAt") {
      return (clause.direction === "desc") === plan.scan.reverse;
    }
    if (plan.scan.index === "byName" && clause.column === "name") {
      return (clause.direction === "desc") === plan.scan.reverse;
    }
  }
  if (plan.scan._tag === "generationPrefix" && clause.column === "id") {
    return (clause.direction === "desc") === plan.scan.reverse;
  }
  return false;
};

export const executeIndexedDbSubset = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
): Effect.Effect<ReadonlyArray<IndexedDbSubsetRow>, unknown> =>
  Effect.gen(function* () {
    const raw = yield* selectRows(api, plan, generation);
    const rows = raw.map((row) => Schema.decodeUnknownSync(IndexedDbStoredRow)(row));
    const filtered = rows.filter((row) => matchesResidual(row, plan.residual));
    const ordered = orderMatchesScan(plan)
      ? filtered
      : [...filtered].sort((left, right) => {
          for (const clause of plan.orderBy) {
            const ranking = compareValues(cell(left, clause.column), cell(right, clause.column));
            if (ranking !== 0) return clause.direction === "desc" ? -ranking : ranking;
          }
          return compareValues(cell(left, "id"), cell(right, "id"));
        });
    const paged = ordered.slice(plan.offset, plan.offset + plan.limit);
    return paged.map(stripGeneration);
  });
