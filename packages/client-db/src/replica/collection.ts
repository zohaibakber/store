import type { LoadSubsetFn, SyncConfigRes, UnloadSubsetFn } from "@tanstack/db";

import { invoiceCoherenceEntityForSource } from "./coherence";
import { readCollectionSubset } from "./collection-read";
import { startCollectionSync } from "./collection-sync";
import { SOURCE_ENTITY } from "./sources";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  SqliteCollectionConfig,
  SqliteCollectionDependencies,
} from "./types";

type DeferredSubsetUtils = {
  readonly loadSubset: LoadSubsetFn;
  readonly unloadSubset: UnloadSubsetFn;
  readonly bind: (
    started: SyncConfigRes & { loadSubset?: LoadSubsetFn; unloadSubset?: UnloadSubsetFn },
  ) => void;
};

const deferredSubsetUtils = (): DeferredSubsetUtils => {
  let started:
    | (SyncConfigRes & { loadSubset?: LoadSubsetFn; unloadSubset?: UnloadSubsetFn })
    | undefined;
  return {
    loadSubset: (options) => {
      const api = started?.loadSubset;
      if (!api) throw new Error("Sqlite collection sync has not started.");
      return api(options);
    },
    unloadSubset: (options) => {
      started?.unloadSubset?.(options);
    },
    bind: (api) => {
      started = api;
    },
  };
};

export const sqliteCollectionOptions = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
): SqliteCollectionConfig<Row> => {
  const utils = deferredSubsetUtils();
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
    sync: {
      rowUpdateMode: "full",
      sync: (params) => {
        const api = startCollectionSync(
          (options) => readCollectionSubset(descriptor, dependencies, options),
          { ...descriptor, coherenceEntity },
          dependencies,
          params,
          (notice) => notice.touchedEntities.includes(SOURCE_ENTITY[descriptor.source]),
        );
        utils.bind(api);
        if (descriptor.syncMode === "eager") {
          void api.loadSubset({ limit: descriptor.maximumRows });
        }
        return api;
      },
    },
    utils: { loadSubset: utils.loadSubset, unloadSubset: utils.unloadSubset },
  };
};

export { createInvoiceCoherenceGate } from "./coherence";
