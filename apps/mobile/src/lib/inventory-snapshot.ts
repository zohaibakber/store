import type { BatchRow, CategoryRow, ProductRow } from "@store/client-db";

import type {
  InventorySnapshot,
  MobileBatch,
  MobileCategory,
  MobileProduct,
} from "@/lib/inventory-types";

export const formatPrice = (paisa: number | null) => {
  if (paisa === null) return "—";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: paisa % 100 === 0 ? 0 : 2,
  }).format(paisa / 100);
};

const mobileBatch = (batch: BatchRow): MobileBatch => ({
  id: batch.id,
  productId: batch.productId,
  batchNumber: batch.batchNumber,
  expiresAt: batch.expiresAt,
  packQuantity: batch.packQuantity,
  unitQuantity: batch.unitQuantity,
  rowVersion: batch.rowVersion,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

export const snapshotFromRows = (rows: {
  readonly batches: ReadonlyArray<BatchRow>;
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly products: ReadonlyArray<ProductRow>;
}): InventorySnapshot => {
  const categoriesById = new Map(rows.categories.map((category) => [category.id, category]));
  const categories = rows.categories
    .map((category): MobileCategory => ({
      id: category.id,
      name: category.name,
      tracksPacks: category.tracksPacks,
      rowVersion: category.rowVersion,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const batchesByProduct = new Map<string, Array<MobileBatch>>();
  for (const batch of rows.batches) {
    const rows = batchesByProduct.get(batch.productId) ?? [];
    rows.push(mobileBatch(batch));
    batchesByProduct.set(batch.productId, rows);
  }
  for (const batches of batchesByProduct.values())
    batches.sort(
      (left, right) =>
        (left.expiresAt ?? Number.POSITIVE_INFINITY) -
          (right.expiresAt ?? Number.POSITIVE_INFINITY) || left.createdAt - right.createdAt,
    );

  const products = rows.products
    .map((product): MobileProduct => {
      const category = categoriesById.get(product.categoryId);
      const batches = batchesByProduct.get(product.id) ?? [];
      const stock = batches.reduce(
        (total, batch) => total + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
        0,
      );
      return {
        id: product.id,
        name: product.name,
        categoryId: product.categoryId,
        category: category?.name ?? "Uncategorized",
        tracksPacks: category?.tracksPacks ?? true,
        composition: product.composition,
        strength: product.strength,
        details: [product.composition, product.strength].filter(Boolean).join(" · "),
        aisle: product.aisle,
        unitsPerPack: product.unitsPerPack,
        packPrice: product.packPrice,
        unitPrice: product.unitPrice,
        visible: product.visible,
        stock,
        stockLabel: `${stock} ${stock === 1 ? "unit" : "units"}`,
        batches,
        rowVersion: product.rowVersion,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { products, categories };
};

export const mobileProductById = (snapshot: InventorySnapshot, productId: string) => {
  const product = snapshot.products.find((candidate) => candidate.id === productId);
  if (!product) throw new Error("The saved product could not be loaded.");
  return product;
};

export const mobileBatchById = (
  snapshot: InventorySnapshot,
  productId: string,
  batchId: string,
) => {
  const batch = mobileProductById(snapshot, productId).batches.find(
    (candidate) => candidate.id === batchId,
  );
  if (!batch) throw new Error("The saved batch could not be loaded.");
  return batch;
};
