import { createCollection, IR } from "@tanstack/db";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import { createInvoiceCoherenceGate, sqliteCollectionOptions } from "../src/replica/collection";
import { decodeCategorySqliteRows } from "../src/replica/decode";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import type { InventorySubsetSpec } from "../src/replica/subset-spec";
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

const stamp = { workspaceToken: "ws", generationId: "1", localCommitVersion: 1 };

const byId = (id: string) => new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value(id)]);

const isId = Schema.is(Schema.String);

const requestedIds = (spec: InventorySubsetSpec): ReadonlyArray<string> => {
  const where = spec.where;
  if (where?._tag === "compare" && isId(where.value)) return [where.value];
  if (where?._tag === "in") return where.values.filter(isId);
  return [];
};

const noFeed = { subscribe: () => () => undefined };

describe("collection reactivity", () => {
  it("keeps a shared window for its remaining owner when a peer releases before loading", async () => {
    let reads = 0;
    const executor: ReplicaSubsetReader = {
      readSubset: async (spec) => {
        reads += 1;
        return {
          stamp,
          rows: requestedIds(spec).map((id) => categorySqlRow(id, id.toUpperCase())),
        };
      },
    };
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, { executor, changeFeed: noFeed }),
    );
    const watch = (id: string) =>
      collection.subscribeChanges(() => undefined, {
        includeInitialState: true,
        whereExpression: byId(id),
      });
    const unmounted = watch("shared");
    const mounted = watch("shared");
    unmounted.unsubscribe();
    const sentinel = watch("sentinel");
    await vi.waitFor(() => expect(collection.get("sentinel")?.name).toBe("SENTINEL"));
    expect(collection.get("shared")?.name).toBe("SHARED");
    const readsBeforeJoin = reads;
    const joined = watch("shared");
    mounted.unsubscribe();
    sentinel.unsubscribe();
    await vi.waitFor(() => expect(collection.get("sentinel")).toBeUndefined());
    expect(collection.get("shared")?.name).toBe("SHARED");
    expect(reads).toBe(readsBeforeJoin);
    joined.unsubscribe();
    await vi.waitFor(() => expect(collection.get("shared")).toBeUndefined());
  });

  it("marks an eager collection ready only after its rows are published", async () => {
    const sizeAtReady: Array<number> = [];
    const collection = createCollection(
      sqliteCollectionOptions(
        { ...descriptor, syncMode: "eager" },
        {
          executor: {
            readSubset: async () => ({
              stamp,
              rows: [categorySqlRow("a", "A"), categorySqlRow("b", "B")],
            }),
          },
          changeFeed: noFeed,
        },
      ),
    );
    collection.on("status:change", ({ status }) => {
      if (status === "ready") sizeAtReady.push(collection.size);
    });
    await collection.preload();
    expect(sizeAtReady).toEqual([2]);

    const failing = createCollection(
      sqliteCollectionOptions(
        { ...descriptor, id: "test:failing", syncMode: "eager" },
        {
          executor: { readSubset: () => Promise.reject(new Error("replica unavailable")) },
          changeFeed: noFeed,
        },
      ),
    );
    await expect(failing.preload()).rejects.toThrow();
    expect(failing.status).toBe("error");
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
          stamp: { ...stamp, localCommitVersion },
          rows: [categorySqlRow("a", `v${localCommitVersion}`)],
        };
      },
    };
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, {
        executor,
        changeFeed: {
          subscribe: (listener) => {
            listeners.push(listener);
            return () => undefined;
          },
        },
      }),
    );
    collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: byId("a"),
    });
    await vi.waitFor(() => expect(collection.get("a")?.name).toBe("v1"));
    const notify = (version: number) => {
      localCommitVersion = version;
      listeners[0]!({
        ...stamp,
        localCommitVersion: version,
        touchedEntities: ["category"],
        touchedKeys: ["a"],
      });
    };
    notify(2);
    notify(5);
    await vi.waitFor(() => expect(collection.get("a")?.name).toBe("v5"));
    expect(versions.at(-1)).toBe(5);
    expect(versions.filter((version) => version === 2)).toHaveLength(0);
  });

  it("replaces rows when a new snapshot generation activates", async () => {
    let current = stamp;
    let rows = [categorySqlRow("old", "Old")];
    const listeners: Array<(notice: ReplicaCommitNotice) => void> = [];
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, {
        executor: { readSubset: async () => ({ stamp: current, rows }) },
        changeFeed: {
          subscribe: (listener) => {
            listeners.push(listener);
            return () => undefined;
          },
        },
      }),
    );
    collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(["old", "new"])]),
    });
    await vi.waitFor(() => expect(collection.get("old")?.name).toBe("Old"));
    current = { workspaceToken: "ws", generationId: "2", localCommitVersion: 2 };
    rows = [categorySqlRow("new", "New")];
    listeners[0]!({ ...current, touchedEntities: ["category"], touchedKeys: [] });
    await vi.waitFor(() => expect(collection.toArray.map((row) => row.id)).toEqual(["new"]));
  });

  it("gates invoice coherence until invoice, items, and stock settle", async () => {
    const gate = createInvoiceCoherenceGate();
    const unregisterInvoice = gate.registerSource("invoice");
    const unregisterItems = gate.registerSource("invoiceItem");
    const unregisterStock = gate.registerSource("stockMovement");
    const published: Array<string> = [];
    const coherent = { ...stamp, localCommitVersion: 3 };
    const touched = ["invoice", "invoiceItem", "stockMovement"] as const;
    const invoice = gate.publish("invoice", coherent, [...touched], async () => {
      published.push("invoice");
    });
    const items = gate.publish("invoiceItem", coherent, [...touched], async () => {
      published.push("items");
    });
    expect(published).toEqual([]);
    const stock = gate.publish("stockMovement", coherent, [...touched], async () => {
      published.push("stock");
    });
    await Promise.all([invoice, items, stock]);
    expect(published).toEqual(["invoice", "items", "stock"]);
    unregisterInvoice();
    unregisterItems();
    unregisterStock();
  });
});
