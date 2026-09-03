import type { SyncEntity } from "@store/contracts";
import type { CatalogWriteEntity } from "@store/contracts/catalog-write";
import type { ReplicaDiff, ReplicaSnapshot } from "@store/sync";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";

type JsonValue = typeof Schema.Json.Type;

type SyncWriter<Row> = (
  message:
    | { readonly type: "insert" | "update"; readonly value: Row }
    | { readonly type: "delete"; readonly key: string },
) => void;

type CollectionSync<Row> = {
  readonly sync: (helpers: {
    readonly begin: () => void;
    readonly write: SyncWriter<Row>;
    readonly commit: () => void;
    readonly markReady: () => void;
  }) => () => void;
};

export type CatalogMemoryCollectionConfig<Row extends { readonly id: string }> = {
  readonly id: string;
  readonly getKey: (row: Row) => string;
  readonly sync: CollectionSync<Row>;
  readonly onInsert?: (input: {
    readonly transaction: { readonly mutations: ReadonlyArray<{ readonly modified: Row }> };
  }) => Promise<void>;
  readonly onUpdate?: (input: {
    readonly transaction: { readonly mutations: ReadonlyArray<{ readonly modified: Row }> };
  }) => Promise<void>;
};

export type CatalogCollectionConfigs = {
  readonly categories: CatalogMemoryCollectionConfig<CategoryRow>;
  readonly products: CatalogMemoryCollectionConfig<ProductRow>;
  readonly batches: CatalogMemoryCollectionConfig<BatchRow>;
  readonly invoices: CatalogMemoryCollectionConfig<InvoiceRow>;
  readonly invoiceItems: CatalogMemoryCollectionConfig<InvoiceItemRow>;
  readonly stockMovements: CatalogMemoryCollectionConfig<StockMovementRow>;
};

const entityTable = {
  category: "categories",
  product: "products",
  batch: "batches",
  invoice: "invoices",
  invoiceItem: "invoiceItems",
  stockMovement: "stockMovements",
} as const satisfies Record<SyncEntity, keyof CatalogCollectionConfigs>;

export type CatalogMemoryCollectionHost = {
  readonly scopeId: string;
  readonly snapshot: () => Promise<ReplicaSnapshot>;
  readonly subscribe: (listener: (diff: ReplicaDiff) => void) => () => void;
  readonly persistCatalog: (
    entity: CatalogWriteEntity,
    row: CategoryRow | ProductRow | BatchRow,
  ) => Promise<void>;
};

const persistMutations = async (
  entity: CatalogWriteEntity,
  mutations: ReadonlyArray<{ readonly modified: CategoryRow | ProductRow | BatchRow }>,
  persistCatalog: CatalogMemoryCollectionHost["persistCatalog"],
) => {
  const row = mutations[0]?.modified;
  if (!row) return;
  await persistCatalog(entity, row);
};

const memoryCollection = <Row extends { readonly id: string }>(input: {
  readonly id: string;
  readonly entity: SyncEntity;
  readonly host: CatalogMemoryCollectionHost;
  readonly decodeRow: (row: JsonValue) => Row | null;
}): CatalogMemoryCollectionConfig<Row> => {
  const keys = new Set<string>();
  const apply = (
    helpers: {
      readonly begin: () => void;
      readonly write: SyncWriter<Row>;
      readonly commit: () => void;
    },
    diff: ReplicaDiff,
  ) => {
    if (diff.entity !== input.entity) return;
    helpers.begin();
    for (const id of diff.deletes) {
      helpers.write({ type: "delete", key: id });
      keys.delete(id);
    }
    for (const upsert of diff.upserts) {
      const row = input.decodeRow(upsert.row);
      if (!row) continue;
      helpers.write({
        type: keys.has(upsert.id) ? "update" : "insert",
        value: row,
      });
      keys.add(upsert.id);
    }
    helpers.commit();
  };

  return {
    id: input.id,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        let hydrating = true;
        const buffered: Array<ReplicaDiff> = [];
        const unsubscribe = input.host.subscribe((diff) => {
          if (hydrating) buffered.push(diff);
          else apply({ begin, write, commit }, diff);
        });
        void input.host.snapshot().then((snapshot) => {
          const rows = snapshot.rows[input.entity] ?? [];
          begin();
          for (const stored of rows) {
            const row = input.decodeRow(stored);
            if (!row) continue;
            write({ type: "insert", value: row });
            keys.add(row.id);
          }
          commit();
          for (const diff of buffered) apply({ begin, write, commit }, diff);
          buffered.length = 0;
          hydrating = false;
          markReady();
        });
        return unsubscribe;
      },
    },
  };
};

const persistableCollection = <Row extends CategoryRow | ProductRow | BatchRow>(input: {
  readonly id: string;
  readonly entity: CatalogWriteEntity;
  readonly host: CatalogMemoryCollectionHost;
  readonly decodeRow: (row: JsonValue) => Row | null;
}): CatalogMemoryCollectionConfig<Row> => {
  const collection = memoryCollection(input);
  return {
    id: collection.id,
    getKey: collection.getKey,
    sync: collection.sync,
    onInsert: ({ transaction }) =>
      persistMutations(input.entity, transaction.mutations, input.host.persistCatalog),
    onUpdate: ({ transaction }) =>
      persistMutations(input.entity, transaction.mutations, input.host.persistCatalog),
  };
};

export const catalogMemoryCollectionConfigs = (
  host: CatalogMemoryCollectionHost,
): CatalogCollectionConfigs => ({
  categories: persistableCollection<CategoryRow>({
    id: `${host.scopeId}:${entityTable.category}`,
    entity: "category",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(CategoryRow)(row).pipe(Option.getOrNull),
  }),
  products: persistableCollection<ProductRow>({
    id: `${host.scopeId}:${entityTable.product}`,
    entity: "product",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(ProductRow)(row).pipe(Option.getOrNull),
  }),
  batches: persistableCollection<BatchRow>({
    id: `${host.scopeId}:${entityTable.batch}`,
    entity: "batch",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(BatchRow)(row).pipe(Option.getOrNull),
  }),
  invoices: memoryCollection<InvoiceRow>({
    id: `${host.scopeId}:${entityTable.invoice}`,
    entity: "invoice",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(InvoiceRow)(row).pipe(Option.getOrNull),
  }),
  invoiceItems: memoryCollection<InvoiceItemRow>({
    id: `${host.scopeId}:${entityTable.invoiceItem}`,
    entity: "invoiceItem",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(InvoiceItemRow)(row).pipe(Option.getOrNull),
  }),
  stockMovements: memoryCollection<StockMovementRow>({
    id: `${host.scopeId}:${entityTable.stockMovement}`,
    entity: "stockMovement",
    host,
    decodeRow: (row) => Schema.decodeUnknownOption(StockMovementRow)(row).pipe(Option.getOrNull),
  }),
});
