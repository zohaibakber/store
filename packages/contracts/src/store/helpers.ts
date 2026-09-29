import type { Product } from "./schema";

export const productStock = (product: Pick<Product, "batches" | "unitsPerPack">) =>
  product.batches.reduce(
    (sum, batch) => sum + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
    0,
  );

export const formatInvoiceNumber = (invoiceNumber: number) =>
  invoiceNumber.toString().padStart(4, "0");
