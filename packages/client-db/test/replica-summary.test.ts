import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };
const metadata = "1, 1, 'org-1', 'user-1', 'user-1', 'device-1', 'seed', 1";
const columns =
  "id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion";

const product = (id: string, category: string, aisle: string | null) =>
  `insert into products (${columns}) values ('${id}', 'Product ${id}', '${category}', ${
    aisle === null ? "null" : `'${aisle}'`
  }, null, null, 1, null, null, null, 1, ${metadata})`;

describe("SQLite subset summary", () => {
  it("counts filtered rows and lists trimmed, case-folded distinct values", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    for (const statement of [
      product("p-1", "c-1", "Shelf A"),
      product("p-2", "c-1", " shelf a "),
      product("p-3", "c-2", "Shelf B"),
      product("p-4", "c-2", null),
      product("p-5", "c-2", "  "),
    ]) {
      await replica.query(statement, []);
    }

    const all = await replica.summarizeSubset({ source: "products", distinct: ["aisle"] });
    expect(all.summary).toEqual({
      count: 5,
      distinct: [{ column: "aisle", values: ["Shelf A", "Shelf B"] }],
    });

    const filtered = await replica.summarizeSubset({
      source: "products",
      where: { _tag: "compare", column: "categoryId", op: "eq", value: "c-2" },
      distinct: [],
    });
    expect(filtered.summary.count).toBe(3);
    replica.close();
  });

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
    replica.close();
  });
});
