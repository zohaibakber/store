import { BTreeIndex } from "@tanstack/db";

import { createInvoiceCoherenceGate, invoiceCoherenceEntityForSource } from "./coherence";
import { interruptibleReads, readCollectionSource, readCollectionSubset } from "./collection-read";
import { startCollectionSync } from "./collection-sync";
import { decodeSourceRows } from "./decode";
import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  SOURCE_ENTITY,
  type InventoryCollectionSource,
  type InventoryCollectionSyncMode,
} from "./sources";
import type {
  CatalogRows,
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaChangeFeed,
  ReplicaSubsetReader,
  SqliteCollectionConfig,
  SqliteCollectionDependencies,
} from "./types";

export const sqliteCollectionOptions = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
): SqliteCollectionConfig<Row> => {
  const coherenceEntity =
    descriptor.source === "invoices" ||
    descriptor.source === "invoiceItems" ||
    descriptor.source === "stockMovements"
      ? invoiceCoherenceEntityForSource(descriptor.source)
      : undefined;
  const read =
    coherenceEntity !== undefined && dependencies.coherence !== undefined
      ? dependencies.coherence.reader(dependencies.executor)
      : interruptibleReads(dependencies.executor);

  return {
    id: descriptor.id,
    getKey: descriptor.getKey,
    syncMode: descriptor.syncMode,
    startSync: false,
    defaultStringCollation: { stringSort: "lexical" },
    autoIndex: "eager",
    defaultIndexType: BTreeIndex,
    sync: {
      rowUpdateMode: "full",
      sync: (params) =>
        startCollectionSync(
          {
            subset: (options) => readCollectionSubset(descriptor, read, options),
            source: readCollectionSource(descriptor, read),
          },
          { ...descriptor, coherenceEntity },
          dependencies,
          params,
          SOURCE_ENTITY[descriptor.source],
        ),
    },
  };
};

const CATALOG_COLLECTIONS = {
  categories: { name: "categories", syncMode: "eager" },
  products: { name: "products", syncMode: "on-demand" },
  batches: { name: "batches", syncMode: "on-demand" },
  invoices: { name: "invoices", syncMode: "on-demand" },
  invoiceItems: { name: "invoice-items", syncMode: "on-demand" },
  stockMovements: { name: "stock-movements", syncMode: "on-demand" },
  suppliers: { name: "suppliers", syncMode: "eager" },
  purchaseOrders: { name: "purchase-orders", syncMode: "on-demand" },
  purchaseOrderItems: { name: "purchase-order-items", syncMode: "on-demand" },
} satisfies Record<
  InventoryCollectionSource,
  { readonly name: string; readonly syncMode: InventoryCollectionSyncMode }
>;

type CatalogCollectionOptions = {
  readonly [Source in InventoryCollectionSource]: SqliteCollectionConfig<CatalogRows[Source]>;
};

export const catalogCollectionOptions = (
  scopeId: string,
  replica: ReplicaSubsetReader & ReplicaChangeFeed,
): CatalogCollectionOptions => {
  const dependencies: SqliteCollectionDependencies = {
    executor: replica,
    changeFeed: replica,
    coherence: createInvoiceCoherenceGate(),
  };
  const options = <Source extends InventoryCollectionSource>(source: Source) =>
    sqliteCollectionOptions<CatalogRows[Source]>(
      {
        id: `${scopeId}:${CATALOG_COLLECTIONS[source].name}`,
        source,
        syncMode: CATALOG_COLLECTIONS[source].syncMode,
        maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
        getKey: (row) => row.id,
        decodeRows: decodeSourceRows(source),
      },
      dependencies,
    );
  return {
    categories: options("categories"),
    products: options("products"),
    batches: options("batches"),
    invoices: options("invoices"),
    invoiceItems: options("invoiceItems"),
    stockMovements: options("stockMovements"),
    suppliers: options("suppliers"),
    purchaseOrders: options("purchaseOrders"),
    purchaseOrderItems: options("purchaseOrderItems"),
  };
};
