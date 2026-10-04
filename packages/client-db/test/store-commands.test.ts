import { decodeInvoiceId, decodeProductId } from "@store/contracts/ids";
import { InventoryReads, InventoryStore } from "@store/contracts/replica";
import { ReplicaStore, SyncTransportService, type SyncTransport } from "@store/sync";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Scope from "effect/Scope";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { layerInventoryReads } from "../src/reads/handlers";
import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { layerInventoryStore } from "../src/store/handlers";

const DAY = 86_400_000;

const unreachable: SyncTransport = {
  registerReplica: () => Effect.never,
  submitCommand: () => Effect.never,
  getReceipt: () => Effect.never,
  pull: () => Effect.never,
  acquireSnapshot: () => Effect.never,
  readSnapshotPart: () => Effect.never,
};

const openStore = async (replicaId: string) => {
  const scope = Effect.runSync(Scope.make());
  const session = await Effect.runPromise(
    Layer.buildWithScope(
      Layer.fresh(
        layerNodeReplicaSync({
          path: ":memory:",
          identity: { organizationId: "org-1", userId: "user-1", replicaId },
          databaseIdentity: `store-commands-${replicaId}`,
          transport: Layer.succeed(SyncTransportService, unreachable),
          live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
        }),
      ),
      scope,
    ),
  );
  const replica = Context.get(session, SqliteReplica);
  const durable = Context.get(session, ReplicaStore);
  const services = Layer.succeedContext(
    Context.add(session, ReplicaStore, {
      ...durable,
      enqueueCommand: (request) =>
        Effect.andThen(Effect.sleep("2 millis"), durable.enqueueCommand(request)),
    }),
  );
  const client = () =>
    Effect.runPromise(
      RpcTest.makeClient(InventoryStore, { flatten: true }).pipe(
        Effect.provide(Layer.fresh(Layer.provide(layerInventoryStore, services))),
        Scope.provide(scope),
      ),
    );
  const store = await client();
  const other = await client();
  const reads = await Effect.runPromise(
    RpcTest.makeClient(InventoryReads, { flatten: true }).pipe(
      Effect.provide(Layer.provide(layerInventoryReads, Layer.succeed(SqlClient, replica.sql))),
      Scope.provide(scope),
    ),
  );
  const rows = (statement: string) =>
    Effect.runPromise(replica.sql.unsafe<Record<string, string | number | null>>(statement));
  const sale = (productId: string, quantity: number, invoiceId?: string, sender = store) => {
    const input = {
      customerName: null,
      items: [
        {
          productId: decodeProductId(productId),
          batchId: null,
          quantity,
          quantityType: "pack" as const,
          salePrice: 100,
        },
      ],
    };
    return Effect.runPromise(
      sender(
        "IssueInvoice",
        invoiceId === undefined ? { input } : { input, invoiceId: decodeInvoiceId(invoiceId) },
      ),
    );
  };
  const allocations = async () =>
    (await rows(`select envelopeJson from command_outbox order by cast(clientSequence as integer)`))
      .map((row) => JSON.parse(String(row["envelopeJson"])))
      .flatMap((envelope) =>
        envelope.command._tag === "issueInvoice"
          ? [
              envelope.command.payload.allocations.map(
                (take: { batchId: string; quantity: number }) => [take.batchId, take.quantity],
              ),
            ]
          : [],
      );
  const visiblePacks = async (productId: string) =>
    (
      await Effect.runPromise(reads("ProductsById", { ids: [decodeProductId(productId)] }))
    ).products.flatMap((product) =>
      [...product.batches]
        .sort((left, right) => (left.expiresAt ?? 0) - (right.expiresAt ?? 0))
        .map((batch) => [batch.id, batch.packQuantity]),
    );
  const stocked = async () => {
    const tablets = (await Effect.runPromise(store("CreateCategory", { name: "Tablets" }))).result;
    const panadol = (
      await Effect.runPromise(
        store("CreateProductWithBatch", {
          product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
          batch: { batchNumber: "LATE", expiresAt: Date.now() + 90 * DAY, packQuantity: 3 },
        }),
      )
    ).result;
    const early = (
      await Effect.runPromise(
        store("CreateBatch", {
          productId: panadol.product.id,
          batchNumber: "EARLY",
          expiresAt: Date.now() + 30 * DAY,
          packQuantity: 2,
        }),
      )
    ).result;
    return { tablets, panadol, early };
  };
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  return { store, other, rows, sale, allocations, visiblePacks, stocked, close };
};

describe("inventory store commands", () => {
  it("writes a new product and its first batch from one outbox command, stamped with the stored replica identity", async () => {
    const { store, rows, close } = await openStore("replica-1");
    const category = (await Effect.runPromise(store("CreateCategory", { name: "Tablets" }))).result;
    const created = (
      await Effect.runPromise(
        store("CreateProductWithBatch", {
          product: { name: "Panadol", categoryId: category.id, unitsPerPack: 10 },
          batch: { packQuantity: 2, unitQuantity: 3 },
        }),
      )
    ).result;
    const queued = await rows(
      `select operationId, envelopeJson from command_outbox order by cast(clientSequence as integer)`,
    );
    expect(queued.map((row) => row["operationId"])).toEqual([
      category.operationId,
      created.product.operationId,
    ]);
    expect(category.deviceId).toBe("replica-1");
    expect(String(queued[0]?.["envelopeJson"])).toContain(`"replicaId":"replica-1"`);
    expect(await rows(`select id, name from products`)).toEqual([
      { id: created.product.id, name: "Panadol" },
    ]);
    expect(await rows(`select id, productId, packQuantity from batches`)).toEqual([
      { id: created.batch.id, productId: created.product.id, packQuantity: 2 },
    ]);
    await close();
  });

  it("allocates earliest expiry first, and a second sale from what a pending first sale left", async () => {
    const { store, sale, allocations, visiblePacks, stocked, close } = await openStore("replica-2");
    const { panadol, early } = await stocked();
    const first = await sale(panadol.product.id, 3);
    const second = await sale(panadol.product.id, 2);
    expect([first.result.invoiceNumber, second.result.invoiceNumber]).toEqual([1, 2]);
    expect(await allocations()).toEqual([
      [
        [early.id, 2],
        [panadol.batch.id, 1],
      ],
      [[panadol.batch.id, 2]],
    ]);
    const { statuses } = await Effect.runPromise(store("SyncActivity", undefined));
    expect(statuses).toEqual(["pending"]);
    expect(await visiblePacks(panadol.product.id)).toEqual([
      [early.id, 0],
      [panadol.batch.id, 0],
    ]);
    await close();
  });

  it("shows an edited batch quantity exactly while an earlier sale is pending", async () => {
    const { store, sale, visiblePacks, close } = await openStore("replica-3");
    const tablets = (await Effect.runPromise(store("CreateCategory", { name: "Tablets" }))).result;
    const panadol = (
      await Effect.runPromise(
        store("CreateProductWithBatch", {
          product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
          batch: { batchNumber: "ONLY", expiresAt: Date.now() + 90 * DAY, packQuantity: 5 },
        }),
      )
    ).result;
    const packs = async () => (await visiblePacks(panadol.product.id))[0]?.[1];
    await sale(panadol.product.id, 2);
    expect(await packs()).toBe(3);
    await Effect.runPromise(
      store("UpdateBatch", {
        id: panadol.batch.id,
        batchNumber: "ONLY",
        expiresAt: panadol.batch.expiresAt,
        packQuantity: 10,
      }),
    );
    expect(await packs()).toBe(10);
    await sale(panadol.product.id, 10);
    expect(await packs()).toBe(0);
    await close();
  });

  it("records a sale under the invoice id it is given, and only once", async () => {
    const { store, rows, sale, visiblePacks, close } = await openStore("replica-4");
    const tablets = (await Effect.runPromise(store("CreateCategory", { name: "Tablets" }))).result;
    const panadol = (
      await Effect.runPromise(
        store("CreateProductWithBatch", {
          product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
          batch: { packQuantity: 5 },
        }),
      )
    ).result;
    const draftId = "44444444-4444-4444-8444-444444444444";
    expect((await sale(panadol.product.id, 2, draftId)).result.invoiceId).toBe(draftId);
    await expect(sale(panadol.product.id, 2, draftId)).rejects.toThrow();
    await expect(sale(panadol.product.id, 1, draftId)).rejects.toThrow();
    expect(await rows(`select id, total from invoices`)).toEqual([{ id: draftId, total: 200 }]);
    expect((await visiblePacks(panadol.product.id)).map(([, packs]) => packs)).toEqual([3]);
    await close();
  });

  it("admits one command at a time across clients of one session", async () => {
    const { store, other, sale, stocked, close } = await openStore("replica-5");
    const { panadol } = await stocked();
    const outcomes = await Promise.allSettled([
      sale(panadol.product.id, 3, undefined, store),
      sale(panadol.product.id, 3, undefined, other),
      sale(panadol.product.id, 2, undefined, other),
    ]);
    expect(
      outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? outcome.value.result.invoiceNumber : outcome.reason._tag,
      ),
    ).toEqual([1, "CatalogRefusal", 2]);
    await close();
  });
});
