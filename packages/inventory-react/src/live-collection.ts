import {
  createLiveQueryCollection,
  getStableQueryBuilderHash,
  Query,
  type Context,
  type InitialQueryBuilder,
  type QueryBuilder,
} from "@tanstack/react-db";

import type { Inventory } from "./types";

const IDLE_GC_TIME_MS = 30_000;

const openCollection = <QueryContext extends Context>(built: QueryBuilder<QueryContext>) =>
  createLiveQueryCollection({ query: () => built, gcTime: IDLE_GC_TIME_MS, startSync: true });

type LiveCollection<QueryContext extends Context> = ReturnType<typeof openCollection<QueryContext>>;

export const sharedLiveQuery = <Args extends ReadonlyArray<unknown>, QueryContext extends Context>(
  query: (
    inventory: Inventory,
    ...args: Args
  ) => (builder: InitialQueryBuilder) => QueryBuilder<QueryContext>,
) => {
  const held = new WeakMap<Inventory, Map<string, LiveCollection<QueryContext>>>();
  const heldBy = (inventory: Inventory) => {
    const known = held.get(inventory);
    if (known !== undefined) return known;
    const opened = new Map<string, LiveCollection<QueryContext>>();
    held.set(inventory, opened);
    return opened;
  };
  return (inventory: Inventory, ...args: Args): LiveCollection<QueryContext> => {
    const built = query(inventory, ...args)(new Query());
    const key = getStableQueryBuilderHash(built);
    const collections = heldBy(inventory);
    const existing = collections.get(key);
    if (existing !== undefined) return existing;
    const collection = openCollection(built);
    const release = () => {
      if (collections.get(key) !== collection) return;
      collections.delete(key);
      stopCleanedUp();
      stopError();
    };
    const stopCleanedUp = collection.on("status:cleaned-up", release);
    const stopError = collection.on("status:error", () => setTimeout(release, 0));
    collections.set(key, collection);
    return collection;
  };
};
