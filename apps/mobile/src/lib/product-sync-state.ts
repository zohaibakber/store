import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

type RestoredProductSyncState = { cursor: number; maps: ProductSyncMaps };

const nonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const VersionedRowFields = {
  rowVersion: nonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  createdAt: nonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  updatedAt: nonNegativeInteger.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
};
const CategoryRowSchema = Schema.Struct({
  ...VersionedRowFields,
  id: Schema.String,
  name: Schema.String,
  tracksPacks: Schema.Boolean,
});
const ProductRowSchema = Schema.Struct({
  ...VersionedRowFields,
  id: Schema.String,
  name: Schema.String,
  categoryId: Schema.String,
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  aisle: Schema.NullOr(Schema.String),
  unitsPerPack: nonNegativeInteger,
  packPrice: Schema.NullOr(nonNegativeInteger),
  unitPrice: Schema.NullOr(nonNegativeInteger),
  visible: Schema.Boolean,
});
const BatchRowSchema = Schema.Struct({
  ...VersionedRowFields,
  id: Schema.String,
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(nonNegativeInteger),
  packQuantity: nonNegativeInteger,
  unitQuantity: nonNegativeInteger,
});
const StoredProductSyncStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  organizationId: Schema.String,
  cursor: nonNegativeInteger,
  categories: Schema.Array(Schema.Tuple([Schema.String, CategoryRowSchema])),
  products: Schema.Array(Schema.Tuple([Schema.String, ProductRowSchema])),
  batches: Schema.Array(Schema.Tuple([Schema.String, BatchRowSchema])),
});

const emptyMaps = (): ProductSyncMaps => ({
  categories: new Map(),
  products: new Map(),
  batches: new Map(),
});

export const restoreProductSyncState = (
  serialized: string | null,
  organizationId: string,
): RestoredProductSyncState => {
  if (!serialized) return { cursor: 0, maps: emptyMaps() };

  try {
    const decoded = Schema.decodeUnknownOption(StoredProductSyncStateSchema)(
      JSON.parse(serialized),
    );
    if (Option.isNone(decoded) || decoded.value.organizationId !== organizationId) {
      return { cursor: 0, maps: emptyMaps() };
    }
    const stored = decoded.value;

    return {
      cursor: stored.cursor,
      maps: {
        categories: new Map(stored.categories),
        products: new Map(stored.products),
        batches: new Map(stored.batches),
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

export const applyProductSyncChanges = (
  maps: ProductSyncMaps,
  changes: ReadonlyArray<SyncChange>,
) => {
  for (const { change } of changes) {
    if (change.entity === "category") {
      if (change.action === "delete") maps.categories.delete(change.entityId);
      else {
        const row = Schema.decodeUnknownOption(CategoryRowSchema)(change.row);
        if (Option.isSome(row)) maps.categories.set(change.entityId, row.value);
      }
    } else if (change.entity === "product") {
      if (change.action === "delete") maps.products.delete(change.entityId);
      else {
        const row = Schema.decodeUnknownOption(ProductRowSchema)(change.row);
        if (Option.isSome(row)) maps.products.set(change.entityId, row.value);
      }
    } else if (change.entity === "batch") {
      if (change.action === "delete") maps.batches.delete(change.entityId);
      else {
        const row = Schema.decodeUnknownOption(BatchRowSchema)(change.row);
        if (Option.isSome(row)) maps.batches.set(change.entityId, row.value);
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
