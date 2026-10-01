import type { CreateInvoiceLineInput, Product } from "@store/contracts";

import { formatNumber } from "@/lib/format";
import {
  AUTO_BATCH,
  CATALOG_PRICE,
  type QuantityElsewhere,
  type SaleDraft,
  type SaleDraftLine,
} from "@/lib/sale-drafts";

export interface SaleLine {
  readonly kind: "ready";
  readonly key: number;
  readonly product: Product;
  readonly batchId: SaleDraftLine["batchId"];
  readonly quantity: number | null;
  readonly quantityUnit: SaleDraftLine["quantityUnit"];
  readonly salePrice: number | null;
  readonly elsewhere: { readonly units: number; readonly sales: number } | null;
}

export interface MissingSaleLine {
  readonly kind: "loading" | "unavailable";
  readonly key: number;
}

export type SaleLineView = SaleLine | MissingSaleLine;

export type ProductLookup = (productId: string) => Product | "loading" | undefined;

export const suggestedPrice = (product: Product, quantityUnit: SaleLine["quantityUnit"]) =>
  quantityUnit === "pack" ? product.retailPrice : product.unitPrice;

export const paisaToRupees = (paisa: number | null) => (paisa == null ? null : paisa / 100);

export const enteredPrice = (
  product: Product,
  quantityUnit: SaleLine["quantityUnit"],
  salePrice: number | null,
): SaleDraftLine["price"] =>
  salePrice === paisaToRupees(suggestedPrice(product, quantityUnit)) ? CATALOG_PRICE : salePrice;

const elsewhereOf = (product: Product, elsewhere: QuantityElsewhere | undefined) =>
  elsewhere
    ? { units: elsewhere.unit + elsewhere.pack * product.unitsPerPack, sales: elsewhere.sales }
    : null;

const sameElsewhere = (left: SaleLine["elsewhere"], right: SaleLine["elsewhere"]) =>
  left?.units === right?.units && left?.sales === right?.sales;

const resolvedLines = new WeakMap<SaleDraftLine, SaleLine>();

export const resolveSaleLine = (
  line: SaleDraftLine,
  lookup: ProductLookup,
  quantityElsewhere?: QuantityElsewhere,
): SaleLineView => {
  const product = lookup(line.productId);
  if (product === undefined) return { kind: "unavailable", key: line.key };
  if (product === "loading") return { kind: "loading", key: line.key };
  const elsewhere = elsewhereOf(product, quantityElsewhere);
  const known = resolvedLines.get(line);
  if (known?.product === product && sameElsewhere(known.elsewhere, elsewhere)) return known;
  const resolved: SaleLine = {
    kind: "ready",
    key: line.key,
    product,
    batchId: line.batchId,
    quantity: line.quantity,
    quantityUnit: line.quantityUnit,
    salePrice:
      line.price === CATALOG_PRICE
        ? paisaToRupees(suggestedPrice(product, line.quantityUnit))
        : line.price,
    elsewhere,
  };
  resolvedLines.set(line, resolved);
  return resolved;
};

const chosenBatches = (line: SaleLine) =>
  line.batchId === AUTO_BATCH
    ? line.product.batches
    : line.product.batches.filter((batch) => batch.id === line.batchId);

const availableStock = (line: SaleLine) => {
  const batches = chosenBatches(line);
  return line.quantityUnit === "pack"
    ? batches.reduce((sum, batch) => sum + batch.packQuantity, 0)
    : batches.reduce(
        (sum, batch) => sum + batch.packQuantity * line.product.unitsPerPack + batch.unitQuantity,
        0,
      );
};

export const lineError = (line: SaleLineView) => {
  if (line.kind !== "ready") {
    return line.kind === "loading" ? "Loading" : "Product no longer available";
  }
  const quantity = line.quantity;
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1) return "Enter a quantity";
  if (chosenBatches(line).length === 0 && line.batchId !== AUTO_BATCH)
    return "Batch no longer available";
  const available = availableStock(line);
  if (quantity > available) {
    return available === 0 ? "Out of stock" : `Only ${formatNumber(available)} in stock`;
  }
  if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0)
    return "Enter a price";
  return null;
};

const lineSalePrice = (line: SaleLine) => {
  if (line.salePrice == null || !Number.isFinite(line.salePrice) || line.salePrice < 0) return null;
  return Math.round(line.salePrice * 100);
};

export const discountedSalePrice = (line: SaleLine, bulkDiscount: number) => {
  const price = lineSalePrice(line);
  return price == null ? null : Math.round(price * (1 - bulkDiscount / 100));
};

export const lineTotal = (line: SaleLineView, bulkDiscount = 0) => {
  if (line.kind !== "ready") return null;
  const price = discountedSalePrice(line, bulkDiscount);
  if (
    line.quantity == null ||
    !Number.isInteger(line.quantity) ||
    line.quantity < 1 ||
    price == null
  )
    return null;
  return line.quantity * price;
};

export const lineUnits = (line: SaleLineView) =>
  line.kind === "ready"
    ? (line.quantity ?? 0) * (line.quantityUnit === "pack" ? line.product.unitsPerPack : 1)
    : 0;

export const isValidDiscount = (bulkDiscount: number | null): bulkDiscount is number =>
  bulkDiscount != null && bulkDiscount >= 0 && bulkDiscount <= 100;

export const saleTotal = (lines: ReadonlyArray<SaleLineView>, bulkDiscount: number | null) => {
  const discount = isValidDiscount(bulkDiscount) ? bulkDiscount : 0;
  return lines.reduce((sum, line) => sum + (lineTotal(line, discount) ?? 0), 0);
};

export const saleItems = (
  lines: ReadonlyArray<SaleLineView>,
  bulkDiscount: number,
): ReadonlyArray<CreateInvoiceLineInput> | null => {
  const items = lines.flatMap((line): ReadonlyArray<CreateInvoiceLineInput> => {
    if (line.kind !== "ready" || lineError(line) !== null) return [];
    const salePrice = discountedSalePrice(line, bulkDiscount);
    if (line.quantity == null || salePrice == null) return [];
    return [
      {
        productId: line.product.id,
        batchId: line.batchId === AUTO_BATCH ? null : line.batchId,
        quantity: line.quantity,
        quantityType: line.quantityUnit,
        salePrice,
      },
    ];
  });
  return items.length > 0 && items.length === lines.length ? items : null;
};

export const draftTotal = (draft: SaleDraft, lookup: ProductLookup) =>
  saleTotal(
    draft.lines.map((line) => resolveSaleLine(line, lookup)),
    draft.bulkDiscount,
  );
