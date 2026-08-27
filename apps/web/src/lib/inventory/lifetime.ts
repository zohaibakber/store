import type { HostInventoryScope } from "@/host-access";
import type { InventoryHost } from "@/lib/inventory-host";

import { inventoryScopeId, openInventory } from "./open";
import type { Inventory } from "./types";

export class StaleCatalogLease extends Error {
  readonly _tag = "StaleCatalogLease" as const;

  constructor() {
    super("Catalog lease is no longer current.");
    this.name = "StaleCatalogLease";
  }
}

export type CatalogLease = {
  readonly generation: number;
  readonly scope: HostInventoryScope;
};

export type CatalogReplica = {
  readonly dispose: () => Promise<void>;
};

export type CatalogLifetime<Replica extends CatalogReplica = Inventory> = {
  readonly generation: () => number;
  readonly lease: () => CatalogLease | null;
  readonly claim: (scope: HostInventoryScope) => CatalogLease;
  readonly release: () => void;
  readonly open: (lease: CatalogLease, host: InventoryHost) => Promise<Replica>;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const settle = (work: Promise<void>): Promise<void> =>
  work.then(
    () => undefined,
    () => undefined,
  );

export const createCatalogLifetime = <Replica extends CatalogReplica>(input: {
  readonly open: (host: InventoryHost, scope: HostInventoryScope) => Promise<Replica>;
  readonly databaseName: (host: InventoryHost, scope: HostInventoryScope) => string;
  readonly sameFileWaitMs?: number;
}): CatalogLifetime<Replica> => {
  const sameFileWaitMs = input.sameFileWaitMs ?? 8_000;
  let generation = 0;
  let lease: CatalogLease | null = null;
  let opened:
    | { readonly lease: CatalogLease; readonly replica: Replica; readonly databaseName: string }
    | undefined;
  const tailByDatabase = new Map<string, Promise<void>>();

  const enqueue = (databaseName: string, work: () => Promise<void>): Promise<void> => {
    const previous = tailByDatabase.get(databaseName) ?? Promise.resolve();
    const next = Promise.race([previous, delay(sameFileWaitMs)]).then(work, work);
    tailByDatabase.set(databaseName, settle(next));
    return next;
  };

  const retireOpened = () => {
    const previous = opened;
    opened = undefined;
    if (!previous) return;
    void enqueue(previous.databaseName, () => previous.replica.dispose());
  };

  return {
    generation: () => generation,
    lease: () => lease,
    claim: (scope) => {
      generation += 1;
      retireOpened();
      lease = { generation, scope };
      return lease;
    },
    release: () => {
      generation += 1;
      retireOpened();
      lease = null;
    },
    open: (requested, host) =>
      new Promise<Replica>((resolve, reject) => {
        const databaseName = input.databaseName(host, requested.scope);
        void enqueue(databaseName, async () => {
          if (requested.generation !== generation) {
            reject(new StaleCatalogLease());
            return;
          }
          const replica = await input.open(host, requested.scope);
          if (requested.generation !== generation) {
            await replica.dispose().catch(() => undefined);
            reject(new StaleCatalogLease());
            return;
          }
          opened = { lease: requested, replica, databaseName };
          resolve(replica);
        }).catch(reject);
      }),
  };
};

export const createAppCatalogLifetime = (): CatalogLifetime<Inventory> =>
  createCatalogLifetime({
    open: openInventory,
    databaseName: inventoryScopeId,
  });
