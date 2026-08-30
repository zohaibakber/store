import type { Product } from "./schema";

export const productPackStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.packQuantity, 0);

export const productLooseUnitStock = (product: Pick<Product, "batches">) =>
  product.batches.reduce((sum, batch) => sum + batch.unitQuantity, 0);

export const productStock = (product: Pick<Product, "batches" | "unitsPerPack">) =>
  productPackStock(product) * product.unitsPerPack + productLooseUnitStock(product);

type StockValueProduct = Pick<Product, "retailPrice" | "unitPrice" | "unitsPerPack"> & {
  readonly batches: ReadonlyArray<
    Pick<Product["batches"][number], "packQuantity" | "unitQuantity">
  >;
};

export const productStockValue = (product: StockValueProduct) => {
  const retailPrice =
    product.retailPrice ??
    (product.unitPrice === null ? null : product.unitPrice * product.unitsPerPack);
  const unitPrice =
    product.unitPrice ??
    (product.retailPrice === null ? null : product.retailPrice / product.unitsPerPack);

  return Math.round(
    product.batches.reduce(
      (sum, batch) =>
        sum + batch.packQuantity * (retailPrice ?? 0) + batch.unitQuantity * (unitPrice ?? 0),
      0,
    ),
  );
};

export const formatInvoiceNumber = (invoiceNumber: number) =>
  invoiceNumber.toString().padStart(4, "0");

export const normalizedProductName = (value: string) => value.trim().toLocaleLowerCase();

export const inventorySkuKey = (name: string, unitsPerPack: number) =>
  `${normalizedProductName(name)}\0${unitsPerPack}`;
