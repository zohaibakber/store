export type SyncChange = {
  cursor: number;
  change: {
    entity: string;
    action: "upsert" | "delete";
    entityId: string;
    rowVersion?: number;
    row: unknown;
  };
};

type VersionedRow = {
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type ProductRow = VersionedRow & {
  id: string;
  name: string;
  categoryId: string;
  composition: string | null;
  strength: string | null;
  aisle: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitPrice: number | null;
  visible: boolean;
};

export type CategoryRow = VersionedRow & {
  id: string;
  name: string;
  tracksPacks: boolean;
};

export type BatchRow = VersionedRow & {
  id: string;
  productId: string;
  batchNumber: string | null;
  expiresAt: number | null;
  packQuantity: number;
  unitQuantity: number;
};

export type ProductSyncMaps = {
  categories: Map<string, CategoryRow>;
  products: Map<string, ProductRow>;
  batches: Map<string, BatchRow>;
};

type StoredProductSyncState = {
  version: 1;
  organizationId: string;
  cursor: number;
  categories: Array<[string, CategoryRow]>;
  products: Array<[string, ProductRow]>;
  batches: Array<[string, BatchRow]>;
};

const emptyMaps = (): ProductSyncMaps => ({
  categories: new Map(),
  products: new Map(),
  batches: new Map(),
});

const isEntryList = (value: unknown): value is Array<[string, object]> =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "object" &&
      entry[1] !== null,
  );

export const restoreProductSyncState = (
  serialized: string | null,
  organizationId: string,
): { cursor: number; maps: ProductSyncMaps } => {
  if (!serialized) return { cursor: 0, maps: emptyMaps() };

  try {
    const stored = JSON.parse(serialized) as Partial<StoredProductSyncState>;
    if (
      stored.version !== 1 ||
      stored.organizationId !== organizationId ||
      !Number.isSafeInteger(stored.cursor) ||
      (stored.cursor ?? -1) < 0 ||
      !isEntryList(stored.categories) ||
      !isEntryList(stored.products) ||
      !isEntryList(stored.batches)
    ) {
      return { cursor: 0, maps: emptyMaps() };
    }

    return {
      cursor: stored.cursor as number,
      maps: {
        categories: new Map(stored.categories as Array<[string, CategoryRow]>),
        products: new Map(stored.products as Array<[string, ProductRow]>),
        batches: new Map(stored.batches as Array<[string, BatchRow]>),
      },
    };
  } catch {
    return { cursor: 0, maps: emptyMaps() };
  }
};

export const serializeProductSyncState = (
  organizationId: string,
  cursor: number,
  maps: ProductSyncMaps,
) =>
  JSON.stringify({
    version: 1,
    organizationId,
    cursor,
    categories: [...maps.categories],
    products: [...maps.products],
    batches: [...maps.batches],
  } satisfies StoredProductSyncState);

const asRow = <T>(value: unknown): T | null =>
  typeof value === "object" && value !== null ? (value as T) : null;

export const applyProductSyncChanges = (
  maps: ProductSyncMaps,
  changes: ReadonlyArray<SyncChange>,
) => {
  for (const { change } of changes) {
    if (change.entity === "category") {
      if (change.action === "delete") maps.categories.delete(change.entityId);
      else {
        const row = asRow<CategoryRow>(change.row);
        if (row) maps.categories.set(change.entityId, row);
      }
    } else if (change.entity === "product") {
      if (change.action === "delete") maps.products.delete(change.entityId);
      else {
        const row = asRow<ProductRow>(change.row);
        if (row) maps.products.set(change.entityId, row);
      }
    } else if (change.entity === "batch") {
      if (change.action === "delete") maps.batches.delete(change.entityId);
      else {
        const row = asRow<BatchRow>(change.row);
        if (row) maps.batches.set(change.entityId, row);
      }
    }
  }
};

export const assertSyncProgress = (cursor: number, nextCursor: number, hasMore: boolean) => {
  if (
    !Number.isSafeInteger(nextCursor) ||
    nextCursor < cursor ||
    (hasMore && nextCursor === cursor)
  ) {
    throw new Error("Inventory sync stalled. Please try again.");
  }
};
