import { describe, expect, it } from "vitest";

import { openElectronBrowserWorkerReplicaSqlite } from "../src/replica/browser-sqlite";

describe("openElectronBrowserWorkerReplicaSqlite", () => {
  it("applies the committed replica migrations", async () => {
    const replica = await openElectronBrowserWorkerReplicaSqlite(
      `inventory-replica-${crypto.randomUUID().slice(0, 8)}.sqlite`,
    );
    const keys = await replica.query(`select key from __store_sync_migrations order by key`, []);
    expect(keys).toEqual([{ key: "20260916001056_create_replica_state" }]);
    const tables = await replica.query(
      `select name from sqlite_master where type = 'table' and name = 'replica_state'`,
      [],
    );
    expect(tables).toEqual([{ name: "replica_state" }]);
    const stamp = await replica.stamp();
    expect(stamp.generationId).toBe("1");
    expect(stamp.localCommitVersion).toBe(0);
    replica.close();
  });

  it("reads a row written through the same replica handle", async () => {
    const replica = await openElectronBrowserWorkerReplicaSqlite(
      `inventory-replica-${crypto.randomUUID().slice(0, 8)}.sqlite`,
    );
    await replica.query(
      `insert into categories (
        id, name, tracksPacks, createdAt, updatedAt, deletedAt,
        organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
      ) values ('cat-1', 'Tea', 1, 1, 1, null, 'org-1', 'user-1', 'user-1', 'replica-1', 'seed', 1)`,
      [],
    );
    const rows = await replica.query(`select id, name from categories where id = ?`, ["cat-1"]);
    expect(rows).toEqual([{ id: "cat-1", name: "Tea" }]);
    await replica.query(
      `update replica_state set organizationId = ?, userId = ?, replicaId = ? where id = 'singleton'`,
      ["org-2", "user-2", "device-2"],
    );
    const identity = await replica.query(
      `select organizationId, userId, replicaId from replica_state where id = 'singleton'`,
      [],
    );
    expect(identity).toEqual([
      { organizationId: "org-2", userId: "user-2", replicaId: "device-2" },
    ]);
    replica.close();
  });
});
