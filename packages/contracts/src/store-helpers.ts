import type { Product } from "./store.schema";

export const productPackStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.packQuantity, 0);

export const productLooseUnitStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.unitQuantity, 0);

export const productStock = (product: Pick<Product, "batches" | "unitsPerPack">) =>
  productPackStock(product) * product.unitsPerPack + productLooseUnitStock(product);

type StockValueProduct = Pick<Product, "packPrice" | "unitPrice" | "unitsPerPack"> & {
  readonly batches: ReadonlyArray<
    Pick<Product["batches"][number], "packQuantity" | "unitQuantity">
  >;
};

export const productStockValue = (product: StockValueProduct) => {
  const packPrice =
    product.packPrice ??
    (product.unitPrice === null ? null : product.unitPrice * product.unitsPerPack);
  const unitPrice =
    product.unitPrice ??
    (product.packPrice === null ? null : product.packPrice / product.unitsPerPack);

  return Math.round(
    product.batches.reduce(
      (sum, batch) =>
        sum + batch.packQuantity * (packPrice ?? 0) + batch.unitQuantity * (unitPrice ?? 0),
      0,
    ),
  );
};

export const formatInvoiceNumber = (invoiceNumber: number) =>
  invoiceNumber.toString().padStart(4, "0");
