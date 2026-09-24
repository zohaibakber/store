import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lowerSqliteSubset } from "../src/replica/compile";
import { planIndexedDbSubset } from "../src/replica/indexeddb-plan";
import { openNodeReplicaSqlite, type NodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { InventorySubsetSpec } from "../src/replica/subset-spec";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

const managed = `1, 1, 'org-1', 'user-1', 'user-1', 'replica-1', 'seed', 1`;

const products: ReadonlyArray<readonly [string, string, string | null]> = [
  ["p-1", "Panadol", "Paracetamol"],
  ["p-2", "PANADOL Extra", null],
  ["p-3", "Calpol", "Paracetamol"],
  ["p-4", "Brufen", "Ibuprofen"],
  ["p-5", "Adol 50% (syrup)", null],
];

const likeSpec = (column: string, pattern: string): InventorySubsetSpec => ({
  source: "products",
  where: { _tag: "like", column, pattern },
  orderBy: [{ column: "id", direction: "asc" }],
  limit: 20,
  offset: 0,
});

let replica: NodeReplicaSqlite;

beforeEach(async () => {
  replica = await openNodeReplicaSqlite(identity);
  for (const [id, name, composition] of products) {
    await replica.query(
      `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values (?, ?, 'cat-1', null, ?, null, 1, null, null, null, 1, ${managed})`,
      [id, name, composition],
    );
  }
});

afterEach(() => {
  replica.close();
});

const matching = async (column: string, pattern: string) =>
  (await replica.readSubset(likeSpec(column, pattern))).rows.map((row) => row["id"]);

describe("like subset predicates", () => {
  it("match with ASCII case folding and SQL wildcards like the IndexedDB residual", async () => {
    expect(await matching("name", "pan%")).toEqual(["p-1", "p-2"]);
    expect(await matching("name", "%DOL%")).toEqual(["p-1", "p-2", "p-5"]);
    expect(await matching("name", "_alpol")).toEqual(["p-3"]);
    expect(await matching("composition", "%PARA%")).toEqual(["p-1", "p-3"]);
    expect(await matching("name", "%(syrup)")).toEqual(["p-5"]);
    expect(await matching("composition", "%")).toEqual(["p-1", "p-3", "p-4"]);
  });

  it("plans the IndexedDB read as a residual over the product generation", () => {
    const plan = Effect.runSync(planIndexedDbSubset(likeSpec("name", "pan%")));
    expect(plan.scan).toEqual({ _tag: "generationPrefix", reverse: false });
    expect(plan.residual).toEqual({ _tag: "like", column: "name", pattern: "pan%" });
  });

  it("serves a name prefix search from the case-insensitive name index", async () => {
    const statement = Effect.runSync(
      lowerSqliteSubset({
        source: "products",
        where: { _tag: "like", column: "name", pattern: "pan%" },
        orderBy: [{ column: "name", direction: "asc" }],
        limit: 20,
        offset: 0,
      }),
    );
    expect(statement.sql).toBe(
      `SELECT * FROM "products" WHERE "name" LIKE ? ORDER BY "name" COLLATE NOCASE ASC LIMIT ?`,
    );
    const plan = await replica.query(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.parameters);
    const details = plan.map((row) => String(row["detail"])).join("\n");
    expect(details).toContain("SEARCH products USING INDEX products_name_nocase_idx");
    expect(details).not.toContain("TEMP B-TREE");
  });

  it("walks the name index in order for an unfiltered catalog page", async () => {
    const statement = Effect.runSync(
      lowerSqliteSubset({
        source: "products",
        orderBy: [{ column: "name", direction: "asc" }],
        limit: 20,
        offset: 0,
      }),
    );
    const plan = await replica.query(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.parameters);
    const details = plan.map((row) => String(row["detail"])).join("\n");
    expect(details).toContain("products_name_nocase_idx");
    expect(details).not.toContain("TEMP B-TREE");
    const page = await replica.readSubset({
      source: "products",
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 20,
      offset: 0,
    });
    expect(page.rows.map((row) => row["name"])).toEqual([
      "Adol 50% (syrup)",
      "Brufen",
      "Calpol",
      "Panadol",
      "PANADOL Extra",
    ]);
  });

  it("rejects like predicates on columns outside the allowlist", () => {
    expect(() =>
      Effect.runSync(lowerSqliteSubset({ ...likeSpec("aisle", "%a%"), source: "products" })),
    ).toThrow();
  });
});
