import type { CatalogLifetime, Inventory, InventoryHost } from "@store/inventory-react";
import * as Effect from "effect/Effect";

const PRELOAD_BUDGET = "750 millis";

export const preloadInventory = (
  context: { readonly catalog: CatalogLifetime; readonly inventory: InventoryHost | null },
  preload: (inventory: Inventory) => Effect.Effect<void, unknown>,
): Promise<void> => {
  const lease = context.catalog.lease();
  if (lease === null || context.inventory === null) return Promise.resolve();
  return Effect.runPromise(
    context.catalog
      .open(lease, context.inventory)
      .pipe(Effect.flatMap(preload), Effect.timeout(PRELOAD_BUDGET), Effect.ignore),
  );
};
