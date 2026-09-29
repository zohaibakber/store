import { decodeInvoiceSqliteRows } from "@store/client-db";
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import type { SyncCommandEnvelope } from "@store/contracts";
import { decodeProductId } from "@store/contracts/ids";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { InventoryHost } from "../src/host";
import { openInventoryWorkspace } from "../src/open";

const scope = { organizationId: "org-1", userId: "user-1" };

const DAY = 86_400_000;

describe("issueInvoice", () => {
  it("sells a product that no collection subscription has loaded", async () => {
    const replica = await openNodeReplicaSqlite({ ...scope, replicaId: "replica-1" });
    const enqueued: Array<SyncCommandEnvelope> = [];
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: "replica-1",
      openReplica: async () => ({
        ...replica,
        enqueueLocal: (envelope, createdAt) => {
          enqueued.push(envelope);
          return replica.enqueueLocal(envelope, createdAt);
        },
      }),
    };
    const inventory = await openInventoryWorkspace(host, scope);
    const tablets = await inventory.actions.createCategory({ name: "Tablets" });
    const panadol = await inventory.actions.createProductWithBatch({
      product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
      batch: { batchNumber: "LATE", expiresAt: Date.now() + 90 * DAY, packQuantity: 3 },
    });
    const early = await inventory.actions.createBatch({
      productId: panadol.product.id,
      batchNumber: "EARLY",
      expiresAt: Date.now() + 30 * DAY,
      packQuantity: 2,
    });
    const brufen = await inventory.actions.createProductWithBatch({
      product: { name: "Brufen", categoryId: tablets.id, unitsPerPack: 1 },
      batch: { packQuantity: 1 },
    });

    expect(inventory.products.state.size).toBe(0);
    expect(inventory.batches.state.size).toBe(0);
    expect(inventory.invoices.state.size).toBe(0);

    const sale = (productId: string, quantity: number) =>
      inventory.actions.issueInvoice({
        customerName: null,
        items: [
          {
            productId: decodeProductId(productId),
            batchId: null,
            quantity,
            quantityType: "pack",
            salePrice: 100,
          },
        ],
      });
    const first = await sale(panadol.product.id, 4);
    const second = await sale(brufen.product.id, 1);

    expect([first.invoiceNumber, second.invoiceNumber]).toEqual([1, 2]);
    const issued = enqueued.flatMap((envelope) =>
      envelope.command._tag === "issueInvoice" ? [envelope.command.payload] : [],
    );
    expect(issued[0]?.allocations.map((take) => [take.batchId, take.quantity])).toEqual([
      [early.id, 2],
      [panadol.batch.id, 2],
    ]);
    const invoices = await replica.readSubset({
      source: "invoices",
      orderBy: [{ column: "invoiceNumber", direction: "asc" }],
      limit: 10,
      offset: 0,
    });
    const numbers = (await Effect.runPromise(decodeInvoiceSqliteRows(invoices.rows))).map(
      (invoice) => invoice.invoiceNumber,
    );
    expect(numbers).toEqual([1, 2]);

    await inventory.dispose();
  });
});
