import {
  discountedPrice,
  isValidDiscount,
  lineTotal as priceTotal,
  moneyFromRupees,
  moneyToRupees,
  sumMoney,
  type CreateInvoiceLineInput,
  type Money,
  type Product,
} from "@store/contracts";
import * as Result from "effect/Result";

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

export const suggestedRupees = (product: Product, quantityUnit: SaleLine["quantityUnit"]) => {
  const price = suggestedPrice(product, quantityUnit);
  return price === null ? null : moneyToRupees(price);
};

export const enteredPrice = (
  product: Product,
  quantityUnit: SaleLine["quantityUnit"],
  salePrice: number | null,
): SaleDraftLine["price"] =>
  salePrice === suggestedRupees(product, quantityUnit) ? CATALOG_PRICE : salePrice;

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
      line.price === CATALOG_PRICE ? suggestedRupees(product, line.quantityUnit) : line.price,
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

const lineSalePrice = (line: SaleLine): Money | null =>
  line.salePrice === null ? null : Result.getOrNull(moneyFromRupees(line.salePrice));

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
  return lineSalePrice(line) === null ? "Enter a price" : null;
};

const discountedSalePrice = (line: SaleLine, bulkDiscount: number): Money | null => {
  const price = lineSalePrice(line);
  return price === null ? null : Result.getOrNull(discountedPrice(price, bulkDiscount));
};

export const lineTotal = (line: SaleLineView, bulkDiscount = 0): Money | null => {
  if (line.kind !== "ready" || line.quantity === null) return null;
  const price = discountedSalePrice(line, bulkDiscount);
  return price === null ? null : Result.getOrNull(priceTotal(line.quantity, price));
};

export const lineUnits = (line: SaleLineView) =>
  line.kind === "ready"
    ? (line.quantity ?? 0) * (line.quantityUnit === "pack" ? line.product.unitsPerPack : 1)
    : 0;

export const saleTotal = (lines: ReadonlyArray<SaleLineView>, bulkDiscount: number | null) => {
  const discount = isValidDiscount(bulkDiscount) ? bulkDiscount : 0;
  return sumMoney(lines.map((line) => lineTotal(line, discount)));
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
