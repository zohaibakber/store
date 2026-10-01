import type { SyncEntity } from "@store/contracts";
import type { PurchaseOrderStatus } from "@store/contracts/catalog-write";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { foldAsciiCase, type EntityStore, type ReplicaQueryBuilder } from "./schema";

export type IndexedDbEntityTable = EntityStore<SyncEntity>;

type IndexedDbIndexName = Extract<IndexedDbScan, { readonly _tag: "indexPrefix" }>["index"];

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
        | "byInvoice"
        | "bySupplier"
        | "byOrderNumber"
        | "byPurchaseOrder";
      readonly value: string | number;
    }
  | {
      readonly _tag: "indexPrefix";
      readonly index:
        | "byCreatedAt"
        | "byName"
        | "byNameKey"
        | "byCategory"
        | "byProduct"
        | "byOperation"
        | "byInvoice"
        | "bySupplier"
        | "byOrderNumber"
        | "byPurchaseOrder";
      readonly reverse: boolean;
    }
  | {
      readonly _tag: "indexEqualsOrdered";
      readonly index: "byCategoryName";
      readonly value: string;
      readonly reverse: boolean;
    }
  | {
      readonly _tag: "indexEqualsOrdered";
      readonly index: "byStatusCreatedAt";
      readonly value: PurchaseOrderStatus;
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
  | {
      readonly _tag: "like";
      readonly column: string;
      readonly pattern: string;
      readonly escape?: string;
    }
  | {
      readonly _tag: "and";
      readonly predicates: ReadonlyArray<IndexedDbResidualPredicate>;
    }
  | {
      readonly _tag: "or";
      readonly predicates: ReadonlyArray<IndexedDbResidualPredicate>;
    }
  | { readonly _tag: "not"; readonly predicate: IndexedDbResidualPredicate };

export type IndexedDbOrderClause = {
  readonly column: string;
  readonly direction: "asc" | "desc";
  readonly nulls: "first" | "last";
  readonly collation: "binary" | "nocase";
};

export type IndexedDbSubsetPlan = {
  readonly table: IndexedDbEntityTable;
  readonly scan: IndexedDbScan;
  readonly residual: IndexedDbResidualPredicate | undefined;
  readonly orderBy: ReadonlyArray<IndexedDbOrderClause>;
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
  return compareCodeUnits(stringifyCell(left), stringifyCell(right));
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const collated = (
  value: IndexedDbCellValue | undefined,
  collation: IndexedDbOrderClause["collation"],
): IndexedDbCellValue | undefined => {
  if (collation !== "nocase") return value;
  const text = decodeString(value);
  return Option.isSome(text) ? foldAsciiCase(text.value) : value;
};

const compareOrdered = (
  left: IndexedDbCellValue | undefined,
  right: IndexedDbCellValue | undefined,
  clause: IndexedDbOrderClause,
): number => {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing === (clause.nulls === "first") ? -1 : 1;
  }
  const ranking = compareValues(
    collated(left, clause.collation),
    collated(right, clause.collation),
  );
  return clause.direction === "desc" ? -ranking : ranking;
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

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\/]/u;

const NEVER_MATCHES = /(?!)/u;

const likeExpression = (pattern: string, escape: string | undefined): RegExp => {
  let source = "";
  let literal = false;
  for (const character of foldAsciiCase(pattern)) {
    if (!literal && character === escape) {
      literal = true;
      continue;
    }
    if (!literal && character === "%") source += "[\\s\\S]*";
    else if (!literal && character === "_") source += "[\\s\\S]";
    else source += REGEXP_SPECIALS.test(character) ? `\\${character}` : character;
    literal = false;
  }
  return literal ? NEVER_MATCHES : new RegExp(`^${source}$`, "u");
};

const likeExpressions = new Map<string, RegExp>();

const likeExpressionFor = (pattern: string, escape: string | undefined): RegExp => {
  const key = escape === undefined ? `-${pattern}` : `+${escape}${pattern}`;
  const cached = likeExpressions.get(key);
  if (cached) return cached;
  const compiled = likeExpression(pattern, escape);
  if (likeExpressions.size >= 64) likeExpressions.clear();
  likeExpressions.set(key, compiled);
  return compiled;
};

const matchesLike = (
  value: IndexedDbCellValue | undefined,
  pattern: string,
  escape: string | undefined,
): boolean => {
  if (value === null || value === undefined) return false;
  return likeExpressionFor(pattern, escape).test(foldAsciiCase(stringifyCell(value)));
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
      return matchesLike(cell(row, predicate.column), predicate.pattern, predicate.escape);
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

const HIDDEN_COLUMNS: ReadonlySet<string> = new Set(["generation", "nameKey"]);

const stripGeneration = (row: IndexedDbStoredRow) => {
  const entries: Array<[string, IndexedDbCellValue]> = [];
  for (const [key, value] of Object.entries(row)) {
    if (HIDDEN_COLUMNS.has(key)) continue;
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

  const fromPrimary = () => api.from(table).select();

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
      case "suppliers":
        if (scan.index === "byName") {
          return api
            .from("suppliers")
            .select("byName")
            .equals([generation, String(scan.value)]);
        }
        break;
      case "purchase_orders":
        if (scan.index === "bySupplier") {
          return api
            .from("purchase_orders")
            .select("bySupplier")
            .equals([generation, String(scan.value)]);
        }
        if (scan.index === "byOrderNumber") {
          return api
            .from("purchase_orders")
            .select("byOrderNumber")
            .equals([generation, Number(scan.value)]);
        }
        break;
      case "purchase_order_items":
        if (scan.index === "byPurchaseOrder") {
          return api
            .from("purchase_order_items")
            .select("byPurchaseOrder")
            .equals([generation, String(scan.value)]);
        }
        if (scan.index === "byProduct") {
          return api
            .from("purchase_order_items")
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
        const query =
          scan.index === "byNameKey"
            ? api.from("products").select("byNameKey").between(lower, upper)
            : api.from("products").select("byCategory").between(lower, upper);
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
      case "suppliers": {
        const query = api.from("suppliers").select("byName").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "purchase_orders": {
        const query =
          scan.index === "byOrderNumber"
            ? api.from("purchase_orders").select("byOrderNumber").between(lower, upper)
            : api.from("purchase_orders").select("bySupplier").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
      case "purchase_order_items": {
        const query =
          scan.index === "byProduct"
            ? api.from("purchase_order_items").select("byProduct").between(lower, upper)
            : api.from("purchase_order_items").select("byPurchaseOrder").between(lower, upper);
        return scan.reverse ? query.reverse() : query;
      }
    }
  }

  if (scan._tag === "indexEqualsOrdered") {
    switch (scan.index) {
      case "byCategoryName": {
        const query = api
          .from("products")
          .select("byCategoryName")
          .between([generation, scan.value], [generation, scan.value, []]);
        return scan.reverse ? query.reverse() : query;
      }
      case "byStatusCreatedAt": {
        const query = api
          .from("purchase_orders")
          .select("byStatusCreatedAt")
          .between([generation, scan.value], [generation, scan.value, []]);
        return scan.reverse ? query.reverse() : query;
      }
    }
  }

  const prefix = fromPrimary().between(lower, upper);
  return scan._tag === "generationPrefix" && scan.reverse ? prefix.reverse() : prefix;
};

const indexOrder = (
  index: IndexedDbIndexName,
): { readonly column: string; readonly collation?: "binary" | "nocase" } | undefined => {
  switch (index) {
    case "byCreatedAt":
      return { column: "createdAt" };
    case "byName":
      return { column: "name", collation: "binary" };
    case "byNameKey":
      return { column: "name", collation: "nocase" };
    case "byOrderNumber":
      return { column: "orderNumber" };
    case "byCategory":
    case "byProduct":
    case "byOperation":
    case "byInvoice":
    case "bySupplier":
    case "byPurchaseOrder":
      return undefined;
  }
};

const orderMatchesScan = (plan: IndexedDbSubsetPlan): boolean => {
  const [first, tieBreak, ...rest] = plan.orderBy;
  if (first === undefined) return true;
  if (rest.length > 0) return false;
  if (
    tieBreak !== undefined &&
    (tieBreak.column !== "id" ||
      tieBreak.direction !== first.direction ||
      tieBreak.collation === "nocase")
  ) {
    return false;
  }
  const descending = first.direction === "desc";
  const collation = first.collation;
  switch (plan.scan._tag) {
    case "indexPrefix": {
      const order = indexOrder(plan.scan.index);
      return (
        order !== undefined &&
        order.column === first.column &&
        (order.collation === undefined || order.collation === collation) &&
        descending === plan.scan.reverse
      );
    }
    case "indexEqualsOrdered":
      switch (plan.scan.index) {
        case "byCategoryName":
          return (
            first.column === "name" && collation === "nocase" && descending === plan.scan.reverse
          );
        case "byStatusCreatedAt":
          return first.column === "createdAt" && descending === plan.scan.reverse;
      }
    case "generationPrefix":
      return first.column === "id" && collation === "binary" && descending === plan.scan.reverse;
    case "primaryEquals":
    case "indexEquals":
      return false;
  }
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
  return api
    .from(table)
    .select()
    .between(lower, upper, { excludeLowerBound: Option.isSome(after) })
    .limit(SCAN_CHUNK_ROWS);
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

type IndexCursor = {
  readonly key: Option.Option<IndexedDbCellValue>;
  readonly seen: number;
};

const keyedBounds = <Key>(
  generation: number,
  key: Option.Option<Key>,
  reverse: boolean,
): { readonly lower: [number] | [number, Key]; readonly upper: [number, []] | [number, Key] } =>
  Option.match(key, {
    onNone: () => ({ lower: [generation], upper: [generation, []] }),
    onSome: (value) =>
      reverse
        ? { lower: [generation], upper: [generation, value] }
        : { lower: [generation, value], upper: [generation, []] },
  });

const categoryNameBounds = (
  generation: number,
  categoryId: string,
  key: Option.Option<string>,
  reverse: boolean,
): {
  readonly lower: [number, string] | [number, string, string];
  readonly upper: [number, string, []] | [number, string, string];
} =>
  Option.match(key, {
    onNone: () => ({ lower: [generation, categoryId], upper: [generation, categoryId, []] }),
    onSome: (value) =>
      reverse
        ? { lower: [generation, categoryId], upper: [generation, categoryId, value] }
        : { lower: [generation, categoryId, value], upper: [generation, categoryId, []] },
  });

type KeysetScan =
  | {
      readonly _tag: "indexPrefix";
      readonly index: "byName" | "byNameKey" | "byCreatedAt";
      readonly reverse: boolean;
    }
  | Extract<
      IndexedDbScan,
      { readonly _tag: "indexEqualsOrdered"; readonly index: "byCategoryName" }
    >;

const orderedIndexChunk = (
  api: ReplicaQueryBuilder,
  generation: number,
  scan: KeysetScan,
  cursor: IndexCursor,
) => {
  const limit = SCAN_CHUNK_ROWS + cursor.seen;
  const text = Option.flatMap(cursor.key, decodeString);
  if (scan._tag === "indexEqualsOrdered") {
    const { lower, upper } = categoryNameBounds(generation, scan.value, text, scan.reverse);
    const query = api.from("products").select("byCategoryName").between(lower, upper);
    return (scan.reverse ? query.reverse() : query).limit(limit);
  }
  switch (scan.index) {
    case "byName": {
      const { lower, upper } = keyedBounds(generation, text, scan.reverse);
      const query = api.from("categories").select("byName").between(lower, upper);
      return (scan.reverse ? query.reverse() : query).limit(limit);
    }
    case "byNameKey": {
      const { lower, upper } = keyedBounds(generation, text, scan.reverse);
      const query = api.from("products").select("byNameKey").between(lower, upper);
      return (scan.reverse ? query.reverse() : query).limit(limit);
    }
    case "byCreatedAt": {
      const { lower, upper } = keyedBounds(
        generation,
        Option.flatMap(cursor.key, decodeNumber),
        scan.reverse,
      );
      const query = api.from("invoices").select("byCreatedAt").between(lower, upper);
      return (scan.reverse ? query.reverse() : query).limit(limit);
    }
  }
};

const keyFieldOf = (scan: KeysetScan) => {
  if (scan._tag === "indexEqualsOrdered") return "nameKey";
  switch (scan.index) {
    case "byName":
      return "name";
    case "byNameKey":
      return "nameKey";
    case "byCreatedAt":
      return "createdAt";
  }
};

const indexKeysetRows = (api: ReplicaQueryBuilder, generation: number, scan: KeysetScan) => {
  const field = keyFieldOf(scan);
  return Stream.paginate<IndexCursor, IndexedDbStoredRow, unknown>(
    { key: Option.none(), seen: 0 },
    (cursor) =>
      orderedIndexChunk(api, generation, scan, cursor).pipe(
        Effect.map((raw) => {
          const rows = raw.slice(cursor.seen).map((row) => decodeStoredRow(row));
          const last = rows.at(-1);
          if (rows.length < SCAN_CHUNK_ROWS || last === undefined) {
            return [rows, Option.none()] as const;
          }
          const key = cell(last, field) ?? null;
          const repeated = rows.filter((row) => cell(row, field) === key).length;
          const carried = Option.contains(cursor.key, key) ? cursor.seen : 0;
          return [rows, Option.some({ key: Option.some(key), seen: carried + repeated })] as const;
        }),
      ),
  );
};

const keysetScan = (
  table: IndexedDbEntityTable,
  scan: IndexedDbScan,
  order: "scan" | "any",
): KeysetScan | undefined => {
  switch (scan._tag) {
    case "indexEqualsOrdered":
      return scan.index === "byCategoryName" ? scan : undefined;
    case "indexEquals":
      return order === "any" && table === "products" && scan.index === "byCategory"
        ? {
            _tag: "indexEqualsOrdered",
            index: "byCategoryName",
            value: String(scan.value),
            reverse: false,
          }
        : undefined;
    case "indexPrefix":
      switch (scan.index) {
        case "byName":
          return table === "categories"
            ? { _tag: "indexPrefix", index: scan.index, reverse: scan.reverse }
            : undefined;
        case "byNameKey":
        case "byCreatedAt":
          return { _tag: "indexPrefix", index: scan.index, reverse: scan.reverse };
        case "byCategory":
        case "byProduct":
        case "byOperation":
        case "byInvoice":
        case "bySupplier":
        case "byOrderNumber":
        case "byPurchaseOrder":
          return undefined;
      }
    case "primaryEquals":
    case "generationPrefix":
      return undefined;
  }
};

const scannedRows = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
  order: "scan" | "any",
) => {
  const keyset = keysetScan(plan.table, plan.scan, order);
  if (keyset !== undefined) return indexKeysetRows(api, generation, keyset);
  if (plan.scan._tag === "generationPrefix" && (order === "any" || !plan.scan.reverse)) {
    return primaryKeysetRows(api, plan.table, generation);
  }
  return Stream.map(
    selectRows(api, plan, generation).stream({ chunkSize: SCAN_CHUNK_ROWS }),
    (row) => decodeStoredRow(row),
  );
};

const matchingRows = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
  order: "scan" | "any",
) =>
  Stream.filter(scannedRows(api, generation, plan, order), (row) =>
    matchesResidual(row, plan.residual),
  );

type SortEntry = {
  readonly id: string;
  readonly keys: ReadonlyArray<IndexedDbCellValue | undefined>;
};

const compareEntries =
  (orderBy: IndexedDbSubsetPlan["orderBy"]) =>
  (left: SortEntry, right: SortEntry): number => {
    for (const [index, clause] of orderBy.entries()) {
      const ranking = compareOrdered(left.keys[index], right.keys[index], clause);
      if (ranking !== 0) return ranking;
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

const scanPage = (api: ReplicaQueryBuilder, generation: number, plan: IndexedDbSubsetPlan) =>
  plan.residual === undefined
    ? selectRows(api, plan, generation)
        .offset(plan.offset)
        .limit(plan.limit)
        .pipe(Effect.map((rows) => rows.map((row) => decodeStoredRow(row))))
    : Stream.runCollect(
        Stream.take(
          Stream.drop(matchingRows(api, generation, plan, "scan"), plan.offset),
          plan.limit,
        ),
      );

export const executeIndexedDbSubset = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
): Effect.Effect<ReadonlyArray<IndexedDbSubsetRow>, unknown> =>
  (orderMatchesScan(plan)
    ? scanPage(api, generation, plan)
    : sortedPage(api, generation, plan)
  ).pipe(Effect.map((rows) => Array.from(rows, stripGeneration)));

export type IndexedDbSubsetSummary = {
  readonly count: number;
  readonly distinct: ReadonlyArray<{
    readonly column: string;
    readonly values: ReadonlyArray<string>;
  }>;
};

const countCategory = (api: ReplicaQueryBuilder, generation: number, categoryId: string) =>
  api.from("products").count("byCategory").equals([generation, categoryId]);

const nativeCount = (api: ReplicaQueryBuilder, generation: number, plan: IndexedDbSubsetPlan) => {
  if (plan.residual !== undefined) return undefined;
  switch (plan.scan._tag) {
    case "generationPrefix":
      return countGeneration(api, plan.table, generation);
    case "indexEquals":
      return plan.table === "products" && plan.scan.index === "byCategory"
        ? countCategory(api, generation, String(plan.scan.value))
        : undefined;
    case "indexEqualsOrdered":
      return plan.scan.index === "byCategoryName"
        ? countCategory(api, generation, plan.scan.value)
        : undefined;
    case "primaryEquals":
    case "indexPrefix":
      return undefined;
  }
};

const countGeneration = (
  api: ReplicaQueryBuilder,
  table: IndexedDbEntityTable,
  generation: number,
) => {
  const [lower, upper] = generationBounds(generation);
  return api.from(table).count().between(lower, upper);
};

export const summarizeIndexedDbSubset = (
  api: ReplicaQueryBuilder,
  generation: number,
  plan: IndexedDbSubsetPlan,
  distinct: ReadonlyArray<string>,
  maximumValues: number,
): Effect.Effect<IndexedDbSubsetSummary, unknown> => {
  const counted = distinct.length === 0 ? nativeCount(api, generation, plan) : undefined;
  return counted !== undefined
    ? counted.pipe(Effect.map((count) => ({ count, distinct: [] })))
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
};
