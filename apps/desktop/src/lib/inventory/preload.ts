import { claimedCatalogScope, type Inventory } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { HostInventory } from "./host-inventory";

const PRELOAD_BUDGET = "750 millis";

export const preloadInventory = (
  context: {
    readonly registry: AtomRegistry.AtomRegistry;
    readonly inventory: HostInventory;
  },
  preload: (inventory: Inventory) => Effect.Effect<void, unknown> = () => Effect.void,
): Promise<void> => {
  const scope = context.registry.get(claimedCatalogScope);
  if (Option.isNone(scope) || context.inventory._tag !== "Replica") return Promise.resolve();
  return Effect.runPromise(
    AtomRegistry.getResult(context.registry, context.inventory.catalogs.catalog(scope.value)).pipe(
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
