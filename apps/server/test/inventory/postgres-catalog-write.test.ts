import * as PgClient from "@effect/sql-pg/PgClient";
import {
  ACTIVE_REPLICA_WINDOW_MILLIS,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_ENTITIES_V3,
  partitionDigestOf,
  ReplicaClientSequence,
  staleReplicaRejection,
  STOCK_MOVEMENT_ROW_VERSION,
  type CatalogRowWrite,
  type CatalogWriteCommand,
  type PartitionLeafSource,
  type PurchaseOrderStatus,
  type RequestedPartitionDigestVersion,
  type SyncCommandEnvelope,
  type SyncPullRequest,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeOrganizationId,
  decodeProductId,
  decodePurchaseOrderId,
  decodePurchaseOrderItemId,
  decodeSupplierId,
} from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  replicas,
  stockMovements,
  suppliers,
} from "@store/db/postgres/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { makeInventoryLive } from "../../src/inventory/live-horizon";
import type { InventoryActor } from "../../src/inventory/model";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { typedCommands } from "./typed-commands";

const OCCURRED_AT = 1_700_000_000_000;
const PRODUCT_ID = decodeProductId("prod-1");
const SUPPLIER_ID = decodeSupplierId("sup-1");
const ORDER_ID = decodePurchaseOrderId("po-1");

let database: AuthorityPostgres;

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-inventory-catalog-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer()), Effect.scoped));

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const pullFrom = (
  afterCommitSequence: string,
  withDigest: boolean | RequestedPartitionDigestVersion = false,
): SyncPullRequest => {
  const request: SyncPullRequest = {
    epoch: LAST_UNIT_EPOCH,
    subscription: OPERATIONAL_SUBSCRIPTION,
    afterCommitSequence: OrgCommitSequence.make(afterCommitSequence),
  };
  if (withDigest === false) return request;
  return { ...request, digestVersion: withDigest === true ? PARTITION_DIGEST_VERSION : withDigest };
};

const LegacyDigestPage = Schema.fromJsonString(
  Schema.Struct({
    digest: Schema.Struct({
      version: Schema.Literal(PARTITION_DIGEST_VERSION_V3),
      digest: Schema.String,
      count: Schema.Number,
      entities: Schema.Record(Schema.String, Schema.String),
    }),
  }),
);
const decodeLegacyDigestPage = Schema.decodeUnknownEffect(LegacyDigestPage);
const decodePullBodies = Schema.decodeUnknownEffect(
  Schema.Tuple([Schema.Struct({ body: Schema.String })]),
);

const catalogCommand = (
  commandId: string,
  writes: ReadonlyArray<CatalogRowWrite>,
): CatalogWriteCommand => ({
  commandId,
  deviceId: LAST_UNIT_REPLICA_A,
  occurredAt: OCCURRED_AT,
  writes,
});

const catalogEnvelope = (
  organizationId: ReturnType<typeof decodeOrganizationId>,
  clientSequence: string,
  payload: CatalogWriteCommand,
): SyncCommandEnvelope => {
  const command = { _tag: "catalogWrite" as const, payload };
  return {
    organizationId,
    epoch: LAST_UNIT_EPOCH,
    replicaId: LAST_UNIT_REPLICA_A,
    clientSequence: ReplicaClientSequence.make(clientSequence),
    operationId: payload.commandId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
};

const categoryInsert = (id: string, name: string): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(id),
  expectedRowVersion: null,
  row: { name, tracksPacks: true },
});

const productRow = (categoryId: string, name: string, unitsPerPack: number) => ({
  name,
  categoryId: decodeCategoryId(categoryId),
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack,
  purchasePrice: 100,
  retailPrice: 200,
  unitPrice: 25,
  visible: true,
});

const productInsert = (id: string, categoryId: string, name: string): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(id),
  expectedRowVersion: null,
  row: productRow(categoryId, name, 10),
});

const batchWrite = (
  id: string,
  expectedRowVersion: number | null,
  movementId: string,
  packQuantity: number,
  unitQuantity: number,
  note: string | null = null,
): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(id),
  expectedRowVersion,
  movementId,
  note,
  row: {
    productId: PRODUCT_ID,
    batchNumber: "B-1",
    expiresAt: null,
    packQuantity,
    unitQuantity,
  },
});

const supplierWrite = (
  id: string,
  expectedRowVersion: number | null,
  name: string,
  phone: string | null = null,
): CatalogRowWrite => ({
  entity: "supplier",
  action: "upsert",
  id: decodeSupplierId(id),
  expectedRowVersion,
  row: { name, phone, note: null },
});

const orderWrite = (
  id: string,
  expectedRowVersion: number | null,
  row: {
    readonly status?: PurchaseOrderStatus;
    readonly orderNumber?: number;
    readonly supplierId?: string;
  } = {},
): CatalogRowWrite => ({
  entity: "purchaseOrder",
  action: "upsert",
  id: decodePurchaseOrderId(id),
  expectedRowVersion,
  row: {
    orderNumber: row.orderNumber ?? 1,
    supplierId: decodeSupplierId(row.supplierId ?? SUPPLIER_ID),
    status: row.status ?? "draft",
    note: null,
    sentAt: null,
    expectedAt: null,
    total: 0,
  },
});

const lineWrite = (
  id: string,
  expectedRowVersion: number | null,
  row: {
    readonly purchaseOrderId?: string;
    readonly productId?: string;
    readonly quantity?: number;
    readonly quantityType?: "unit" | "pack";
    readonly baseUnitQuantity?: number;
  } = {},
): CatalogRowWrite => ({
  entity: "purchaseOrderItem",
  action: "upsert",
  id: decodePurchaseOrderItemId(id),
  expectedRowVersion,
  row: {
    purchaseOrderId: decodePurchaseOrderId(row.purchaseOrderId ?? ORDER_ID),
    productId: decodeProductId(row.productId ?? PRODUCT_ID),
    productName: "Panadol",
    quantity: row.quantity ?? 2,
    quantityType: row.quantityType ?? "pack",
    baseUnitQuantity: row.baseUnitQuantity ?? 20,
    packCost: 100,
  },
});

const receivedBatch = (
  id: string,
  lineId: string,
  packQuantity: number,
  unitQuantity: number,
  options: { readonly expectedRowVersion?: number; readonly productId?: string } = {},
): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(id),
  expectedRowVersion: options.expectedRowVersion ?? null,
  movementId: `mv-${id}-${options.expectedRowVersion ?? 0}`,
  note: null,
  row: {
    productId: decodeProductId(options.productId ?? PRODUCT_ID),
    batchNumber: id,
    expiresAt: null,
    packQuantity,
    unitQuantity,
  },
  receipt: { purchaseOrderItemId: decodePurchaseOrderItemId(lineId) },
});

const openCatalog = (organizationId: string, commitSequence = "0") =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
    yield* db.insert(inventoryState).values({
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence,
      retentionFloor: "0",
    });
    yield* db.insert(replicas).values({
      organizationId,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: "user-1",
      deviceLabel: LAST_UNIT_REPLICA_A,
      lastClientSequence: "0",
      processedThroughClientSequence: "0",
      registeredAt: OCCURRED_AT,
      lastSeenAt: OCCURRED_AT,
    });
    const commands = typedCommands(makeInventoryCommands(db));
    let clientSequence = 0;
    const write = (commandId: string, writes: ReadonlyArray<CatalogRowWrite>) =>
      Effect.suspend(() => {
        clientSequence += 1;
        return commands.commit(
          actorFor(organizationId),
          catalogEnvelope(
            decodeOrganizationId(organizationId),
            String(clientSequence),
            catalogCommand(commandId, writes),
          ),
        );
      }).pipe(Effect.map((receipt) => receipt.result));
    return { commands, db, write };
  });

type CatalogDb = Effect.Success<ReturnType<typeof openCatalog>>["db"];

const rejection = (rule: { readonly code: string; readonly message: string }) => ({
  _tag: "rejected",
  ...rule,
});

const ACCEPTED = { _tag: "catalogWrite" };

const seedCatalog = () =>
  catalogCommand("cmd-seed", [
    categoryInsert("cat-1", "Painkillers"),
    productInsert("prod-1", "cat-1", "Panadol"),
    batchWrite("batch-1", null, "mv-seed", 2, 0),
  ]);

const activePartitionRows = (db: CatalogDb, organizationId: string) =>
  Effect.gen(function* () {
    const rows: Array<PartitionLeafSource> = [];
    const categoryRows = yield* db
      .select()
      .from(categories)
      .where(eq(categories.organizationId, organizationId))
      .orderBy(asc(categories.id));
    for (const row of categoryRows) {
      rows.push({ entity: "category", entityId: row.id, rowVersion: row.rowVersion });
    }
    const productRows = yield* db
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), isNull(products.deletedAt)))
      .orderBy(asc(products.id));
    for (const row of productRows) {
      rows.push({ entity: "product", entityId: row.id, rowVersion: row.rowVersion });
    }
    const batchRows = yield* db
      .select()
      .from(batches)
      .where(and(eq(batches.organizationId, organizationId), isNull(batches.deletedAt)))
      .orderBy(asc(batches.id));
    for (const row of batchRows) {
      rows.push({ entity: "batch", entityId: row.id, rowVersion: row.rowVersion });
    }
    const invoiceRows = yield* db
      .select({ id: invoices.id, rowVersion: invoices.rowVersion })
      .from(invoices)
      .where(eq(invoices.organizationId, organizationId));
    for (const row of invoiceRows) {
      rows.push({ entity: "invoice", entityId: row.id, rowVersion: row.rowVersion });
    }
    const itemRows = yield* db
      .select({ id: invoiceItems.id, rowVersion: invoiceItems.rowVersion })
      .from(invoiceItems)
      .where(eq(invoiceItems.organizationId, organizationId));
    for (const row of itemRows) {
      rows.push({ entity: "invoiceItem", entityId: row.id, rowVersion: row.rowVersion });
    }
    const movementRows = yield* db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, organizationId));
    for (const row of movementRows) {
      rows.push({
        entity: "stockMovement",
        entityId: row.id,
        rowVersion: STOCK_MOVEMENT_ROW_VERSION,
      });
    }
    const supplierRows = yield* db
      .select({ id: suppliers.id, rowVersion: suppliers.rowVersion })
      .from(suppliers)
      .where(eq(suppliers.organizationId, organizationId));
    for (const row of supplierRows) {
      rows.push({ entity: "supplier", entityId: row.id, rowVersion: row.rowVersion });
    }
    const orderRows = yield* db
      .select({ id: purchaseOrders.id, rowVersion: purchaseOrders.rowVersion })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, organizationId));
    for (const row of orderRows) {
      rows.push({ entity: "purchaseOrder", entityId: row.id, rowVersion: row.rowVersion });
    }
    const lineRows = yield* db
      .select({ id: purchaseOrderItems.id, rowVersion: purchaseOrderItems.rowVersion })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.organizationId, organizationId));
    for (const row of lineRows) {
      rows.push({ entity: "purchaseOrderItem", entityId: row.id, rowVersion: row.rowVersion });
    }
    return rows;
  });

describe("postgres catalog writes", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("holds supplier and order rows back while another device on the old schema was seen within 14 days", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-gate");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db, write } = yield* openCatalog(organizationId);
        const now = Date.now();
        const peer = and(
          eq(replicas.organizationId, organizationId),
          eq(replicas.replicaId, LAST_UNIT_REPLICA_B),
        );
        yield* db.insert(replicas).values({
          organizationId,
          replicaId: LAST_UNIT_REPLICA_B,
          ownerUserId: "user-1",
          deviceLabel: "Till 2",
          lastClientSequence: "0",
          processedThroughClientSequence: "0",
          registeredAt: OCCURRED_AT,
          lastSeenAt: now,
        });
        const catalog = yield* write("cmd-catalog", [
          categoryInsert("cat-1", "Painkillers"),
          productInsert("prod-1", "cat-1", "Panadol"),
        ]);
        const supplier = yield* write("cmd-supplier", [supplierWrite("sup-1", null, "Acme")]);
        const receipt = yield* write("cmd-receipt", [receivedBatch("batch-r1", "line-1", 1, 0)]);
        const registeredBlocked = yield* commands.register(actor, {
          replicaId: LAST_UNIT_REPLICA_A,
          schemaVersion: 2,
        });
        yield* db.update(replicas).set({ deviceLabel: null }).where(peer);
        const unnamed = yield* write("cmd-unnamed", [supplierWrite("sup-1", null, "Acme")]);
        yield* db
          .update(replicas)
          .set({ lastSeenAt: now - 2 * 24 * 60 * 60_000 })
          .where(peer);
        const abandoned = yield* write("cmd-abandoned", [supplierWrite("sup-1", null, "Acme")]);
        const registeredAbandoned = yield* commands.register(actor, {
          replicaId: LAST_UNIT_REPLICA_A,
          schemaVersion: 2,
        });
        const live = yield* makeInventoryLive(db);
        yield* live.readLiveHorizon(actor, LAST_UNIT_REPLICA_B);
        const reconnected = yield* write("cmd-reconnected", [
          supplierWrite("sup-3", null, "Initech"),
        ]);
        yield* db
          .update(replicas)
          .set({ lastSeenAt: now - ACTIVE_REPLICA_WINDOW_MILLIS - 60_000 })
          .where(peer);
        const dormant = yield* write("cmd-dormant", [supplierWrite("sup-3", null, "Initech")]);
        const registeredClear = yield* commands.register(actor, {
          replicaId: LAST_UNIT_REPLICA_A,
          schemaVersion: 2,
        });
        yield* db.update(replicas).set({ lastSeenAt: now, schemaVersion: 2 }).where(peer);
        const upgraded = yield* write("cmd-upgraded", [supplierWrite("sup-2", null, "Globex")]);
        return {
          catalog,
          supplier,
          receipt,
          registeredBlocked,
          unnamed,
          abandoned,
          registeredAbandoned,
          reconnected,
          dormant,
          registeredClear,
          upgraded,
        };
      }),
    );
    expect(outcome.catalog).toMatchObject(ACCEPTED);
    expect(outcome.supplier).toEqual(rejection(staleReplicaRejection("Till 2")));
    expect(outcome.receipt).toEqual(rejection(staleReplicaRejection("Till 2")));
    expect(outcome.registeredBlocked.lowestActiveSchemaVersion).toBe(1);
    expect(outcome.unnamed).toEqual(rejection(staleReplicaRejection(null)));
    expect(outcome.abandoned).toMatchObject(ACCEPTED);
    expect(outcome.registeredAbandoned.lowestActiveSchemaVersion).toBe(2);
    expect(outcome.reconnected).toEqual(rejection(staleReplicaRejection(null)));
    expect(outcome.dormant).toMatchObject(ACCEPTED);
    expect(outcome.registeredClear.lowestActiveSchemaVersion).toBe(2);
    expect(outcome.upgraded).toMatchObject(ACCEPTED);
  });

  it("answers a version 3 digest over six entities unchanged by purchasing rows, and version 4 over nine", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-digest");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db, write } = yield* openCatalog(organizationId);
        const legacyDigest = (afterCommitSequence: string) =>
          commands
            .pullEncoded(actor, pullFrom(afterCommitSequence, PARTITION_DIGEST_VERSION_V3))
            .pipe(Effect.flatMap((page) => decodeLegacyDigestPage(page.json)));
        yield* write("cmd-seed", seedCatalog().writes);
        const legacyBefore = yield* legacyDigest("1");
        const currentBefore = yield* commands.pull(actor, pullFrom("1", true));
        yield* write("cmd-purchasing", [
          supplierWrite("sup-1", null, "Acme"),
          orderWrite("po-1", null),
          lineWrite("line-1", null),
        ]);
        const legacyAfter = yield* legacyDigest("2");
        const requested = yield* commands.pullEncoded(
          actor,
          pullFrom("2", PARTITION_DIGEST_VERSION_V3),
        );
        const [deployed] = yield* db
          .execute(
            sql`select "body" from sync.pull(
              ${organizationId}::text,
              ${LAST_UNIT_EPOCH}::text,
              ${OPERATIONAL_SUBSCRIPTION}::text,
              ${"2"}::text,
              ${MAX_SYNC_PULL_TRANSACTIONS}::integer,
              ${MAX_TRANSPORT_PAYLOAD_BYTES}::integer,
              ${true}::boolean
            )`,
            "objects",
          )
          .pipe(Effect.flatMap(decodePullBodies));
        const currentAfter = yield* commands.pull(actor, pullFrom("2", true));
        const expected = yield* partitionDigestOf(yield* activePartitionRows(db, organizationId));
        return {
          legacyBefore,
          currentBefore,
          legacyAfter,
          requested,
          deployed,
          currentAfter,
          expected,
        };
      }),
    );
    expect(outcome.legacyAfter).toEqual(outcome.legacyBefore);
    expect(outcome.requested.json).toBe(outcome.deployed.body);
    expect(new Set(Object.keys(outcome.legacyAfter.digest.entities))).toEqual(
      new Set(PARTITION_ENTITIES_V3),
    );
    expect(outcome.legacyAfter.digest.count).toBe(4);
    expect(outcome.currentBefore.digest?.count).toBe(4);
    expect(outcome.currentAfter.digest).toEqual(outcome.expected);
    expect(outcome.currentAfter.digest?.count).toBe(7);
    expect(outcome.currentAfter.digest?.digest).not.toBe(outcome.currentBefore.digest?.digest);
  });

  it("bounds a pull page by the payload budget without splitting a group", async () => {
    const organizationId = decodeOrganizationId("org-catalog-budget");
    const actor = actorFor(organizationId);
    const filler = "x".repeat(600_000);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId, "2");
        for (const commitSequence of ["1", "2"]) {
          const changes = [0, 1].map((ordinal) => ({
            organizationId,
            commitSequence,
            ordinal,
            entity: "category",
            action: "upsert" as const,
            entityId: `big-${commitSequence}-${ordinal}`,
            rowVersion: 1,
            rowJson: `{"id":"big-${commitSequence}-${ordinal}","filler":"${filler}"}`,
          }));
          yield* db.insert(inventoryTransactions).values({
            organizationId,
            commitSequence,
            operationId: `bulk-${commitSequence}`,
            decision: "accepted",
            epoch: LAST_UNIT_EPOCH,
            byteLength: changes.reduce((total, change) => total + change.rowJson.length, 128),
          });
          yield* db.insert(inventoryChanges).values(changes);
        }
        const first = yield* commands.pull(actor, pullFrom("0"));
        const second = yield* commands.pull(actor, pullFrom(first.nextCommitSequence));
        return { first, second };
      }),
    );
    expect(MAX_TRANSPORT_PAYLOAD_BYTES).toBeLessThan(2 * 1_200_000);
    expect(outcome.first.transactions).toHaveLength(1);
    expect(outcome.first.transactions[0]?.changes).toHaveLength(2);
    expect(outcome.first.nextCommitSequence).toBe("1");
    expect(outcome.second.transactions).toHaveLength(1);
    expect(outcome.second.nextCommitSequence).toBe("2");
  });
});
