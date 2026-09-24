import { describe, expect, it } from "vitest";

import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";

const identity = {
  organizationId: "org-1",
  userId: "user-1",
  replicaId: "replica-1",
};

describe("openNodeReplicaSqlite", () => {
  it("runs an identity update through query", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const updated = await replica.query(
      `update replica_state set organizationId = ?, userId = ?, replicaId = ? where id = 'singleton'`,
      ["org-2", "user-2", "device-2"],
    );
    expect(updated).toEqual([]);
    const rows = await replica.query(
      `select organizationId, userId, replicaId from replica_state where id = 'singleton'`,
      [],
    );
    expect(rows).toEqual([{ organizationId: "org-2", userId: "user-2", replicaId: "device-2" }]);
    replica.close();
  });

  it("deletes a product that local invoice items still reference", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const run = async (sql: string) => expect(await replica.query(sql, [])).toEqual([]);
    const managed = `'org-1', 'user-1', 'user-1', 'device-1', 'seed', 1`;
    await run(
      `insert into categories (id, name, tracksPacks, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('category-1', 'General', 1, 1, 1, ${managed})`,
    );
    await run(
      `insert into products (id, name, categoryId, aisle, composition, strength, unitsPerPack, purchasePrice, retailPrice, unitPrice, visible, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('product-1', 'Green', 'category-1', null, null, null, 1, null, null, null, 1, 1, 1, ${managed})`,
    );
    await run(
      `insert into batches (id, productId, batchNumber, expiresAt, packQuantity, unitQuantity, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('batch-1', 'product-1', 'B-1', null, 0, 0, 1, 1, ${managed})`,
    );
    await run(
      `insert into invoices (id, invoiceNumber, customerName, total, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('invoice-1', 1, null, 100, 1, 1, ${managed})`,
    );
    await run(
      `insert into invoice_items (id, invoiceId, productId, batchId, productName, batchNumber, quantity, quantityType, baseUnitQuantity, salePrice, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('item-1', 'invoice-1', 'product-1', 'batch-1', 'Green', 'B-1', 1, 'unit', 1, 100, 1, 1, ${managed})`,
    );

    await run(`delete from batches where id = 'batch-1'`);
    await run(`delete from products where id = 'product-1'`);

    expect(await replica.query(`select id from products`, [])).toEqual([]);
    expect(await replica.query(`select productName, batchNumber from invoice_items`, [])).toEqual([
      { productName: "Green", batchNumber: "B-1" },
    ]);
    replica.close();
  });
});
