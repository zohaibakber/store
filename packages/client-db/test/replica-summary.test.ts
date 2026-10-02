import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };
describe("SQLite subset summary", () => {
  it("rejects columns outside the allowlists", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    await expect(
      replica.summarizeSubset({ source: "products", distinct: ["retailPrice"] }),
    ).rejects.toThrow();
    await expect(
      replica.summarizeSubset({
        source: "products",
        where: { _tag: "compare", column: "retailPrice", op: "eq", value: 1 },
        distinct: [],
      }),
    ).rejects.toThrow();
    await replica.close();
  });
});
