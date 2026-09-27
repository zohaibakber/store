import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

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

const SCAN_CHUNK_ROWS = 500;
const PAGE_FETCH_CONCURRENCY = 8;

const decodeStoredRow = Schema.decodeUnknownSync(IndexedDbStoredRow);

const primaryChunk = (
  api: ReplicaQueryBuilder,
  table: IndexedDbEntityTable,
  generation: number,
  after: Option.Option<string>,
) => {
  const lower: [number] | [number, string] = Option.match(after, {
    onNone: () => [generation],
    onSome: (id) => [generation, id],
  });
  const upper: [number, []] = [generation, []];
  const range = { excludeLowerBound: Option.isSome(after) };
  switch (table) {
    case "categories":
      return api.from("categories").select().between(lower, upper, range).limit(SCAN_CHUNK_ROWS);
    case "products":
      return api.from("products").select().between(lower, upper, range).limit(SCAN_CHUNK_ROWS);
    case "batches":
      return api.from("batches").select().between(lower, upper, range).limit(SCAN_CHUNK_ROWS);
    case "invoices":
      return api.from("invoices").select().between(lower, upper, range).limit(SCAN_CHUNK_ROWS);
    case "invoice_items":
      return api.from("invoice_items").select().between(lower, upper, range).limit(SCAN_CHUNK_ROWS);
    case "stock_movements":
      return api
        .from("stock_movements")
        .select()
        .between(lower, upper, range)
        .limit(SCAN_CHUNK_ROWS);
  }
};

const primaryKeysetRows = (
  api: ReplicaQueryBuilder,
  table: IndexedDbEntityTable,
  generation: number,
) =>
  Stream.paginate(Option.none<string>(), (after) =>
    primaryChunk(api, table, generation, after).pipe(
      Effect.map((raw) => {
        const rows = raw.map((row) => decodeStoredRow(row));
        const last = rows.at(-1);
        const next =
          rows.length < SCAN_CHUNK_ROWS || last === undefined
            ? Option.none()
            : Option.some(Option.some(stringifyCell(cell(last, "id") ?? null)));
        return [rows, next] as const;
      }),
    ),
  );

const matchingRows = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
  order: "scan" | "any",
) =>
  Stream.filter(
    order === "any" && plan.scan._tag === "generationPrefix"
      ? primaryKeysetRows(api, plan.table, generation)
      : Stream.map(
          selectRows(api, plan, generation).stream({ chunkSize: SCAN_CHUNK_ROWS }),
          (row) => decodeStoredRow(row),
        ),
    (row) => matchesResidual(row, plan.residual),
  );

type SortEntry = {
  readonly id: string;
  readonly keys: ReadonlyArray<IndexedDbCellValue | undefined>;
};

const compareEntries =
  (orderBy: IndexedDbSubsetPlan["orderBy"]) =>
  (left: SortEntry, right: SortEntry): number => {
    for (const [index, clause] of orderBy.entries()) {
      const ranking = compareValues(left.keys[index], right.keys[index]);
      if (ranking !== 0) return clause.direction === "desc" ? -ranking : ranking;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };

const insertBounded = (
  entries: Array<SortEntry>,
  entry: SortEntry,
  capacity: number,
  compare: (left: SortEntry, right: SortEntry) => number,
) => {
  const last = entries.at(-1);
  if (entries.length >= capacity && last !== undefined && compare(entry, last) >= 0) {
    return entries;
  }
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const pivot = entries[middle];
    if (pivot !== undefined && compare(pivot, entry) <= 0) low = middle + 1;
    else high = middle;
  }
  entries.splice(low, 0, entry);
  if (entries.length > capacity) entries.pop();
  return entries;
};

const rowById =
  (api: ReplicaQueryBuilder, generation: number, plan: IndexedDbSubsetPlan) => (id: string) =>
    selectRows(api, { ...plan, scan: { _tag: "primaryEquals", id } }, generation).pipe(
      Effect.map((rows) => rows.map((row) => decodeStoredRow(row))),
    );

const sortedPage = (api: ReplicaQueryBuilder, generation: number, plan: IndexedDbSubsetPlan) =>
  Effect.gen(function* () {
    const compare = compareEntries(plan.orderBy);
    const capacity = plan.offset + plan.limit;
    const leaders = yield* Stream.runFold(
      matchingRows(api, generation, plan, "any"),
      (): Array<SortEntry> => [],
      (entries, row) =>
        insertBounded(
          entries,
          {
            id: stringifyCell(cell(row, "id") ?? null),
            keys: plan.orderBy.map((clause) => cell(row, clause.column)),
          },
          capacity,
          compare,
        ),
    );
    const rows = yield* Effect.forEach(
      leaders.slice(plan.offset).map((entry) => entry.id),
      rowById(api, generation, plan),
      { concurrency: PAGE_FETCH_CONCURRENCY },
    );
    return rows.flat();
  });

export const executeIndexedDbSubset = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
): Effect.Effect<ReadonlyArray<IndexedDbSubsetRow>, unknown> =>
  (orderMatchesScan(plan)
    ? Stream.runCollect(
        Stream.take(
          Stream.drop(matchingRows(api, generation, plan, "scan"), plan.offset),
          plan.limit,
        ),
      )
    : sortedPage(api, generation, plan)
  ).pipe(Effect.map((rows) => Array.from(rows, stripGeneration)));

export type IndexedDbSubsetSummary = {
  readonly count: number;
  readonly distinct: ReadonlyArray<{
    readonly column: string;
    readonly values: ReadonlyArray<string>;
  }>;
};

const countGeneration = (
  api: ReplicaQueryBuilder,
  table: IndexedDbEntityTable,
  generation: number,
) => {
  const [lower, upper] = generationBounds(generation);
  switch (table) {
    case "categories":
      return api.from("categories").count().between(lower, upper);
    case "products":
      return api.from("products").count().between(lower, upper);
    case "batches":
      return api.from("batches").count().between(lower, upper);
    case "invoices":
      return api.from("invoices").count().between(lower, upper);
    case "invoice_items":
      return api.from("invoice_items").count().between(lower, upper);
    case "stock_movements":
      return api.from("stock_movements").count().between(lower, upper);
  }
};

export const summarizeIndexedDbSubset = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
  distinct: ReadonlyArray<string>,
  maximumValues: number,
): Effect.Effect<IndexedDbSubsetSummary, unknown> =>
  distinct.length === 0 && plan.residual === undefined && plan.scan._tag === "generationPrefix"
    ? countGeneration(api, plan.table, generation).pipe(
        Effect.map((count) => ({ count, distinct: [] })),
      )
    : Stream.runFold(
        matchingRows(api, generation, plan, "any"),
        () => ({ count: 0, values: distinct.map(() => new Map<string, string>()) }),
        (summary, row) => {
          summary.count += 1;
          for (const [index, column] of distinct.entries()) {
            const value = cell(row, column);
            const text = value === null || value === undefined ? "" : stringifyCell(value).trim();
            if (text === "") continue;
            const values = summary.values[index];
            const key = text.toLowerCase();
            const existing = values?.get(key);
            if (existing === undefined || text < existing) values?.set(key, text);
          }
          return summary;
        },
      ).pipe(
        Effect.map((summary) => ({
          count: summary.count,
          distinct: distinct.map((column, index) => ({
            column,
            values: [...(summary.values[index]?.values() ?? [])]
              .sort((left, right) => left.localeCompare(right))
              .slice(0, maximumValues),
          })),
        })),
      );
