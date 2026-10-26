import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { CatalogOpenFailure } from "./errors";
import type { InventoryHost, InventoryScope } from "./host";
import type { Inventory, InventoryState } from "./types";
import { openCatalog } from "./workspace";

export type CatalogOpening = Atom.Atom<AsyncResult.AsyncResult<Inventory, CatalogOpenFailure>>;

export type Catalogs = {
  readonly catalog: (scope: InventoryScope) => CatalogOpening;
  readonly held: Atom.Atom<void>;
};

export const claimedCatalogScope = Atom.make(Option.none<InventoryScope>()).pipe(Atom.keepAlive);

export const makeCatalogs = (host: InventoryHost): Catalogs => {
  const catalog = Atom.family((scope: InventoryScope): CatalogOpening =>
    Atom.make(openCatalog(host, scope)).pipe(Atom.setIdleTTL(0)),
  );
  const held = Atom.make((get) => {
    const scope = get(claimedCatalogScope);
    if (Option.isSome(scope)) get.mount(catalog(scope.value));
  }).pipe(Atom.keepAlive);
  return { catalog, held };
};

const OPENING: InventoryState = { _tag: "Opening" };

const CATALOG_UNAVAILABLE = "Catalog storage is unavailable.";

export const inventoryState = (
  result: AsyncResult.AsyncResult<Inventory, CatalogOpenFailure>,
  retry: () => void,
): InventoryState =>
  AsyncResult.matchWithWaiting(result, {
    onWaiting: () => OPENING,
    onSuccess: ({ value }): InventoryState => ({ _tag: "Ready", inventory: value }),
    onError: (failure): InventoryState => ({ _tag: "Error", error: failure.message, retry }),
    onDefect: (): InventoryState => ({ _tag: "Error", error: CATALOG_UNAVAILABLE, retry }),
  });
