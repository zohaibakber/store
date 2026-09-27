import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OFFSET_MINUTES = 300;
const dayStart = 20_000 * DAY - OFFSET_MINUTES * 60_000;
const managed = (createdAt: number, operationId = "seed") =>
  `${createdAt}, ${createdAt}, 'org-1', 'user-1', 'user-1', 'device-1', '${operationId}', 1`;
const metadataColumns =
  "createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion";

const seed = [
  `insert into categories (id, name, tracksPacks, ${metadataColumns}) values ('cat-1', 'Tablets', 1, ${managed(1)})`,
  ...[
    ["p-1", 10],
    ["p-2", 1],
  ].map(
    ([id, unitsPerPack]) =>
      `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, ${metadataColumns}) values ('${id}', 'Product ${id}', 'cat-1', null, null, null, ${unitsPerPack}, 500, 900, null, 1, ${managed(1)})`,
  ),
  `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, ${metadataColumns}) values ('p-3', 'Orphan', 'missing', null, null, null, 1, null, null, null, 0, ${managed(1)})`,
  ...[
    ["b-1", "p-1", 2, 3],
    ["b-2", "p-2", 0, 0],
  ].map(
    ([id, productId, packs, units]) =>
      `insert into batches (id, productId, batchNumber, expiresAt, packQuantity, unitQuantity, ${metadataColumns}) values ('${id}', '${productId}', '${id}', ${dayStart + 40 * DAY}, ${packs}, ${units}, ${managed(1)})`,
  ),
  ...[
    ["i-1", 1, dayStart + 9 * HOUR, 700],
    ["i-2", 2, dayStart + 23 * HOUR, 300],
    ["i-3", 3, dayStart - 3 * DAY, 999],
  ].map(
    ([id, number, createdAt, total]) =>
      `insert into invoices (id, invoiceNumber, customerName, total, ${metadataColumns}) values ('${id}', ${number}, null, ${total}, ${managed(Number(createdAt), `op-${id}`)})`,
  ),
  ...[
    ["l-1", "i-1", "p-1", 3, 100],
    ["l-2", "i-1", "p-2", 2, 200],
    ["l-3", "i-2", "p-1", 3, 100],
    ["l-4", "i-3", "p-1", 9, 111],
  ].map(
    ([id, invoiceId, productId, units, price]) =>
      `insert into invoice_items (id, invoiceId, productId, batchId, productName, batchNumber, quantity, quantityType, baseUnitQuantity, salePrice, ${metadataColumns}) values ('${id}', '${invoiceId}', '${productId}', 'b-1', 'Product', 'b-1', ${units}, 'unit', ${units}, ${price}, ${managed(1)})`,
  ),
];

describe("SQLite insights read", () => {
  it("aggregates windowed sales by local day and hour inside the replica", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    for (const statement of seed) await replica.query(statement, []);

    const read = await replica.readInsights({
      since: dayStart - DAY,
      until: dayStart + 2 * DAY,
      utcOffsetMinutes: OFFSET_MINUTES,
    });

    expect(read.stamp.workspaceToken).toBe(replica.workspaceToken);
    expect(read.facts.truncated).toBe(false);
    expect(
      read.facts.products.map((row) => [row.id, row.categoryName, row.tracksPacks, row.visible]),
    ).toEqual([
      ["p-1", "Tablets", true, true],
      ["p-2", "Tablets", true, true],
      ["p-3", null, true, false],
    ]);
    expect(read.facts.batches.map((row) => row.productId)).toEqual(["p-1"]);
    expect(read.facts.days).toEqual([{ day: 20_000, invoices: 2, revenue: 1000 }]);
    expect(read.facts.hours).toEqual([
      { hour: 9, invoices: 1, revenue: 700 },
      { hour: 23, invoices: 1, revenue: 300 },
    ]);
    expect(
      [...read.facts.sales].sort((left, right) => left.productId.localeCompare(right.productId)),
    ).toEqual([
      { productId: "p-1", day: 20_000, units: 6, revenue: 600 },
      { productId: "p-2", day: 20_000, units: 2, revenue: 400 },
    ]);
    replica.close();
  });
});
