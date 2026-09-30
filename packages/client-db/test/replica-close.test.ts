import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { InventorySubsetSpec } from "../src/replica/subset-spec";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

type NodeReplica = Awaited<ReturnType<typeof openNodeReplicaSqlite>>;
type WriteHandle = Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0];

const insertCategory = (n: number) => (handle: WriteHandle) =>
  handle.sql
    .unsafe(
      `insert into categories (id, name, tracksPacks, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values (?, ?, 1, 1, 1, ?, ?, ?, ?, 'seed', 1)`,
      [
        `c-${n}`,
        `Category ${n}`,
        identity.organizationId,
        identity.userId,
        identity.userId,
        identity.replicaId,
      ],
    )
    .pipe(Effect.asVoid);

const categoriesSpec: InventorySubsetSpec = {
  source: "categories",
  orderBy: [{ column: "id", direction: "asc" }],
  limit: 500,
  offset: 0,
};

describe("replica close", () => {
  it("is idempotent, concurrent-safe and stops delivering", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const seen: Array<number> = [];
    replica.subscribe((next) => {
      seen.push(next.localCommitVersion);
    });
    await replica.withWrite(insertCategory(1), ["category"], ["category:c-1"]);
    await vi.waitFor(() => expect(seen).toEqual([1]));
    await Promise.all([replica.close(), replica.close()]);
    await replica.close();
    await expect(replica.stamp()).rejects.toThrow();
    expect(seen).toEqual([1]);
  });

  it("interrupts in-flight reads so nothing outlives the close", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const reads = Array.from({ length: 20 }, () => replica.readSubset(categoriesSpec));
    const settled = Promise.allSettled(reads);
    await replica.close();
    await settled;
    await expect(replica.readSubset(categoriesSpec)).rejects.toThrow();
  });
});
