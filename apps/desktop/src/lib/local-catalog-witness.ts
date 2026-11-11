import { useAtomMount } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";

import type { Workspace } from "@/host-access";
import { shell } from "@/host/shell";
import { useReadyInventory } from "@/inventory/provider";
import type { Inventory } from "@/inventory/types";
import { witnessLocalCatalog } from "@/session/workspace-session";

const witnessLocalFile = (get: Atom.AtomContext) =>
  Effect.flatMap(shell, (client) => client.PublishLocalCatalog()).pipe(
    Effect.flatMap((report) =>
      report._tag === "unknown"
        ? Effect.void
        : Effect.sync(() => get.set(witnessLocalCatalog, report._tag)),
    ),
    Effect.ignore,
  );

const openLocalCatalog = (inventory: Inventory) =>
  Atom.make((get) =>
    get.result(inventory.atoms.catalogHoldsNothing).pipe(
      Effect.andThen(() => witnessLocalFile(get)),
      Effect.ignore,
    ),
  );

const closedLocalCatalog = Atom.make((get) => witnessLocalFile(get));

const unwitnessed = Atom.make(undefined);

export const useLocalCatalogWitness = (workspace: Workspace) => {
  const inventory = useReadyInventory()?.inventory;
  const witness: Atom.Atom<unknown> = useMemo(() => {
    if (inventory === undefined) return unwitnessed;
    switch (workspace._tag) {
      case "Local":
        return openLocalCatalog(inventory);
      case "Organization":
        return closedLocalCatalog;
      case "None":
        return unwitnessed;
    }
  }, [inventory, workspace._tag]);
  useAtomMount(witness);
};
