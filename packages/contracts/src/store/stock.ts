import * as Result from "effect/Result";

import { CatalogRefusal } from "../catalog/refusal";

export type StockQuantityType = "pack" | "unit";

export type BatchStock = {
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export type StockTake = {
  readonly packsOpened: number;
  readonly packDelta: number;
  readonly unitDelta: number;
  readonly nextPackQuantity: number;
  readonly nextUnitQuantity: number;
};

export const baseUnitsOf = (stock: BatchStock, unitsPerPack: number): number =>
  stock.packQuantity * unitsPerPack + stock.unitQuantity;

export const stockDeltaOf = (
  take: {
    readonly quantity: number;
    readonly quantityType: StockQuantityType;
    readonly packsOpened: number;
  },
  unitsPerPack: number,
): { readonly packDelta: number; readonly unitDelta: number } =>
  take.quantityType === "pack"
    ? { packDelta: -take.quantity, unitDelta: 0 }
    : { packDelta: -take.packsOpened, unitDelta: take.packsOpened * unitsPerPack - take.quantity };

export const availableFor = (
  stock: BatchStock,
  unitsPerPack: number,
  quantityType: StockQuantityType,
): number => (quantityType === "pack" ? stock.packQuantity : baseUnitsOf(stock, unitsPerPack));

export const takeFromStock = (
  stock: BatchStock,
  product: { readonly name: string; readonly unitsPerPack: number },
  take: { readonly quantity: number; readonly quantityType: StockQuantityType },
): Result.Result<StockTake, CatalogRefusal> =>
  Result.gen(function* () {
    const available = availableFor(stock, product.unitsPerPack, take.quantityType);
    if (available < take.quantity) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "insufficientStock",
          message: `Not enough stock for ${product.name}: ${available} available, ${take.quantity} requested.`,
        }),
      );
    }
    const packsOpened =
      take.quantityType === "unit"
        ? Math.max(0, Math.ceil((take.quantity - stock.unitQuantity) / product.unitsPerPack))
        : 0;
    const { packDelta, unitDelta } = stockDeltaOf(
      { quantity: take.quantity, quantityType: take.quantityType, packsOpened },
      product.unitsPerPack,
    );
    const nextPackQuantity = stock.packQuantity + packDelta;
    const nextUnitQuantity = stock.unitQuantity + unitDelta;
    if (nextPackQuantity < 0 || nextUnitQuantity < 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "insufficientStock",
          message: `Not enough stock for ${product.name}.`,
        }),
      );
    }
    return { packsOpened, packDelta, unitDelta, nextPackQuantity, nextUnitQuantity };
  });

export const openPackMovementId = (allocation: {
  readonly saleMovementId: string;
  readonly openPackMovementId: string | null;
}): string => allocation.openPackMovementId ?? `${allocation.saleMovementId}:open-pack`;
