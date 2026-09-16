import { decodeCategoryId } from "@store/contracts/ids";
import { createCollection, IR } from "@tanstack/db";
import { describe, expect, it } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import { decodeCategorySqliteRows } from "../src/replica/decode";
import { UnsupportedSubsetQuery } from "../src/replica/errors";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import type {
  InventoryCollectionDescriptor,
  ReplicaCommitNotice,
  ReplicaSqlExecutor,
  SqliteResultRow,
} from "../src/replica/types";
import type { CategoryRow } from "../src/rows";

const identity = {
  organizationId: "org-1",
  userId: "user-1",
  replicaId: "replica-1",
};

const categoryRow = (id: string, name: string): CategoryRow => ({
  id: decodeCategoryId(id),
  name,
  tracksPacks: true,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "replica-1",
  operationId: "seed",
  rowVersion: 1,
});

const descriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "test:categories",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows: decodeCategorySqliteRows,
};

const insertCategory = (
  replica: ReturnType<typeof openNodeReplicaSqlite>,
  id: string,
  name: string,
) => {
  replica.withWrite(
    (sqlite) => {
      sqlite
        .prepare(
          `insert into categories (
            id, name, tracksPacks, createdAt, updatedAt, deletedAt,
            organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
          ) values (?, ?, 1, 1, 1, null, ?, ?, ?, ?, 'seed', 1)`,
        )
        .run(
          id,
          name,
          identity.organizationId,
          identity.userId,
          identity.userId,
          identity.replicaId,
        );
    },
    ["category"],
    [id],
  );
};

const startCollection = (replica: ReturnType<typeof openNodeReplicaSqlite>) => {
  const options = sqliteCollectionOptions(descriptor, {
    executor: replica,
    changeFeed: replica,
  });
  const collection = createCollection(options);
  collection.subscribeChanges(() => undefined);
  return { collection, options };
};

describe("sqliteCollectionOptions", () => {
  it("publishes a change committed between listener registration and the baseline read", async () => {
    const token = "workspace-a";
    const generation = "1";
    const late = categoryRow("late", "Late");
    const queued: Array<(notice: ReplicaCommitNotice) => void> = [];
    let reads = 0;
    const executor: ReplicaSqlExecutor = {
      stamp: () => ({
        workspaceToken: token,
        generationId: generation,
        localCommitVersion: reads === 0 ? 1 : 2,
      }),
      query: () => {
        reads += 1;
        if (reads === 1) return [];
        return [
          {
            id: late.id,
            name: late.name,
            tracksPacks: 1,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
            organizationId: late.organizationId,
            createdByUserId: late.createdByUserId,
            updatedByUserId: late.updatedByUserId,
            deviceId: late.deviceId,
            operationId: late.operationId,
            rowVersion: 1,
          } satisfies SqliteResultRow,
        ];
      },
    };
    const options = sqliteCollectionOptions(descriptor, {
      executor,
      changeFeed: {
        subscribe: (listener) => {
          queued.push(listener);
          listener({
            workspaceToken: token,
            generationId: generation,
            localCommitVersion: 2,
            touchedEntities: ["category"],
            touchedKeys: ["late"],
          });
          return () => undefined;
        },
      },
    });
    const collection = createCollection(options);
    collection.subscribeChanges(() => undefined);
    await options.utils.loadSubset({
      where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("late")]),
      limit: 10,
    });
    expect(collection.get("late")?.name).toBe("Late");
    expect(reads).toBe(2);
  });

  it("reference-counts overlapping acquisitions and releases them independently", async () => {
    const replica = openNodeReplicaSqlite(identity);
    insertCategory(replica, "shared", "Shared");
    insertCategory(replica, "only-a", "Only A");
    insertCategory(replica, "only-b", "Only B");
    const { collection, options } = startCollection(replica);
    const first = {
      where: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(["shared", "only-a"])]),
      limit: 10,
    };
    const second = {
      where: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(["shared", "only-b"])]),
      limit: 10,
    };
    await options.utils.loadSubset(first);
    await options.utils.loadSubset(second);
    expect(collection.get("shared")?.name).toBe("Shared");
    expect(collection.get("only-a")?.name).toBe("Only A");
    expect(collection.get("only-b")?.name).toBe("Only B");
    options.utils.unloadSubset(first);
    expect(collection.get("shared")?.name).toBe("Shared");
    expect(collection.get("only-a")).toBeUndefined();
    expect(collection.get("only-b")?.name).toBe("Only B");
    options.utils.unloadSubset(second);
    expect(collection.get("shared")).toBeUndefined();
    expect(collection.get("only-b")).toBeUndefined();
    replica.close();
  });

  it("publishes nothing from a disposed workspace", async () => {
    const replica = openNodeReplicaSqlite(identity);
    insertCategory(replica, "keep", "Keep");
    const { collection, options } = startCollection(replica);
    await options.utils.loadSubset({
      where: new IR.Func("eq", [new IR.PropRef(["id"]), new IR.Value("keep")]),
      limit: 10,
    });
    expect(collection.get("keep")?.name).toBe("Keep");
    await collection.cleanup();
    insertCategory(replica, "after", "After");
    expect(collection.get("after")).toBeUndefined();
    replica.close();
  });

  it("fails an unsupported expression instead of scanning", async () => {
    const replica = openNodeReplicaSqlite(identity);
    const { options } = startCollection(replica);
    await expect(
      options.utils.loadSubset({
        where: new IR.Func("like", [new IR.PropRef(["name"]), new IR.Value("%scan%")]),
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(UnsupportedSubsetQuery);
    replica.close();
  });
});
