import {
  useSuspenseProductCount,
  useSuspenseSupplierCount,
  type Inventory,
} from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

const EVERY_PRODUCT = {};

export const useCatalogIsEmpty = (): boolean => useSuspenseProductCount(EVERY_PRODUCT) === 0;

export const useCatalogHoldsNothing = (): boolean => {
  const products = useSuspenseProductCount(EVERY_PRODUCT);
  const suppliers = useSuspenseSupplierCount();
  return products === 0 && suppliers === 0;
};

export const preloadCatalogIsEmpty = (inventory: Inventory): Effect.Effect<void, unknown> =>
  Effect.asVoid(
    AtomRegistry.getResult(inventory.atoms.registry, inventory.atoms.productCount(EVERY_PRODUCT)),
  );
