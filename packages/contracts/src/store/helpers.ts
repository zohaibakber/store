import type { Product } from "./schema";
import { baseUnitsOf } from "./stock";

export const productStock = (product: Pick<Product, "batches" | "unitsPerPack">) =>
  product.batches.reduce((sum, batch) => sum + baseUnitsOf(batch, product.unitsPerPack), 0);

export const formatInvoiceNumber = (invoiceNumber: number) =>
  invoiceNumber.toString().padStart(4, "0");
