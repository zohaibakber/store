import { nextInvoiceNumber } from "@store/contracts";
import * as Effect from "effect/Effect";

import type { CatalogProjectionTables } from "./catalog-projection";
import {
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
} from "./replica/decode";
import type { ReplicaRowInvalid } from "./replica/errors";
import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  MAX_IN_VALUES,
  type InventoryCollectionSource,
} from "./replica/sources";
import type { SqliteResultRow } from "./replica/sqlite-row";
import type { InventorySubsetSpec, SubsetPredicate } from "./replica/subset-spec";
import type { ReplicaSubsetReader } from "./replica/types";
import type { BatchRow, CategoryRow, ProductRow } from "./rows";

type DecodeRows<Row> = (
  rows: ReadonlyArray<SqliteResultRow>,
) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;

export type CatalogRowsRequest = {
  readonly allCategories?: boolean;
  readonly categoryIds?: Iterable<string>;
  readonly productIds?: Iterable<string>;
  readonly anyProductInCategory?: string;
  readonly batchIds?: Iterable<string>;
  readonly batchesOfProductIds?: Iterable<string>;
};

const PAGE_ROWS = DEFAULT_COLLECTION_MAXIMUM_ROWS;

const withAfter = (where: SubsetPredicate | undefined, after: string | undefined) => {
  if (after === undefined) return where;
  const cursor: SubsetPredicate = { _tag: "compare", column: "id", op: "gt", value: after };
  return where ? { _tag: "and" as const, predicates: [where, cursor] } : cursor;
};

const readPage = async <Row>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  where: SubsetPredicate | undefined,
  limit: number,
) => {
  const spec: InventorySubsetSpec = {
    source,
    orderBy: [{ column: "id", direction: "asc" }],
    limit,
    offset: 0,
  };
  const read = await reader.readSubset(where ? { ...spec, where } : spec);
  return { count: read.rows.length, rows: await Effect.runPromise(decode(read.rows)) };
};

const readAll = async <Row extends { readonly id: string }>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  where?: SubsetPredicate,
): Promise<ReadonlyArray<Row>> => {
  const rows: Array<Row> = [];
  let after: string | undefined;
  for (;;) {
    const page = await readPage(reader, source, decode, withAfter(where, after), PAGE_ROWS);
    rows.push(...page.rows);
    const last = page.rows.at(-1);
    if (page.count < PAGE_ROWS || last === undefined) return rows;
    after = last.id;
  }
};

const readWhereIn = async <Row extends { readonly id: string }>(
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  decode: DecodeRows<Row>,
  column: string,
  values: Iterable<string> | undefined,
): Promise<ReadonlyArray<Row>> => {
  const unique = [...new Set(values ?? [])];
  const reads: Array<Promise<ReadonlyArray<Row>>> = [];
  for (let start = 0; start < unique.length; start += MAX_IN_VALUES) {
    const chunk = unique.slice(start, start + MAX_IN_VALUES);
    reads.push(readAll(reader, source, decode, { _tag: "in", column, values: chunk }));
  }
  return (await Promise.all(reads)).flat();
};

const readable = <Row extends { readonly id: string }>(
  ...groups: ReadonlyArray<ReadonlyArray<Row>>
) => {
  const byId = new Map(groups.flat().map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => byId.get(id),
      values: () => byId.values(),
    },
  };
};

export const readCatalogRows = async (
  reader: ReplicaSubsetReader,
  request: CatalogRowsRequest,
): Promise<CatalogProjectionTables> => {
  const [allCategories, categories, products, categoryProducts, batches, productBatches] =
    await Promise.all([
      request.allCategories
        ? readAll<CategoryRow>(reader, "categories", decodeCategorySqliteRows)
        : [],
      readWhereIn<CategoryRow>(
        reader,
        "categories",
        decodeCategorySqliteRows,
        "id",
        request.categoryIds,
      ),
      readWhereIn<ProductRow>(
        reader,
        "products",
        decodeProductSqliteRows,
        "id",
        request.productIds,
      ),
      request.anyProductInCategory === undefined
        ? []
        : readPage<ProductRow>(
            reader,
            "products",
            decodeProductSqliteRows,
            {
              _tag: "compare",
              column: "categoryId",
              op: "eq",
              value: request.anyProductInCategory,
            },
            1,
          ).then((page) => page.rows),
      readWhereIn<BatchRow>(reader, "batches", decodeBatchSqliteRows, "id", request.batchIds),
      readWhereIn<BatchRow>(
        reader,
        "batches",
        decodeBatchSqliteRows,
        "productId",
        request.batchesOfProductIds,
      ),
    ]);
  return {
    categories: readable(allCategories, categories),
    products: readable(products, categoryProducts),
    batches: readable(batches, productBatches),
  };
};

export const readNextInvoiceNumber = async (
  reader: ReplicaSubsetReader,
  organizationId: string,
): Promise<number> => {
  const read = await reader.readSubset({
    source: "invoices",
    where: { _tag: "compare", column: "organizationId", op: "eq", value: organizationId },
    orderBy: [{ column: "invoiceNumber", direction: "desc" }],
    limit: 1,
    offset: 0,
  });
  const latest = await Effect.runPromise(decodeInvoiceSqliteRows(read.rows));
  return nextInvoiceNumber(latest.map((invoice) => invoice.invoiceNumber));
};
