import { BTreeIndex } from "@tanstack/db";

import { invoiceCoherenceEntityForSource } from "./coherence";
import { readCollectionSource, readCollectionSubset } from "./collection-read";
import { startCollectionSync } from "./collection-sync";
import { SOURCE_ENTITY } from "./sources";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
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
  const readDependencies: SqliteCollectionDependencies =
    coherenceEntity !== undefined && dependencies.coherence !== undefined
      ? { ...dependencies, executor: dependencies.coherence.reader(dependencies.executor) }
      : dependencies;

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
            subset: (options, signal) =>
              readCollectionSubset(descriptor, readDependencies, options, signal),
            source: (signal) => readCollectionSource(descriptor, readDependencies, signal),
          },
          { ...descriptor, coherenceEntity },
          dependencies,
          params,
          SOURCE_ENTITY[descriptor.source],
        ),
    },
  };
};

export { createInvoiceCoherenceGate } from "./coherence";
