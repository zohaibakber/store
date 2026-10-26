import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { decodeInvoiceId, decodeProductId } from "@store/contracts/ids";
import { InventoryReads, InventoryStore } from "@store/contracts/replica";
import { ReplicaStore } from "@store/sync";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import { SqlClient } from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";

import { layerInventoryReads } from "../src/reads/handlers";
import { layerNodeReplicaSync } from "../src/replica/node-sync";
import { layerInventoryStore, StaffGate } from "../src/store/handlers";
import { UnreachableTransport } from "./lib/transports";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 5);

const openStore = (replicaId: string) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const session = yield* Layer.build(
      Layer.fresh(
        layerNodeReplicaSync({
          path: ":memory:",
          identity: { organizationId: "org-1", userId: "user-1", replicaId },
          databaseIdentity: `store-commands-${replicaId}`,
          transport: UnreachableTransport,
          live: { apiBaseUrl: "https://api.example.com", accessToken: async () => null },
        }).pipe(Layer.provide(NodeCrypto.layer)),
      ),
    );
    const replica = Context.get(session, SqliteReplica);
    const durable = Context.get(session, ReplicaStore);
    const services = Layer.succeedContext(
      Context.add(session, ReplicaStore, {
        ...durable,
        enqueueCommand: (request) =>
          Effect.andThen(Effect.yieldNow, durable.enqueueCommand(request)),
      }),
    );
    const client = RpcTest.makeClient(InventoryStore, { flatten: true }).pipe(
      Effect.provide(
        Layer.fresh(
          Layer.provide(
            layerInventoryStore,
            Layer.mergeAll(services, StaffGate.layerDisabled, NodeCrypto.layer),
          ),
        ),
      ),
    );
    const store = yield* client;
    const other = yield* client;
    const reads = yield* RpcTest.makeClient(InventoryReads, { flatten: true }).pipe(
      Effect.provide(Layer.provide(layerInventoryReads, Layer.succeed(SqlClient, replica.sql))),
    );
    const rows = (statement: string) =>
      replica.sql.unsafe<Record<string, string | number | null>>(statement);
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
      return sender(
        "IssueInvoice",
        invoiceId === undefined ? { input } : { input, invoiceId: decodeInvoiceId(invoiceId) },
      );
    };
    const allocations = rows(
      `select envelopeJson from command_outbox order by cast(clientSequence as integer)`,
    ).pipe(
      Effect.map((queued) =>
        queued
          .map((row) => JSON.parse(String(row["envelopeJson"])))
          .flatMap((envelope) =>
            envelope.command._tag === "issueInvoice"
              ? [
                  envelope.command.payload.allocations.map(
                    (take: { batchId: string; quantity: number }) => [take.batchId, take.quantity],
                  ),
                ]
              : [],
          ),
      ),
    );
    const visiblePacks = (productId: string) =>
      reads("ProductsById", { ids: [decodeProductId(productId)] }).pipe(
        Effect.map(({ products }) =>
          products.flatMap((product) =>
            [...product.batches]
              .sort((left, right) => (left.expiresAt ?? 0) - (right.expiresAt ?? 0))
              .map((batch) => [batch.id, batch.packQuantity]),
          ),
        ),
      );
    const stocked = Effect.gen(function* () {
      const tablets = (yield* store("CreateCategory", { name: "Tablets" })).result;
      const panadol = (yield* store("CreateProductWithBatch", {
        product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
        batch: { batchNumber: "LATE", expiresAt: NOW + 90 * DAY, packQuantity: 3 },
      })).result;
      const early = (yield* store("CreateBatch", {
        productId: panadol.product.id,
        batchNumber: "EARLY",
        expiresAt: NOW + 30 * DAY,
        packQuantity: 2,
      })).result;
      return { tablets, panadol, early };
    });
    return { store, other, rows, sale, allocations, visiblePacks, stocked };
  });

describe("inventory store commands", () => {
  it.effect(
    "writes a new product and its first batch from one outbox command, stamped with the stored replica identity",
    () =>
      Effect.gen(function* () {
        const { store, rows } = yield* openStore("replica-1");
        const category = (yield* store("CreateCategory", { name: "Tablets" })).result;
        const created = (yield* store("CreateProductWithBatch", {
          product: { name: "Panadol", categoryId: category.id, unitsPerPack: 10 },
          batch: { packQuantity: 2, unitQuantity: 3 },
        })).result;
        const queued = yield* rows(
          `select operationId, envelopeJson from command_outbox order by cast(clientSequence as integer)`,
        );
        expect(queued.map((row) => row["operationId"])).toEqual([
          category.operationId,
          created.product.operationId,
        ]);
        expect(category.deviceId).toBe("replica-1");
        expect(String(queued[0]?.["envelopeJson"])).toContain(`"replicaId":"replica-1"`);
        expect(yield* rows(`select id, name from products`)).toEqual([
          { id: created.product.id, name: "Panadol" },
        ]);
        expect(yield* rows(`select id, productId, packQuantity from batches`)).toEqual([
          { id: created.batch.id, productId: created.product.id, packQuantity: 2 },
        ]);
      }),
  );

  it.effect(
    "allocates earliest expiry first, and a second sale from what a pending first sale left",
    () =>
      Effect.gen(function* () {
        const { store, sale, allocations, visiblePacks, stocked } = yield* openStore("replica-2");
        const { panadol, early } = yield* stocked;
        const first = yield* sale(panadol.product.id, 3);
        const second = yield* sale(panadol.product.id, 2);
        expect([first.result.invoiceNumber, second.result.invoiceNumber]).toEqual([1, 2]);
        expect(yield* allocations).toEqual([
          [
            [early.id, 2],
            [panadol.batch.id, 1],
          ],
          [[panadol.batch.id, 2]],
        ]);
        const { statuses } = yield* store("SyncActivity", undefined);
        expect(statuses).toEqual(["pending"]);
        expect(yield* visiblePacks(panadol.product.id)).toEqual([
          [early.id, 0],
          [panadol.batch.id, 0],
        ]);
      }),
  );

  it.effect("shows an edited batch quantity exactly while an earlier sale is pending", () =>
    Effect.gen(function* () {
      const { store, sale, visiblePacks } = yield* openStore("replica-3");
      const tablets = (yield* store("CreateCategory", { name: "Tablets" })).result;
      const panadol = (yield* store("CreateProductWithBatch", {
        product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
        batch: { batchNumber: "ONLY", expiresAt: NOW + 90 * DAY, packQuantity: 5 },
      })).result;
      const packs = visiblePacks(panadol.product.id).pipe(Effect.map((batches) => batches[0]?.[1]));
      yield* sale(panadol.product.id, 2);
      expect(yield* packs).toBe(3);
      yield* store("UpdateBatch", {
        id: panadol.batch.id,
        batchNumber: "ONLY",
        expiresAt: panadol.batch.expiresAt,
        packQuantity: 10,
      });
      expect(yield* packs).toBe(10);
      yield* sale(panadol.product.id, 10);
      expect(yield* packs).toBe(0);
    }),
  );

  it.effect("records a sale under the invoice id it is given, and only once", () =>
    Effect.gen(function* () {
      const { store, rows, sale, visiblePacks } = yield* openStore("replica-4");
      const tablets = (yield* store("CreateCategory", { name: "Tablets" })).result;
      const panadol = (yield* store("CreateProductWithBatch", {
        product: { name: "Panadol", categoryId: tablets.id, unitsPerPack: 1 },
        batch: { packQuantity: 5 },
      })).result;
      const draftId = "44444444-4444-4444-8444-444444444444";
      expect((yield* sale(panadol.product.id, 2, draftId)).result.invoiceId).toBe(draftId);
      yield* Effect.flip(sale(panadol.product.id, 2, draftId));
      yield* Effect.flip(sale(panadol.product.id, 1, draftId));
      expect(yield* rows(`select id, total from invoices`)).toEqual([{ id: draftId, total: 200 }]);
      expect((yield* visiblePacks(panadol.product.id)).map(([, packs]) => packs)).toEqual([3]);
    }),
  );

  it.effect("admits one command at a time across clients of one session", () =>
    Effect.gen(function* () {
      const { store, other, sale, stocked } = yield* openStore("replica-5");
      const { panadol } = yield* stocked;
      const outcomes = yield* Effect.all(
        [
          sale(panadol.product.id, 3, undefined, store),
          sale(panadol.product.id, 3, undefined, other),
          sale(panadol.product.id, 2, undefined, other),
        ].map((attempt) =>
          attempt.pipe(
            Effect.map((issued) => issued.result.invoiceNumber),
            Effect.catch((failure) => Effect.succeed(failure._tag)),
          ),
        ),
        { concurrency: "unbounded" },
      );
      expect(outcomes).toEqual([1, "CatalogRefusal", 2]);
    }),
  );
});
