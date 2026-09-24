import { createCollection, IR } from "@tanstack/db";
import { describe, expect, it } from "vitest";

import { createInvoiceCoherenceGate, sqliteCollectionOptions } from "../src/replica/collection";
import { decodeCategorySqliteRows } from "../src/replica/decode";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import { subsetWindowKey } from "../src/replica/subset-window";
import type {
  InventoryCollectionDescriptor,
  ReplicaCommitNotice,
  ReplicaSubsetReader,
  SqliteResultRow,
} from "../src/replica/types";
import type { CategoryRow } from "../src/rows";

const descriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "test:categories",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: decodeCategorySqliteRows,
};

const categorySqlRow = (id: string, name: string): SqliteResultRow => ({
  id,
  name,
  tracksPacks: 1,
  createdAt: 1,
  updatedAt: 1,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "replica-1",
  operationId: "seed",
  rowVersion: 1,
});

describe("collection reactivity", () => {
  it("shares equivalent query windows under one acquisition", async () => {
    let reads = 0;
    const executor: ReplicaSubsetReader = {
      readSubset: async () => {
        reads += 1;
        return {
          stamp: { workspaceToken: "ws", generationId: "1", localCommitVersion: 1 },
          rows: [categorySqlRow("shared", "Shared")],
        };
      },
    };
    const options = sqliteCollectionOptions(descriptor, {
      executor,
      changeFeed: { subscribe: () => () => undefined },
    });
    const collection = createCollection(options);
    collection.subscribeChanges(() => undefined);
    const first = {
      where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("shared")]),
      limit: 10,
    };
    const second = {
      where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("shared")]),
      limit: 10,
    };
    expect(subsetWindowKey(first)).toBe(subsetWindowKey(second));
    await options.utils.loadSubset(first);
    await options.utils.loadSubset(second);
    expect(reads).toBe(2);
    options.utils.unloadSubset(first);
    expect(collection.get("shared")?.name).toBe("Shared");
    options.utils.unloadSubset(second);
    expect(collection.get("shared")).toBeUndefined();
  });

  it("coalesces rapid commits to the newest version", async () => {
    const versions: Array<number> = [];
    let localCommitVersion = 1;
    const listeners: Array<(notice: ReplicaCommitNotice) => void> = [];
    const executor: ReplicaSubsetReader = {
      readSubset: async () => {
        await Promise.resolve();
        versions.push(localCommitVersion);
        return {
          stamp: { workspaceToken: "ws", generationId: "1", localCommitVersion },
          rows: [categorySqlRow("a", `v${localCommitVersion}`)],
        };
      },
    };
    const options = sqliteCollectionOptions(descriptor, {
      executor,
      changeFeed: {
        subscribe: (listener) => {
          listeners.push(listener);
          return () => undefined;
        },
      },
    });
    const collection = createCollection(options);
    const rowUpdatedToV5 = new Promise<void>((resolve) => {
      collection.subscribeChanges(() => {
        if (collection.get("a")?.name === "v5") resolve();
      });
    });
    await options.utils.loadSubset({ limit: 10 });
    expect(listeners).toHaveLength(1);
    localCommitVersion = 2;
    listeners[0]!({
      workspaceToken: "ws",
      generationId: "1",
      localCommitVersion: 2,
      touchedEntities: ["category"],
      touchedKeys: ["a"],
    });
    localCommitVersion = 5;
    listeners[0]!({
      workspaceToken: "ws",
      generationId: "1",
      localCommitVersion: 5,
      touchedEntities: ["category"],
      touchedKeys: ["a"],
    });
    await rowUpdatedToV5;
    expect(collection.get("a")?.name).toBe("v5");
    expect(versions.at(-1)).toBe(5);
    expect(versions.filter((version) => version === 2)).toHaveLength(0);
  });

  it("gates invoice coherence until invoice, items, and stock settle", async () => {
    const gate = createInvoiceCoherenceGate();
    const unregisterInvoice = gate.registerSource("invoice");
    const unregisterItems = gate.registerSource("invoiceItem");
    const unregisterStock = gate.registerSource("stockMovement");
    const published: Array<string> = [];
    const stamp = {
      workspaceToken: "ws",
      generationId: "1",
      localCommitVersion: 3,
    };
    const touched = ["invoice", "invoiceItem", "stockMovement"] as const;
    const invoice = gate.publish("invoice", stamp, [...touched], async () => {
      published.push("invoice");
    });
    const items = gate.publish("invoiceItem", stamp, [...touched], async () => {
      published.push("items");
    });
    expect(published).toEqual([]);
    const stock = gate.publish("stockMovement", stamp, [...touched], async () => {
      published.push("stock");
    });
    await Promise.all([invoice, items, stock]);
    expect(published).toEqual(["invoice", "items", "stock"]);
    unregisterInvoice();
    unregisterItems();
    unregisterStock();
  });
});
