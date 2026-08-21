import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import {
  saveBatchDetails as saveBatchDetailsMutation,
  saveScannedProduct as saveScannedProductMutation,
  updateBatchQuantity as updateBatchQuantityMutation,
} from "@/lib/inventory-mutations";
import { resolveOrganizationId } from "@/lib/inventory-session";
import {
  type InventoryAccess,
  readLocalInventorySnapshot,
  synchronizeInventory,
} from "@/lib/inventory-sync";
import type {
  InventorySnapshot,
  MobileBatch,
  MobileProduct,
  SaveBatchDetailsInput,
  SaveScannedProductInput,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";

export type InventoryWorkspace = {
  readonly userId: string;
  readonly organizationId: string;
  readSnapshot(): Promise<InventorySnapshot>;
  synchronize(): Promise<InventorySnapshot>;
  saveScannedProduct(input: SaveScannedProductInput): Promise<MobileProduct>;
  saveBatchDetails(input: SaveBatchDetailsInput): Promise<MobileBatch>;
  updateBatchQuantity(input: UpdateBatchQuantityInput): Promise<MobileBatch>;
};

export type InventoryWorkspaceFactory = {
  open(userId: string): Promise<InventoryWorkspace>;
  close(): void;
};

const withPermit = <T>(lock: Semaphore.Semaphore, work: () => Promise<T>): Promise<T> =>
  Effect.runPromise(
    lock.withPermit(
      Effect.tryPromise({
        try: work,
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    ),
  );

class InventoryWorkspaceImpl implements InventoryWorkspace, InventoryAccess {
  readonly userId: string;
  readonly organizationId: string;
  readonly #mutationLock = Semaphore.makeUnsafe(1);
  readonly #syncLock = Semaphore.makeUnsafe(1);
  #closed = false;

  constructor(userId: string, organizationId: string) {
    this.userId = userId;
    this.organizationId = organizationId;
  }

  get closed() {
    return this.#closed;
  }

  close() {
    this.#closed = true;
  }

  readonly withLock = <T>(work: () => Promise<T>): Promise<T> => {
    this.#assertOpen();
    return withPermit(this.#mutationLock, work);
  };

  readonly withSyncLock = <T>(work: () => Promise<T>): Promise<T> => {
    this.#assertOpen();
    return withPermit(this.#syncLock, work);
  };

  readSnapshot(): Promise<InventorySnapshot> {
    this.#assertOpen();
    return readLocalInventorySnapshot(this);
  }

  synchronize(): Promise<InventorySnapshot> {
    this.#assertOpen();
    return synchronizeInventory(this);
  }

  saveScannedProduct(input: SaveScannedProductInput): Promise<MobileProduct> {
    this.#assertOpen();
    return saveScannedProductMutation(this, input);
  }

  saveBatchDetails(input: SaveBatchDetailsInput): Promise<MobileBatch> {
    this.#assertOpen();
    return saveBatchDetailsMutation(this, input);
  }

  updateBatchQuantity(input: UpdateBatchQuantityInput): Promise<MobileBatch> {
    this.#assertOpen();
    return updateBatchQuantityMutation(this, input);
  }

  #assertOpen() {
    if (this.#closed) throw new Error("Inventory workspace is closed.");
  }
}

let current: InventoryWorkspaceImpl | null = null;
let opening: Promise<InventoryWorkspaceImpl> | null = null;
let epoch = 0;

export const inventoryWorkspaceFactory: InventoryWorkspaceFactory = {
  async open(userId: string) {
    if (current && !current.closed && current.userId === userId) return current;
    if (opening) {
      const inFlight = await opening;
      if (!inFlight.closed && inFlight.userId === userId) return inFlight;
    }

    inventoryWorkspaceFactory.close();
    const openEpoch = epoch;

    const task = (async () => {
      const organizationId = await resolveOrganizationId(userId);
      const workspace = new InventoryWorkspaceImpl(userId, organizationId);
      if (openEpoch !== epoch) {
        workspace.close();
        throw new Error("Inventory workspace open was cancelled.");
      }
      current = workspace;
      return workspace;
    })();

    opening = task;
    try {
      return await task;
    } finally {
      if (opening === task) opening = null;
    }
  },

  close() {
    epoch += 1;
    opening = null;
    if (!current) return;
    current.close();
    current = null;
  },
};
