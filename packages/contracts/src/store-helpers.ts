import type { Product } from "./store.schema";

export const productPackStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.packQuantity, 0);

export const productLooseUnitStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.unitQuantity, 0);

export const productStock = (product: Pick<Product, "batches" | "unitsPerPack">) =>
  productPackStock(product) * product.unitsPerPack + productLooseUnitStock(product);

export const formatInvoiceNumber = (invoiceNumber: number) =>
  invoiceNumber.toString().padStart(4, "0");
