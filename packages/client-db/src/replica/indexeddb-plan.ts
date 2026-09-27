import type {
  IndexedDbEntityTable,
  IndexedDbResidualPredicate,
  IndexedDbScan,
  IndexedDbSubsetPlan,
} from "@store/sync/replica/indexeddb";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { UnsupportedSubsetQuery } from "./errors";
import type { InventorySubsetSpec, SubsetLeafPredicate, SubsetPredicate } from "./subset-spec";

const isStringScalar = Schema.is(Schema.String);
const isIndexEqualsScalar = Schema.is(Schema.Union([Schema.String, Schema.Number]));

type IndexedDbScanPick = {
  readonly scan: IndexedDbScan;
  readonly consumed: ReadonlySet<number>;
};

const unsupported = (reason: string): UnsupportedSubsetQuery =>
  new UnsupportedSubsetQuery({
    message: `Unsupported subset query: ${reason}`,
    reason,
  });

const tableFor = (spec: InventorySubsetSpec): IndexedDbEntityTable => {
  switch (spec.source) {
    case "categories":
      return "categories";
    case "products":
      return "products";
    case "batches":
      return "batches";
    case "invoices":
      return "invoices";
    case "invoiceItems":
      return "invoice_items";
    case "stockMovements":
      return "stock_movements";
  }
};

const toResidual = (predicate: SubsetPredicate): IndexedDbResidualPredicate => {
  switch (predicate._tag) {
    case "compare":
      return {
        _tag: "compare",
        column: predicate.column,
        op: predicate.op,
        value: predicate.value,
      };
    case "in":
      return { _tag: "in", column: predicate.column, values: predicate.values };
    case "isNull":
      return { _tag: "isNull", column: predicate.column };
    case "like":
      return { _tag: "like", column: predicate.column, pattern: predicate.pattern };
    case "and":
      return {
        _tag: "and",
        predicates: predicate.predicates.map(toResidual),
      };
    case "or":
      return {
        _tag: "or",
        predicates: predicate.predicates.map(toResidual),
      };
    case "not":
      return { _tag: "not", predicate: toResidual(predicate.predicate) };
  }
};

const andLeaves = (
  predicate: SubsetPredicate | undefined,
): ReadonlyArray<SubsetLeafPredicate> | undefined => {
  if (!predicate) return [];
  if (predicate._tag === "and") {
    const leaves: Array<SubsetLeafPredicate> = [];
    for (const part of predicate.predicates) {
      const nested = andLeaves(part);
      if (nested === undefined) return undefined;
      leaves.push(...nested);
    }
    return leaves;
  }
  if (predicate._tag === "or" || predicate._tag === "not") return undefined;
  return [predicate];
};

const ORDERED_INDEXES = {
  invoices: { column: "createdAt", index: "byCreatedAt" },
  products: { column: "name", index: "byNameKey" },
} as const;

const unfilteredScan = (
  source: InventorySubsetSpec["source"],
  orderBy: InventorySubsetSpec["orderBy"],
): IndexedDbScan => {
  const [first] = orderBy;
  const reverse = first?.direction === "desc";
  const ordered =
    source === "invoices" || source === "products" ? ORDERED_INDEXES[source] : undefined;
  if (first !== undefined && ordered?.column === first.column) {
    return { _tag: "indexPrefix", index: ordered.index, reverse };
  }
  return { _tag: "generationPrefix", reverse: orderBy.length === 1 && reverse };
};

const pickScan = (
  source: InventorySubsetSpec["source"],
  leaves: ReadonlyArray<SubsetLeafPredicate>,
  orderBy: InventorySubsetSpec["orderBy"],
): IndexedDbScanPick => {
  const consumed = new Set<number>();
  for (const [index, leaf] of leaves.entries()) {
    if (
      leaf._tag === "compare" &&
      leaf.op === "eq" &&
      leaf.column === "id" &&
      isStringScalar(leaf.value)
    ) {
      consumed.add(index);
      return { scan: { _tag: "primaryEquals", id: leaf.value }, consumed };
    }
  }

  const indexEq = (
    column: string,
    indexName: Extract<IndexedDbScan, { readonly _tag: "indexEquals" }>["index"],
  ): IndexedDbScanPick | undefined => {
    for (const [index, leaf] of leaves.entries()) {
      if (
        leaf._tag === "compare" &&
        leaf.op === "eq" &&
        leaf.column === column &&
        isIndexEqualsScalar(leaf.value)
      ) {
        consumed.add(index);
        return {
          scan: { _tag: "indexEquals", index: indexName, value: leaf.value },
          consumed,
        };
      }
    }
    return undefined;
  };

  switch (source) {
    case "categories": {
      const byName = indexEq("name", "byName");
      if (byName) return byName;
      break;
    }
    case "products": {
      const byCategory = indexEq("categoryId", "byCategory");
      if (byCategory) return byCategory;
      break;
    }
    case "batches": {
      const byProduct = indexEq("productId", "byProduct");
      if (byProduct) return byProduct;
      break;
    }
    case "invoices": {
      const byOperation = indexEq("operationId", "byOperation");
      if (byOperation) return byOperation;
      const byCreatedAt = indexEq("createdAt", "byCreatedAt");
      if (byCreatedAt) return byCreatedAt;
      break;
    }
    case "invoiceItems": {
      const byInvoice = indexEq("invoiceId", "byInvoice");
      if (byInvoice) return byInvoice;
      break;
    }
    case "stockMovements": {
      const byProduct = indexEq("productId", "byProduct");
      if (byProduct) return byProduct;
      break;
    }
  }

  return { scan: unfilteredScan(source, orderBy), consumed };
};

const residualFromLeaves = (
  leaves: ReadonlyArray<SubsetLeafPredicate>,
  consumed: ReadonlySet<number>,
): IndexedDbResidualPredicate | undefined => {
  const remaining = leaves.filter((_, index) => !consumed.has(index)).map(toResidual);
  if (remaining.length === 0) return undefined;
  if (remaining.length === 1) return remaining[0];
  return { _tag: "and", predicates: remaining };
};

export const planIndexedDbSubset = (
  spec: InventorySubsetSpec,
): Effect.Effect<IndexedDbSubsetPlan, UnsupportedSubsetQuery> =>
  Effect.gen(function* () {
    const leaves = andLeaves(spec.where);
    if (leaves === undefined) {
      if (!spec.where) {
        return yield* Effect.fail(unsupported("missing where unexpectedly"));
      }
      return {
        table: tableFor(spec),
        scan: unfilteredScan(spec.source, spec.orderBy),
        residual: toResidual(spec.where),
        orderBy: spec.orderBy,
        limit: spec.limit,
        offset: spec.offset,
      } satisfies IndexedDbSubsetPlan;
    }
    const { scan, consumed } = pickScan(spec.source, leaves, spec.orderBy);
    return {
      table: tableFor(spec),
      scan,
      residual: residualFromLeaves(leaves, consumed),
      orderBy: spec.orderBy,
      limit: spec.limit,
      offset: spec.offset,
    } satisfies IndexedDbSubsetPlan;
  });
