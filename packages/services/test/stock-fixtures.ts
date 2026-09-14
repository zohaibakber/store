import {
  decodeBatchId,
  decodeCategoryId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeProductId,
  type Invoice,
  type Product,
} from "@store/contracts";
export const DAY = 86_400_000;
export const now = Date.UTC(2026, 8, 13, 12);
const metadata = {
  organizationId: "org",
  createdByUserId: "user",
  updatedByUserId: "user",
  deviceId: "device",
  operationId: "op",
  rowVersion: 1,
  createdAt: now - 100 * DAY,
  updatedAt: now,
};
export const product: Product = {
  ...metadata,
  id: decodeProductId("product"),
  name: "Product",
  categoryId: decodeCategoryId("category"),
  category: { ...metadata, id: decodeCategoryId("category"), name: "Category", tracksPacks: true },
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: 1000,
  retailPrice: 1500,
  unitPrice: 150,
  visible: true,
  batches: [],
};
export const batch = (units: number, expiresAt: number | null = null) => ({
  ...metadata,
  id: decodeBatchId("batch"),
  productId: product.id,
  batchNumber: null,
  packQuantity: Math.floor(units / 10),
  unitQuantity: units % 10,
  expiresAt,
});
export const sale = (daysAgo: number, units: number): Invoice => ({
  ...metadata,
  id: decodeInvoiceId(`invoice-${daysAgo}`),
  invoiceNumber: daysAgo,
  createdAt: now - daysAgo * DAY,
  customerName: null,
  total: units * 150,
  items: [
    {
      ...metadata,
      id: decodeInvoiceItemId(`item-${daysAgo}`),
      invoiceId: decodeInvoiceId(`invoice-${daysAgo}`),
      productId: product.id,
      batchId: decodeBatchId("batch"),
      productName: product.name,
      batchNumber: null,
      quantity: units,
      quantityType: "unit",
      baseUnitQuantity: units,
      salePrice: 150,
    },
  ],
});
export const dailySales = Array.from({ length: 30 }, (_, i) => sale(i, 10));
