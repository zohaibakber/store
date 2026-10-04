import type { CatalogLifetime, Inventory } from "@store/inventory-react";
import * as Effect from "effect/Effect";

import type { HostInventory } from "./host-inventory";

const PRELOAD_BUDGET = "750 millis";

export const preloadInventory = (
  context: { readonly catalog: CatalogLifetime; readonly inventory: HostInventory },
  preload: (inventory: Inventory) => Effect.Effect<void, unknown> = () => Effect.void,
): Promise<void> => {
  const lease = context.catalog.lease();
  if (lease === null || context.inventory._tag !== "Replica") return Promise.resolve();
  return Effect.runPromise(
    context.catalog.open(lease, context.inventory.host).pipe(
      Effect.flatMap((inventory) =>
        inventory.atoms.registry.get(inventory.atoms.syncActivity).firstSyncPending
          ? Effect.void
          : preload(inventory),
      ),
      Effect.timeout(PRELOAD_BUDGET),
      Effect.ignore,
    ),
  );
};
