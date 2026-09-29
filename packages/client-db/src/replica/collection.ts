import { invoiceCoherenceEntityForSource } from "./coherence";
import { readCollectionKeys, readCollectionSource, readCollectionSubset } from "./collection-read";
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

  return {
    id: descriptor.id,
    getKey: descriptor.getKey,
    syncMode: descriptor.syncMode,
    startSync: false,
    defaultStringCollation: { stringSort: "lexical" },
    sync: {
      rowUpdateMode: "full",
      sync: (params) =>
        startCollectionSync(
          {
            subset: (options) => readCollectionSubset(descriptor, dependencies, options),
            source: () => readCollectionSource(descriptor, dependencies),
            keys: (keys) => readCollectionKeys(descriptor, dependencies, keys),
          },
          { ...descriptor, coherenceEntity },
          dependencies,
          params,
          (notice) => notice.touchedEntities.includes(SOURCE_ENTITY[descriptor.source]),
        ),
    },
  };
};

export { createInvoiceCoherenceGate } from "./coherence";
