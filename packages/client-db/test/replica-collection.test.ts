import { decodeCategoryId } from "@store/contracts/ids";
import { createCollection, createLiveQueryCollection, IR } from "@tanstack/db";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import { decodeCategorySqliteRows, decodeProductSqliteRows } from "../src/replica/decode";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import { DEFAULT_COLLECTION_MAXIMUM_ROWS } from "../src/replica/sources";
import type {
  InventoryCollectionDescriptor,
  ReplicaCommitNotice,
  ReplicaSubsetReader,
  SqliteResultRow,
} from "../src/replica/types";
import type { CategoryRow, ProductRow } from "../src/rows";

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

type NodeReplica = Awaited<ReturnType<typeof openNodeReplicaSqlite>>;

const insertCategory = (replica: NodeReplica, id: string, name: string) =>
  replica.withWrite(
    (handle) =>
      Effect.asVoid(
        handle.sql.unsafe(
          `insert into categories (
            id, name, tracksPacks, createdAt, updatedAt,
            organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
          ) values (?, ?, 1, 1, 1, ?, ?, ?, ?, 'seed', 1)`,
          [id, name, identity.organizationId, identity.userId, identity.userId, identity.replicaId],
        ),
      ),
    ["category"],
    [id],
  );

const insertProduct = (replica: NodeReplica, id: string, name: string, aisle: string | null) =>
  replica.withWrite(
    (handle) =>
      Effect.asVoid(
        handle.sql.unsafe(
          `insert into products (
            id, name, aisle, createdAt, updatedAt,
            organizationId, createdByUserId, updatedByUserId, deviceId, operationId
          ) values (?, ?, ?, 1, 1, ?, ?, ?, ?, 'seed')`,
          [
            id,
            name,
            aisle,
            identity.organizationId,
            identity.userId,
            identity.userId,
            identity.replicaId,
          ],
        ),
      ),
    ["product"],
    [id],
  );

const byIds = (ids: ReadonlyArray<string>) =>
  new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(ids)]);

const startCollection = (replica: NodeReplica) =>
  createCollection(sqliteCollectionOptions(descriptor, { executor: replica, changeFeed: replica }));

describe("sqliteCollectionOptions", () => {
  it("publishes a change committed between listener registration and the baseline read", async () => {
    const token = "workspace-a";
    const generation = "1";
    const late = categoryRow("late", "Late");
    let reads = 0;
    const executor: ReplicaSubsetReader = {
      readSubset: async () => {
        reads += 1;
        const stamp = { workspaceToken: token, generationId: generation };
        if (reads === 1) return { stamp: { ...stamp, localCommitVersion: 1 }, rows: [] };
        return {
          stamp: { ...stamp, localCommitVersion: 2 },
          rows: [
            {
              id: late.id,
              name: late.name,
              tracksPacks: 1,
              createdAt: 1,
              updatedAt: 1,
              organizationId: late.organizationId,
              createdByUserId: late.createdByUserId,
              updatedByUserId: late.updatedByUserId,
              deviceId: late.deviceId,
              operationId: late.operationId,
              rowVersion: 1,
            } satisfies SqliteResultRow,
          ],
        };
      },
    };
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, {
        executor,
        changeFeed: {
          subscribe: (listener: (notice: ReplicaCommitNotice) => void) => {
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
      }),
    );
    collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: byIds(["late"]),
    });
    await vi.waitFor(() => expect(collection.get("late")?.name).toBe("Late"));
    expect(reads).toBe(2);
  });

  it("reference-counts overlapping subscriptions and releases them independently", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    await insertCategory(replica, "shared", "Shared");
    await insertCategory(replica, "only-a", "Only A");
    await insertCategory(replica, "only-b", "Only B");
    const collection = startCollection(replica);
    const first = collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: byIds(["shared", "only-a"]),
    });
    const second = collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: byIds(["shared", "only-b"]),
    });
    await vi.waitFor(() => {
      expect(collection.get("only-a")?.name).toBe("Only A");
      expect(collection.get("only-b")?.name).toBe("Only B");
    });
    first.unsubscribe();
    await vi.waitFor(() => expect(collection.get("only-a")).toBeUndefined());
    expect(collection.get("shared")?.name).toBe("Shared");
    expect(collection.get("only-b")?.name).toBe("Only B");
    second.unsubscribe();
    await vi.waitFor(() => expect(collection.get("shared")).toBeUndefined());
    expect(collection.get("only-b")).toBeUndefined();
    await replica.close();
  });

  it("publishes nothing from a disposed workspace", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    await insertCategory(replica, "keep", "Keep");
    const collection = startCollection(replica);
    collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: byIds(["keep"]),
    });
    await vi.waitFor(() => expect(collection.get("keep")?.name).toBe("Keep"));
    await collection.cleanup();
    await insertCategory(replica, "after", "After");
    expect(collection.get("after")).toBeUndefined();
    await replica.close();
  });

  it("loads the same window SQLite orders, including case and nulls", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    await insertProduct(replica, "p-lower", "apple", "a");
    await insertProduct(replica, "p-upper", "Banana", "B");
    await insertProduct(replica, "p-null", "cherry", null);
    await insertProduct(replica, "p-last", "Date", "c");
    const products = createCollection(
      sqliteCollectionOptions<ProductRow>(
        {
          id: "test:products",
          source: "products",
          syncMode: "on-demand",
          maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
          getKey: (row) => row.id,
          decodeRows: decodeProductSqliteRows,
        },
        { executor: replica, changeFeed: replica },
      ),
    );
    const byName = createLiveQueryCollection((query) =>
      query
        .from({ product: products })
        .orderBy(({ product }) => product.name, "asc")
        .limit(2)
        .select(({ product }) => ({ id: product.id })),
    );
    const byAisle = createLiveQueryCollection((query) =>
      query
        .from({ product: products })
        .orderBy(({ product }) => product.aisle, { direction: "desc", nulls: "first" })
        .limit(2)
        .select(({ product }) => ({ id: product.id })),
    );
    await Promise.all([byName.preload(), byAisle.preload()]);
    expect(byName.toArray.map((row) => row.id)).toEqual(["p-upper", "p-last"]);
    expect(byAisle.toArray.map((row) => row.id)).toEqual(["p-null", "p-last"]);
    await replica.close();
  });
});
