import {
  purchaseOrderLineRemaining,
  receivedBaseUnitsOf,
  type Product,
  type PurchaseOrderItem,
} from "@store/contracts";

import type { ReceiveDeliveryLineInput } from "@/lib/inventory";

import { byProductName } from "./presentation";

export type ReceiveProduct = {
  readonly tracksPacks: boolean;
  readonly unitsPerPack: number;
  readonly purchasePrice: number | null;
};

export type ReceiveRow = {
  readonly key: string;
  readonly itemId: PurchaseOrderItem["id"];
  readonly batchNumber: string;
  readonly expiresAt: number | null;
  readonly packs: number | null;
  readonly units: number | null;
  readonly cost: number | null;
};

export type ReceiveProducts = ReadonlyMap<string, ReceiveProduct>;

export const MAX_BATCH_NUMBER_LENGTH = 64;

export const receiveProductsOf = (products: ReadonlyArray<Product>): ReceiveProducts =>
  new Map(
    products.map((product) => [
      product.id,
      {
        tracksPacks: product.category.tracksPacks,
        unitsPerPack: product.unitsPerPack,
        purchasePrice: product.purchasePrice,
      },
    ]),
  );

const splitBaseUnits = (baseUnits: number, product: ReceiveProduct) =>
  product.tracksPacks
    ? {
        packs: Math.floor(baseUnits / product.unitsPerPack),
        units: baseUnits % product.unitsPerPack,
      }
    : { packs: 0, units: baseUnits };

const isCount = (value: number | null) => value === null || (Number.isInteger(value) && value >= 0);

const rowBaseUnits = (row: Pick<ReceiveRow, "packs" | "units">, product: ReceiveProduct) =>
  receivedBaseUnitsOf(
    { packQuantity: row.packs ?? 0, unitQuantity: row.units ?? 0 },
    product.unitsPerPack,
  );

const rowCost = (row: ReceiveRow, product: ReceiveProduct): number | null =>
  row.cost === null
    ? null
    : Math.round((rowBaseUnits(row, product) * row.cost) / product.unitsPerPack);

export type ReceiveRowProblem = "quantity" | "cost" | "batchNumber";

export const rowProblems = (row: ReceiveRow): ReadonlySet<ReceiveRowProblem> => {
  const problems = new Set<ReceiveRowProblem>();
  if (!isCount(row.packs) || !isCount(row.units)) problems.add("quantity");
  if (row.cost !== null && (!Number.isSafeInteger(row.cost) || row.cost < 0)) problems.add("cost");
  if (row.batchNumber.trim().length > MAX_BATCH_NUMBER_LENGTH) problems.add("batchNumber");
  return problems;
};

const rowKey = (itemId: string, index: number) => `${itemId}:${index}`;

const blankRow = (item: PurchaseOrderItem, product: ReceiveProduct | undefined): ReceiveRow => ({
  key: rowKey(item.id, 0),
  itemId: item.id,
  batchNumber: "",
  expiresAt: null,
  packs: null,
  units: null,
  cost: product?.purchasePrice ?? item.packCost,
});

const countOrBlank = (value: number) => (value === 0 ? null : value);

const remainingRow = (item: PurchaseOrderItem, product: ReceiveProduct | undefined): ReceiveRow => {
  const blank = blankRow(item, product);
  if (!product) return blank;
  const due = splitBaseUnits(purchaseOrderLineRemaining(item), product);
  return { ...blank, packs: countOrBlank(due.packs), units: countOrBlank(due.units) };
};

const prefilledRow = (
  item: PurchaseOrderItem,
  product: ReceiveProduct,
  line: ReceiveDeliveryLineInput,
  index: number,
): ReceiveRow => {
  const stated = { packs: line.packQuantity ?? 0, units: line.unitQuantity ?? 0 };
  const kept = product.tracksPacks
    ? stated
    : splitBaseUnits(
        receivedBaseUnitsOf(
          { packQuantity: stated.packs, unitQuantity: stated.units },
          product.unitsPerPack,
        ),
        product,
      );
  return {
    key: rowKey(item.id, index),
    itemId: item.id,
    batchNumber: product.tracksPacks ? (line.batchNumber?.trim() ?? "") : "",
    expiresAt: line.expiresAt ?? null,
    packs: countOrBlank(kept.packs),
    units: countOrBlank(kept.units),
    cost: line.purchasePrice ?? product.purchasePrice ?? item.packCost,
  };
};

export const initialReceiveRows = (
  lines: ReadonlyArray<PurchaseOrderItem>,
  productOf: (item: PurchaseOrderItem) => ReceiveProduct | undefined,
  prefill: ReadonlyArray<ReceiveDeliveryLineInput> | undefined,
): ReadonlyArray<ReceiveRow> => {
  const items = [...lines].sort(byProductName);
  if (prefill === undefined || prefill.length === 0) {
    return items.map((item) => remainingRow(item, productOf(item)));
  }
  return items.flatMap((item) => {
    const product = productOf(item);
    const lines = prefill.filter((line) => line.purchaseOrderItemId === item.id);
    return product === undefined || lines.length === 0
      ? [blankRow(item, product)]
      : lines.map((line, index) => prefilledRow(item, product, line, index));
  });
};

export const splitRow = (
  rows: ReadonlyArray<ReceiveRow>,
  key: string,
  nextKey: string,
): ReadonlyArray<ReceiveRow> =>
  rows.flatMap((row) =>
    row.key === key
      ? [
          row,
          {
            key: nextKey,
            itemId: row.itemId,
            batchNumber: "",
            expiresAt: null,
            packs: null,
            units: null,
            cost: row.cost,
          },
        ]
      : [row],
  );

export const receiveLineInputs = (
  rows: ReadonlyArray<ReceiveRow>,
  productOfItem: (itemId: string) => ReceiveProduct | undefined,
): ReadonlyArray<ReceiveDeliveryLineInput> =>
  rows.flatMap((row) => {
    const product = productOfItem(row.itemId);
    if (!product || rowBaseUnits(row, product) === 0) return [];
    return [
      {
        purchaseOrderItemId: row.itemId,
        batchNumber: row.batchNumber.trim() || null,
        expiresAt: row.expiresAt,
        packQuantity: row.packs ?? 0,
        unitQuantity: row.units ?? 0,
        ...(row.cost === null || row.cost === product.purchasePrice
          ? null
          : { purchasePrice: row.cost }),
      },
    ];
  });

export type DeliverySummary = {
  readonly lines: number;
  readonly baseUnits: number;
  readonly cost: number;
  readonly completesOrder: boolean;
  readonly enteredByItem: ReadonlyMap<string, number>;
};

export const summarizeDelivery = (
  items: ReadonlyArray<PurchaseOrderItem>,
  rows: ReadonlyArray<ReceiveRow>,
  productOfItem: (itemId: string) => ReceiveProduct | undefined,
): DeliverySummary => {
  const enteredByItem = new Map<string, number>();
  let lines = 0;
  let baseUnits = 0;
  let cost = 0;
  for (const row of rows) {
    const product = productOfItem(row.itemId);
    if (!product || rowProblems(row).has("quantity")) continue;
    const entered = rowBaseUnits(row, product);
    if (entered === 0) continue;
    lines += 1;
    baseUnits += entered;
    cost += rowCost(row, product) ?? 0;
    enteredByItem.set(row.itemId, (enteredByItem.get(row.itemId) ?? 0) + entered);
  }
  return {
    lines,
    baseUnits,
    cost,
    enteredByItem,
    completesOrder:
      items.length > 0 &&
      items.every((item) => purchaseOrderLineRemaining(item) <= (enteredByItem.get(item.id) ?? 0)),
  };
};
