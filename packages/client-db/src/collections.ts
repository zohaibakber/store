import type { CatalogWriteEntity } from "@store/contracts/catalog-write"
import type { SyncEntity } from "@store/contracts"
import type { ReplicaDiff, ReplicaSnapshot } from "@store/sync"

import type { BatchRow, CategoryRow, InvoiceItemRow, InvoiceRow, ProductRow, StockMovementRow } from "./rows"

type SyncWriter<Row> = (
  message:
    | { readonly type: "insert" | "update"; readonly value: Row }
    | { readonly type: "delete"; readonly key: string },
) => void

type CollectionSync<Row> = {
  readonly sync: (helpers: {
    readonly begin: () => void
    readonly write: SyncWriter<Row>
    readonly commit: () => void
    readonly markReady: () => void
  }) => () => void
}

export type CatalogMemoryCollectionConfig<Row extends { readonly id: string }> = {
  readonly id: string
  readonly getKey: (row: Row) => string
  readonly sync: CollectionSync<Row>
  readonly onInsert?: (input: {
    readonly transaction: { readonly mutations: ReadonlyArray<{ readonly modified: Row }> }
  }) => Promise<void>
  readonly onUpdate?: (input: {
    readonly transaction: { readonly mutations: ReadonlyArray<{ readonly modified: Row }> }
  }) => Promise<void>
}

export type CatalogCollectionConfigs = {
  readonly categories: CatalogMemoryCollectionConfig<CategoryRow>
  readonly products: CatalogMemoryCollectionConfig<ProductRow>
  readonly batches: CatalogMemoryCollectionConfig<BatchRow>
  readonly invoices: CatalogMemoryCollectionConfig<InvoiceRow>
  readonly invoiceItems: CatalogMemoryCollectionConfig<InvoiceItemRow>
  readonly stockMovements: CatalogMemoryCollectionConfig<StockMovementRow>
}

const entityTable = {
  category: "categories",
  product: "products",
  batch: "batches",
  invoice: "invoices",
  invoiceItem: "invoiceItems",
  stockMovement: "stockMovements",
} as const satisfies Record<SyncEntity, keyof CatalogCollectionConfigs>

const asRow = <Row>(value: unknown): Row => value as Row

const persistMutations = async <Row extends { readonly id: string }>(
  entity: CatalogWriteEntity,
  mutations: ReadonlyArray<{ readonly modified: Row }>,
  persistCatalog: CatalogMemoryCollectionHost["persistCatalog"],
) => {
  const row = mutations[0]?.modified
  if (!row) return
  await persistCatalog(entity, row as unknown as CategoryRow | ProductRow | BatchRow)
}

export type CatalogMemoryCollectionHost = {
  readonly scopeId: string
  readonly snapshot: () => Promise<ReplicaSnapshot>
  readonly subscribe: (listener: (diff: ReplicaDiff) => void) => () => void
  readonly persistCatalog: (
    entity: CatalogWriteEntity,
    row: CategoryRow | ProductRow | BatchRow,
  ) => Promise<void>
}

const memoryCollection = <Row extends { readonly id: string }>(input: {
  readonly id: string
  readonly entity: SyncEntity
  readonly host: CatalogMemoryCollectionHost
  readonly persist?: CatalogWriteEntity
}): CatalogMemoryCollectionConfig<Row> => {
  const keys = new Set<string>()
  const apply = (
    helpers: {
      readonly begin: () => void
      readonly write: SyncWriter<Row>
      readonly commit: () => void
    },
    diff: ReplicaDiff,
  ) => {
    if (diff.entity !== input.entity) return
    helpers.begin()
    for (const id of diff.deletes) {
      helpers.write({ type: "delete", key: id })
      keys.delete(id)
    }
    for (const upsert of diff.upserts) {
      helpers.write({
        type: keys.has(upsert.id) ? "update" : "insert",
        value: asRow<Row>(upsert.row),
      })
      keys.add(upsert.id)
    }
    helpers.commit()
  }

  return {
    id: input.id,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const unsubscribe = input.host.subscribe((diff) => apply({ begin, write, commit }, diff))
        void input.host.snapshot().then((snapshot) => {
          const rows = snapshot.rows[input.entity] ?? []
          begin()
          for (const row of rows) {
            const id = asRow<Row>(row).id
            write({ type: "insert", value: asRow<Row>(row) })
            keys.add(id)
          }
          commit()
          markReady()
        })
        return unsubscribe
      },
    },
    ...(input.persist
      ? {
          onInsert: ({ transaction }) =>
            persistMutations(input.persist!, transaction.mutations, input.host.persistCatalog),
          onUpdate: ({ transaction }) =>
            persistMutations(input.persist!, transaction.mutations, input.host.persistCatalog),
        }
      : {}),
  }
}

export const catalogMemoryCollectionConfigs = (
  host: CatalogMemoryCollectionHost,
): CatalogCollectionConfigs => ({
  categories: memoryCollection<CategoryRow>({
    id: `${host.scopeId}:${entityTable.category}`,
    entity: "category",
    host,
    persist: "category",
  }),
  products: memoryCollection<ProductRow>({
    id: `${host.scopeId}:${entityTable.product}`,
    entity: "product",
    host,
    persist: "product",
  }),
  batches: memoryCollection<BatchRow>({
    id: `${host.scopeId}:${entityTable.batch}`,
    entity: "batch",
    host,
    persist: "batch",
  }),
  invoices: memoryCollection<InvoiceRow>({
    id: `${host.scopeId}:${entityTable.invoice}`,
    entity: "invoice",
    host,
  }),
  invoiceItems: memoryCollection<InvoiceItemRow>({
    id: `${host.scopeId}:${entityTable.invoiceItem}`,
    entity: "invoiceItem",
    host,
  }),
  stockMovements: memoryCollection<StockMovementRow>({
    id: `${host.scopeId}:${entityTable.stockMovement}`,
    entity: "stockMovement",
    host,
  }),
})
