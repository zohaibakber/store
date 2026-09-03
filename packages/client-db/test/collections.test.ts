import { decodeCategoryId } from "@store/contracts/ids";
import type { ReplicaDiff, ReplicaSnapshot } from "@store/sync";
import { describe, expect, it } from "vitest";

import { catalogMemoryCollectionConfigs } from "../src/collections";
import type { CategoryRow } from "../src/rows";

const category = (name: string, rowVersion: number): CategoryRow => ({
  id: decodeCategoryId("category-1"),
  name,
  tracksPacks: true,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: `operation-${String(rowVersion)}`,
  rowVersion,
  createdAt: 100,
  updatedAt: 100 + rowVersion,
  deletedAt: null,
});

const snapshot = (row: CategoryRow): ReplicaSnapshot => ({
  cursor: 1,
  outbox: [],
  rows: {
    category: [row],
    product: [],
    batch: [],
    invoice: [],
    invoiceItem: [],
    stockMovement: [],
  },
});

describe("catalog memory collections", () => {
  it("replays changes that arrive while the initial snapshot is loading", async () => {
    let publish: ((diff: ReplicaDiff) => void) | undefined;
    let resolveSnapshot: ((value: ReplicaSnapshot) => void) | undefined;
    const initialSnapshot = new Promise<ReplicaSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    const rows = new Map<string, CategoryRow>();
    let ready = false;

    const config = catalogMemoryCollectionConfigs({
      scopeId: "scope-1",
      snapshot: () => initialSnapshot,
      subscribe: (listener) => {
        publish = listener;
        return () => undefined;
      },
      persistCatalog: () => Promise.resolve(),
    }).categories;

    config.sync.sync({
      begin: () => undefined,
      write: (message) => {
        if (message.type === "delete") rows.delete(message.key);
        else rows.set(message.value.id, message.value);
      },
      commit: () => undefined,
      markReady: () => {
        ready = true;
      },
    });

    if (!publish || !resolveSnapshot) throw new Error("Collection sync did not start.");
    const current = category("Current", 2);
    publish({
      entity: "category",
      upserts: [{ id: current.id, row: current }],
      deletes: [],
    });
    resolveSnapshot(snapshot(category("Stale", 1)));
    await initialSnapshot;
    await Promise.resolve();

    expect(ready).toBe(true);
    expect(rows.get(current.id)).toEqual(current);
  });
});
