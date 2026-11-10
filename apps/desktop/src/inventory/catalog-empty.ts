import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { useSuspenseProductCount } from "./queries";
import type { Inventory } from "./types";

const EVERY_PRODUCT = {};

export const useCatalogIsEmpty = (): boolean => useSuspenseProductCount(EVERY_PRODUCT) === 0;

export const preloadCatalogIsEmpty = (inventory: Inventory): Effect.Effect<void, unknown> =>
  Effect.asVoid(
    AtomRegistry.getResult(inventory.atoms.registry, inventory.atoms.productCount(EVERY_PRODUCT)),
  );
