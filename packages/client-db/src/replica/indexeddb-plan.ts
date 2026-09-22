import type {
  IndexedDbEntityTable,
  IndexedDbResidualPredicate,
  IndexedDbScan,
  IndexedDbSubsetPlan,
} from "@store/sync/replica/indexeddb";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { UnsupportedSubsetQuery } from "./errors";
import type { InventorySubsetSpec, SubsetLeafPredicate, SubsetPredicate } from "./subset-ir";

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
      if (orderBy.length === 1 && orderBy[0]?.column === "createdAt") {
        return {
          scan: {
            _tag: "indexPrefix",
            index: "byCreatedAt",
            reverse: orderBy[0].direction === "desc",
          },
          consumed,
        };
      }
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

  const reverse = orderBy.length === 1 && orderBy[0]?.direction === "desc";
  return { scan: { _tag: "generationPrefix", reverse }, consumed };
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
        scan: {
          _tag: "generationPrefix",
          reverse: spec.orderBy.length === 1 && spec.orderBy[0]?.direction === "desc",
        },
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
