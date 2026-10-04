import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Schedule from "effect/Schedule";

import type { CatalogOpenFailure, StaleCatalogLease } from "./errors";
import type { InventoryHost, InventoryScope } from "./host";
import type { Inventory, InventoryState } from "./types";
import type { CatalogLease, CatalogLifetime } from "./workspace";

export type CatalogOpening = Atom.Atom<
  AsyncResult.AsyncResult<Inventory, StaleCatalogLease | CatalogOpenFailure>
>;

const OPENING: InventoryState = { _tag: "Opening" };

const CATALOG_UNAVAILABLE = "Catalog storage is unavailable.";

const openRetrySchedule = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

export const closedCatalog: CatalogOpening = Atom.make(Effect.never);

const leaseMatches = (lease: CatalogLease | null, scope: InventoryScope): lease is CatalogLease =>
  lease !== null &&
  lease.scope.organizationId === scope.organizationId &&
  lease.scope.userId === scope.userId;

export const openingCatalog = (
  lifetime: CatalogLifetime,
  owned: boolean,
  host: InventoryHost,
  scope: InventoryScope,
  lease: CatalogLease | undefined,
): CatalogOpening =>
  Atom.make((get) => {
    const current = lifetime.lease();
    const claimed = lease ?? (leaseMatches(current, scope) ? current : lifetime.claim(scope));
    if (owned) {
      get.addFinalizer(() => {
        if (lifetime.lease() === claimed) lifetime.release();
      });
    }
    return lifetime.open(claimed, host).pipe(
      Effect.retry({
        schedule: openRetrySchedule,
        while: (failure) => failure._tag === "CatalogOpenFailure",
      }),
    );
  });

export const inventoryState = (
  result: AsyncResult.AsyncResult<Inventory, StaleCatalogLease | CatalogOpenFailure>,
  retry: () => void,
): InventoryState =>
  AsyncResult.matchWithWaiting(result, {
    onWaiting: () => OPENING,
    onSuccess: ({ value }): InventoryState => ({
      _tag: "Ready",
      inventory: value,
      actions: value.actions,
    }),
    onError: (failure): InventoryState =>
      failure._tag === "StaleCatalogLease"
        ? OPENING
        : { _tag: "Error", error: failure.message, retry },
    onDefect: (): InventoryState => ({ _tag: "Error", error: CATALOG_UNAVAILABLE, retry }),
  });
