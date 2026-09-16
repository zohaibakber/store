import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const identity = {
  organizationId: "org-1",
  userId: "user-1",
  replicaId: "replica-1",
};

describe("openNodeReplicaSqlite", () => {
  it("runs an identity update through query", () => {
    const replica = openNodeReplicaSqlite(identity);
    const updated = replica.query(
      `update replica_state set organizationId = ?, userId = ?, replicaId = ? where id = 'singleton'`,
      ["org-2", "user-2", "device-2"],
    );
    expect(updated).toEqual([]);
    const rows = replica.query(
      `select organizationId, userId, replicaId from replica_state where id = 'singleton'`,
      [],
    );
    expect(rows).toEqual([{ organizationId: "org-2", userId: "user-2", replicaId: "device-2" }]);
    replica.close();
  });
});
