import * as PgClient from "@effect/sql-pg/PgClient";
import {
  ACTIVE_REPLICA_WINDOW_MILLIS,
  catalogWriteError,
  MAX_SYNC_PULL_TRANSACTIONS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION_V3,
  PARTITION_ENTITIES_V3,
  partitionDigestOf,
  purchasingRejection,
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
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import { withSerializationRetry } from "../../src/inventory/postgres";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { typedCommands } from "./typed-commands";

const OCCURRED_AT = 1_700_000_000_000;
const CATEGORY_ID = decodeCategoryId("cat-1");
const PRODUCT_ID = decodeProductId("prod-1");
const BATCH_ID = decodeBatchId("batch-1");
const SUPPLIER_ID = decodeSupplierId("sup-1");
const ORDER_ID = decodePurchaseOrderId("po-1");
const LINE_ID = decodePurchaseOrderItemId("line-1");

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

const productUpdate = (
  id: string,
  expectedRowVersion: number | null,
  name: string,
  unitsPerPack: number,
): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(id),
  expectedRowVersion,
  row: productRow("cat-1", name, unitsPerPack),
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

const supplierDelete = (id: string, expectedRowVersion: number): CatalogRowWrite => ({
  entity: "supplier",
  action: "delete",
  id: decodeSupplierId(id),
  expectedRowVersion,
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

const orderDelete = (id: string, expectedRowVersion: number): CatalogRowWrite => ({
  entity: "purchaseOrder",
  action: "delete",
  id: decodePurchaseOrderId(id),
  expectedRowVersion,
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

const lineDelete = (id: string, expectedRowVersion: number): CatalogRowWrite => ({
  entity: "purchaseOrderItem",
  action: "delete",
  id: decodePurchaseOrderItemId(id),
  expectedRowVersion,
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

const seedPurchasing = () =>
  catalogCommand("cmd-seed", [
    categoryInsert("cat-1", "Painkillers"),
    productInsert("prod-1", "cat-1", "Panadol"),
    supplierWrite("sup-1", null, "Acme"),
    orderWrite("po-1", null),
    lineWrite("line-1", null),
  ]);

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

const CATALOG_ENTITIES = new Set(["category", "product", "batch"]);

const catalogRowsOf = (rows: ReadonlyArray<PartitionLeafSource>) =>
  rows.filter((row) => CATALOG_ENTITIES.has(row.entity));

describe("postgres catalog writes", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("inserts catalog rows, records stock_in, and adjusts on a quantity change", async () => {
    const organizationId = decodeOrganizationId("org-catalog-insert");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        const seeded = yield* commands.commit(
          actor,
          catalogEnvelope(organizationId, "1", seedCatalog()),
        );
        const adjusted = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-adjust", [batchWrite("batch-1", 1, "mv-adjust", 3, 5, "Recount")]),
          ),
        );
        const pulled = yield* commands.pull(actor, pullFrom("0"));
        const movements = yield* db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.organizationId, organizationId))
          .orderBy(asc(stockMovements.id));
        const [batch] = yield* db
          .select()
          .from(batches)
          .where(and(eq(batches.organizationId, organizationId), eq(batches.id, BATCH_ID)))
          .limit(1);
        return { seeded, adjusted, pulled, movements, batch };
      }),
    );
    expect(outcome.seeded.decision).toBe("accepted");
    expect(outcome.seeded.result).toMatchObject({ _tag: "catalogWrite", rowsWritten: 3 });
    expect(outcome.adjusted.result).toMatchObject({ _tag: "catalogWrite", rowsWritten: 1 });
    expect(outcome.pulled.transactions).toHaveLength(2);
    expect(outcome.pulled.transactions[0]?.changes).toHaveLength(4);
    expect(outcome.movements.map((movement) => movement.type)).toEqual(["adjustment", "stock_in"]);
    expect(outcome.movements.find((movement) => movement.id === "mv-seed")).toMatchObject({
      type: "stock_in",
      packDelta: 2,
      unitDelta: 0,
    });
    expect(outcome.movements.find((movement) => movement.id === "mv-adjust")).toMatchObject({
      type: "adjustment",
      packDelta: 1,
      unitDelta: 5,
      note: "Recount",
    });
    expect(outcome.batch).toMatchObject({ packQuantity: 3, unitQuantity: 5, rowVersion: 2 });
  });

  it("guards a units-per-pack change by row version and accepts a fresh one", async () => {
    const organizationId = decodeOrganizationId("org-catalog-units");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "1",
            catalogCommand("cmd-seed", [
              categoryInsert("cat-1", "Painkillers"),
              productInsert("prod-1", "cat-1", "Panadol"),
            ]),
          ),
        );
        const stale = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-units-stale", [productUpdate("prod-1", 9, "Panadol", 20)]),
          ),
        );
        const fresh = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "3",
            catalogCommand("cmd-units-fresh", [productUpdate("prod-1", 1, "Panadol", 20)]),
          ),
        );
        const [product] = yield* db
          .select()
          .from(products)
          .where(and(eq(products.organizationId, organizationId), eq(products.id, PRODUCT_ID)))
          .limit(1);
        return { stale, fresh, product };
      }),
    );
    expect(outcome.stale.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.fresh.decision).toBe("accepted");
    expect(outcome.product).toMatchObject({ unitsPerPack: 20, rowVersion: 2 });
  });

  it.each([
    {
      name: "a units-per-pack change while the product still has stock",
      organization: "org-catalog-units-stock",
      write: productUpdate("prod-1", 1, "Panadol", 20),
      message: catalogWriteError.unitsPerPackWithStock,
    },
    {
      name: "deleting a category that still has an active product",
      organization: "org-catalog-category-delete",
      write: {
        entity: "category",
        action: "delete",
        id: CATEGORY_ID,
        expectedRowVersion: 1,
      } satisfies CatalogRowWrite,
      message: catalogWriteError.categoryHasProducts,
    },
    {
      name: "deleting a batch that still has stock",
      organization: "org-catalog-batch-delete",
      write: {
        entity: "batch",
        action: "delete",
        id: BATCH_ID,
        expectedRowVersion: 1,
      } satisfies CatalogRowWrite,
      message: catalogWriteError.batchHasStock,
    },
  ])("blocks $name", async ({ organization, write, message }) => {
    const organizationId = decodeOrganizationId(organization);
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        return yield* commands.commit(
          actor,
          catalogEnvelope(organizationId, "2", catalogCommand("cmd-blocked", [write])),
        );
      }),
    );
    expect(outcome.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT", message });
  });

  it("accepts an unguarded product field update with a stale row version", async () => {
    const organizationId = decodeOrganizationId("org-catalog-lww");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        const renamed = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-rename", [productUpdate("prod-1", 9, "Panadol Extra", 10)]),
          ),
        );
        const [product] = yield* db
          .select()
          .from(products)
          .where(and(eq(products.organizationId, organizationId), eq(products.id, PRODUCT_ID)))
          .limit(1);
        return { renamed, product };
      }),
    );
    expect(outcome.renamed.decision).toBe("accepted");
    expect(outcome.product).toMatchObject({ name: "Panadol Extra", rowVersion: 2 });
  });

  it("soft deletes products and hard deletes categories while publishing delete images", async () => {
    const organizationId = decodeOrganizationId("org-catalog-delete");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-empty", [batchWrite("batch-1", 1, "mv-empty", 0, 0)]),
          ),
        );
        const deleted = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "3",
            catalogCommand("cmd-delete-all", [
              { entity: "batch", action: "delete", id: BATCH_ID, expectedRowVersion: 2 },
              { entity: "product", action: "delete", id: PRODUCT_ID, expectedRowVersion: 1 },
              { entity: "category", action: "delete", id: CATEGORY_ID, expectedRowVersion: 1 },
            ]),
          ),
        );
        const pulled = yield* commands.pull(actor, pullFrom("2"));
        const digested = yield* commands.pull(actor, pullFrom("0", true));
        const remainingRows = yield* activePartitionRows(db, organizationId);
        const [product] = yield* db
          .select()
          .from(products)
          .where(and(eq(products.organizationId, organizationId), eq(products.id, PRODUCT_ID)))
          .limit(1);
        const remainingCategories = yield* db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.organizationId, organizationId));
        return { deleted, pulled, digested, remainingRows, product, remainingCategories };
      }),
    );
    expect(outcome.deleted.decision).toBe("accepted");
    expect(outcome.deleted.result).toMatchObject({ _tag: "catalogWrite", rowsWritten: 3 });
    expect(outcome.product).toMatchObject({ deletedAt: OCCURRED_AT, rowVersion: 2 });
    expect(outcome.remainingCategories).toEqual([]);
    expect(catalogRowsOf(outcome.remainingRows)).toEqual([]);
    expect(outcome.digested.digest).toEqual(
      await Effect.runPromise(partitionDigestOf(outcome.remainingRows)),
    );
    const changes = outcome.pulled.transactions[0]?.changes ?? [];
    expect(changes.map((change) => change.action)).toEqual(["delete", "delete", "delete"]);
    const productChange = changes.find((change) => change.entity === "product");
    expect(productChange?.rowVersion).toBe(2);
    expect(productChange?.row).toMatchObject({ deletedAt: OCCURRED_AT, rowVersion: 2 });
    const categoryChange = changes.find((change) => change.entity === "category");
    expect(categoryChange?.rowVersion).toBe(2);
    expect(categoryChange?.row).toMatchObject({ id: CATEGORY_ID, name: "Painkillers" });
  });

  it("frees the category name for a later insert after a hard delete", async () => {
    const organizationId = decodeOrganizationId("org-catalog-delete-reuse");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "1",
            catalogCommand("cmd-seed-category", [categoryInsert("cat-1", "Pain relief")]),
          ),
        );
        yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-drop-category", [
              { entity: "category", action: "delete", id: CATEGORY_ID, expectedRowVersion: 1 },
            ]),
          ),
        );
        const recreated = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "3",
            catalogCommand("cmd-recreate-category", [categoryInsert("cat-2", "Pain relief")]),
          ),
        );
        const remaining = yield* db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.organizationId, organizationId));
        return { recreated, remaining };
      }),
    );
    expect(outcome.recreated.decision).toBe("accepted");
    expect(outcome.remaining).toEqual([{ id: "cat-2", name: "Pain relief" }]);
  });

  it("rejects a second replica's category whose name is already taken", async () => {
    const organizationId = decodeOrganizationId("org-catalog-name-collision");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* db.insert(replicas).values({
          organizationId,
          replicaId: LAST_UNIT_REPLICA_B,
          ownerUserId: "user-1",
          deviceLabel: LAST_UNIT_REPLICA_B,
          lastClientSequence: "0",
          processedThroughClientSequence: "0",
          registeredAt: OCCURRED_AT,
          lastSeenAt: OCCURRED_AT,
        });
        const first = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "1",
            catalogCommand("cmd-tea-a", [categoryInsert("cat-tea-a", "Tea")]),
          ),
        );
        const second = yield* commands.commit(actor, {
          ...catalogEnvelope(
            organizationId,
            "1",
            catalogCommand("cmd-tea-b", [
              categoryInsert("cat-coffee-b", "Coffee"),
              categoryInsert("cat-tea-b", "Tea"),
            ]),
          ),
          replicaId: LAST_UNIT_REPLICA_B,
        });
        const renamed = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-rename-a", [
              categoryInsert("cat-coffee-a", "Coffee"),
              {
                entity: "category",
                action: "upsert",
                id: decodeCategoryId("cat-coffee-a"),
                expectedRowVersion: 1,
                row: { name: "Tea", tracksPacks: true },
              },
            ]),
          ),
        );
        const remaining = yield* db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.organizationId, organizationId))
          .orderBy(asc(categories.id));
        const [replicaB] = yield* db
          .select({ lastClientSequence: replicas.lastClientSequence })
          .from(replicas)
          .where(
            and(
              eq(replicas.organizationId, organizationId),
              eq(replicas.replicaId, LAST_UNIT_REPLICA_B),
            ),
          );
        return { first, second, renamed, remaining, replicaB };
      }),
    );
    expect(outcome.first.decision).toBe("accepted");
    expect(outcome.second.decision).toBe("rejected");
    expect(outcome.second.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.renamed.decision).toBe("rejected");
    expect(outcome.renamed.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.remaining).toEqual([{ id: "cat-tea-a", name: "Tea" }]);
    expect(outcome.replicaB?.lastClientSequence).toBe("1");
  });

  it("checks each row against the rows written before it in the same command", async () => {
    const organizationId = decodeOrganizationId("org-catalog-in-command");
    const actor = actorFor(organizationId);
    const categoryWrite = (
      id: string,
      expectedRowVersion: number,
      name: string,
    ): CatalogRowWrite => ({
      entity: "category",
      action: "upsert",
      id: decodeCategoryId(id),
      expectedRowVersion,
      row: { name, tracksPacks: true },
    });
    const remove = (
      entity: "category" | "product" | "batch",
      id: string,
      expectedRowVersion: number,
    ): CatalogRowWrite =>
      entity === "category"
        ? { entity, action: "delete", id: decodeCategoryId(id), expectedRowVersion }
        : entity === "product"
          ? { entity, action: "delete", id: decodeProductId(id), expectedRowVersion }
          : { entity, action: "delete", id: decodeBatchId(id), expectedRowVersion };
    const stockedBatch = (id: string, movementId: string): CatalogRowWrite => ({
      entity: "batch",
      action: "upsert",
      id: decodeBatchId(id),
      expectedRowVersion: null,
      movementId,
      note: null,
      row: {
        productId: decodeProductId("prod-2"),
        batchNumber: id,
        expiresAt: null,
        packQuantity: 1,
        unitQuantity: 0,
      },
    });
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        const retired = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-retire", [
              categoryWrite("cat-1", 1, "Analgesics"),
              categoryInsert("cat-2", "Painkillers"),
              batchWrite("batch-1", 1, "mv-clear", 0, 0),
              remove("batch", "batch-1", 2),
              remove("product", "prod-1", 1),
              remove("category", "cat-1", 2),
            ]),
          ),
        );
        const duplicated = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "3",
            catalogCommand("cmd-duplicate-movement", [
              productInsert("prod-2", "cat-2", "Brufen"),
              stockedBatch("batch-2", "mv-dup"),
              stockedBatch("batch-3", "mv-dup"),
            ]),
          ),
        );
        const categoryRows = yield* db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.organizationId, organizationId));
        const productRows = yield* db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.organizationId, organizationId))
          .orderBy(asc(products.id));
        const pulled = yield* commands.pull(actor, pullFrom("1"));
        return { retired, duplicated, categoryRows, productRows, pulled };
      }),
    );
    expect(outcome.retired.decision).toBe("accepted");
    expect(outcome.duplicated.result).toEqual({
      _tag: "rejected",
      code: "ENTITY_CONFLICT",
      message: "Movement mv-dup is already recorded.",
    });
    expect(outcome.categoryRows).toEqual([{ id: "cat-2", name: "Painkillers" }]);
    expect(outcome.productRows).toEqual([{ id: "prod-1" }]);
    expect(
      outcome.pulled.transactions[0]?.changes.map((change) => [
        change.entity,
        change.action,
        change.entityId,
      ]),
    ).toEqual([
      ["category", "upsert", "cat-1"],
      ["category", "upsert", "cat-2"],
      ["batch", "upsert", "batch-1"],
      ["stockMovement", "upsert", "mv-clear"],
      ["batch", "delete", "batch-1"],
      ["product", "delete", "prod-1"],
      ["category", "delete", "cat-1"],
    ]);
    expect(outcome.pulled.transactions[1]?.changes).toEqual([]);
  });

  it("keeps supplier names unique and refuses to delete a supplier that has orders", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-suppliers");
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db, write } = yield* openCatalog(organizationId);
        const created = yield* write("cmd-suppliers", [
          supplierWrite("sup-1", null, "Acme"),
          supplierWrite("sup-2", null, "Globex", "923001234567"),
          orderWrite("po-1", null),
        ]);
        const duplicate = yield* write("cmd-duplicate", [supplierWrite("sup-3", null, "Acme")]);
        const renamedOnto = yield* write("cmd-rename-onto", [supplierWrite("sup-2", 1, "Acme")]);
        const renamed = yield* write("cmd-rename", [
          supplierWrite("sup-2", 1, "Globex Pharma", "923001234567"),
        ]);
        const referenced = yield* write("cmd-delete-used", [supplierDelete("sup-1", 1)]);
        const stale = yield* write("cmd-delete-stale", [supplierDelete("sup-2", 1)]);
        const deleted = yield* write("cmd-delete", [supplierDelete("sup-2", 2)]);
        const pulled = yield* commands.pull(actorFor(organizationId), pullFrom("6"));
        const remaining = yield* db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.organizationId, organizationId));
        return {
          created,
          duplicate,
          renamedOnto,
          renamed,
          referenced,
          stale,
          deleted,
          pulled,
          remaining,
        };
      }),
    );
    expect(outcome.created).toMatchObject({ ...ACCEPTED, rowsWritten: 3 });
    expect(outcome.duplicate).toEqual({
      _tag: "rejected",
      code: "ENTITY_CONFLICT",
      message: "Supplier name Acme is already in use.",
    });
    expect(outcome.renamedOnto).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.renamed).toMatchObject(ACCEPTED);
    expect(outcome.referenced).toEqual(rejection(purchasingRejection.supplierHasOrders));
    expect(outcome.stale).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.deleted).toMatchObject(ACCEPTED);
    expect(outcome.pulled.transactions[0]?.changes).toMatchObject([
      {
        entity: "supplier",
        action: "delete",
        entityId: "sup-2",
        rowVersion: 3,
        row: { id: "sup-2", name: "Globex Pharma", phone: "923001234567", rowVersion: 2 },
      },
    ]);
    expect(outcome.remaining).toEqual([{ id: "sup-1", name: "Acme" }]);
  });

  it("requires an existing supplier and a draft for a new order, and renumbers a taken order number", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-orders");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, write } = yield* openCatalog(organizationId);
        yield* write("cmd-supplier", [supplierWrite("sup-1", null, "Acme")]);
        const missingSupplier = yield* write("cmd-missing-supplier", [
          orderWrite("po-x", null, { supplierId: "sup-missing" }),
        ]);
        const bornSent = yield* write("cmd-born-sent", [
          orderWrite("po-x", null, { status: "sent" }),
        ]);
        const first = yield* write("cmd-first", [orderWrite("po-1", null, { orderNumber: 1 })]);
        const taken = yield* write("cmd-taken", [
          orderWrite("po-2", null, { orderNumber: 1 }),
          orderWrite("po-3", null, { orderNumber: 7 }),
          orderWrite("po-4", null, { orderNumber: 2 }),
        ]);
        const duplicate = yield* write("cmd-duplicate", [orderWrite("po-1", null)]);
        const renumbered = yield* write("cmd-renumber", [
          orderWrite("po-2", 1, { orderNumber: 99, status: "sent" }),
        ]);
        const orders = yield* db
          .select({
            id: purchaseOrders.id,
            orderNumber: purchaseOrders.orderNumber,
            status: purchaseOrders.status,
            rowVersion: purchaseOrders.rowVersion,
          })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.organizationId, organizationId))
          .orderBy(asc(purchaseOrders.id));
        return { missingSupplier, bornSent, first, taken, duplicate, renumbered, orders };
      }),
    );
    expect(outcome.missingSupplier).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_RELATION_INVALID",
    });
    expect(outcome.bornSent).toEqual(rejection(purchasingRejection.orderTransitionInvalid));
    expect(outcome.first).toMatchObject(ACCEPTED);
    expect(outcome.taken).toMatchObject(ACCEPTED);
    expect(outcome.duplicate).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.renumbered).toMatchObject(ACCEPTED);
    expect(outcome.orders).toEqual([
      { id: "po-1", orderNumber: 1, status: "draft", rowVersion: 1 },
      { id: "po-2", orderNumber: 2, status: "sent", rowVersion: 2 },
      { id: "po-3", orderNumber: 7, status: "draft", rowVersion: 1 },
      { id: "po-4", orderNumber: 8, status: "draft", rowVersion: 1 },
    ]);
  });

  it.each<{
    readonly name: string;
    readonly moves: ReadonlyArray<PurchaseOrderStatus>;
    readonly refused: { readonly code: string; readonly message: string } | null;
  }>([
    { name: "draft to sent to closed", moves: ["sent", "closed"], refused: null },
    { name: "draft to cancelled", moves: ["cancelled"], refused: null },
    { name: "sent to cancelled", moves: ["sent", "cancelled"], refused: null },
    { name: "an edit that keeps a sent order sent", moves: ["sent", "sent"], refused: null },
    {
      name: "draft straight to closed",
      moves: ["closed"],
      refused: purchasingRejection.orderTransitionInvalid,
    },
    {
      name: "sent back to draft",
      moves: ["sent", "draft"],
      refused: purchasingRejection.orderTransitionInvalid,
    },
    {
      name: "closed back to sent",
      moves: ["sent", "closed", "sent"],
      refused: purchasingRejection.orderNotOpen,
    },
    {
      name: "cancelled back to draft",
      moves: ["cancelled", "draft"],
      refused: purchasingRejection.orderNotOpen,
    },
  ])("decides the order transition $name", async ({ moves, refused }) => {
    const organizationId = decodeOrganizationId(`org-purchasing-move-${moves.join("-")}`);
    const results = await run(
      Effect.gen(function* () {
        const { write } = yield* openCatalog(organizationId);
        yield* write("cmd-seed", [supplierWrite("sup-1", null, "Acme"), orderWrite("po-1", null)]);
        return yield* Effect.forEach(moves, (status, index) =>
          write(`cmd-move-${index}`, [orderWrite("po-1", index + 1, { status })]),
        );
      }),
    );
    for (const result of results.slice(0, -1)) expect(result).toMatchObject(ACCEPTED);
    if (refused === null) expect(results.at(-1)).toMatchObject(ACCEPTED);
    else expect(results.at(-1)).toEqual(rejection(refused));
  });

  it("deletes only a draft order that has no lines", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-order-delete");
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db, write } = yield* openCatalog(organizationId);
        yield* write("cmd-seed", [
          ...seedPurchasing().writes,
          orderWrite("po-2", null, { orderNumber: 2 }),
          orderWrite("po-2", 1, { status: "sent" }),
        ]);
        const sent = yield* write("cmd-delete-sent", [orderDelete("po-2", 2)]);
        const withLines = yield* write("cmd-delete-lines", [orderDelete("po-1", 1)]);
        const stale = yield* write("cmd-delete-stale", [
          lineDelete("line-1", 1),
          orderDelete("po-1", 9),
        ]);
        const deleted = yield* write("cmd-delete", [
          lineDelete("line-1", 1),
          orderDelete("po-1", 1),
        ]);
        const pulled = yield* commands.pull(actorFor(organizationId), pullFrom("4"));
        const orders = yield* db
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.organizationId, organizationId));
        const lines = yield* db
          .select({ id: purchaseOrderItems.id })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.organizationId, organizationId));
        return { sent, withLines, stale, deleted, pulled, orders, lines };
      }),
    );
    expect(outcome.sent).toEqual(rejection(purchasingRejection.orderNotDraft));
    expect(outcome.withLines).toEqual(rejection(purchasingRejection.orderHasItems));
    expect(outcome.stale).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.deleted).toMatchObject(ACCEPTED);
    expect(
      outcome.pulled.transactions[0]?.changes.map((change) => [
        change.entity,
        change.action,
        change.entityId,
        change.rowVersion,
      ]),
    ).toEqual([
      ["purchaseOrderItem", "delete", "line-1", 2],
      ["purchaseOrder", "delete", "po-1", 2],
    ]);
    expect(outcome.orders).toEqual([{ id: "po-2" }]);
    expect(outcome.lines).toEqual([]);
  });

  it("accepts an order line only for an open order, a live product and a matching base quantity", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-lines");
    const outcome = await run(
      Effect.gen(function* () {
        const { db, write } = yield* openCatalog(organizationId);
        yield* write("cmd-seed", [
          ...seedPurchasing().writes,
          orderWrite("po-closed", null, { orderNumber: 2 }),
          lineWrite("line-closed", null, { purchaseOrderId: "po-closed" }),
          orderWrite("po-closed", 1, { status: "sent" }),
          orderWrite("po-closed", 2, { status: "closed" }),
        ]);
        const missingOrder = yield* write("cmd-missing-order", [
          lineWrite("line-x", null, { purchaseOrderId: "po-missing" }),
        ]);
        const missingProduct = yield* write("cmd-missing-product", [
          lineWrite("line-x", null, { productId: "prod-missing" }),
        ]);
        const wrongPacks = yield* write("cmd-wrong-packs", [
          lineWrite("line-x", null, { quantity: 2, quantityType: "pack", baseUnitQuantity: 2 }),
        ]);
        const wrongUnits = yield* write("cmd-wrong-units", [
          lineWrite("line-x", null, { quantity: 5, quantityType: "unit", baseUnitQuantity: 50 }),
        ]);
        const closedInsert = yield* write("cmd-closed-insert", [
          lineWrite("line-x", null, { purchaseOrderId: "po-closed" }),
        ]);
        const closedEdit = yield* write("cmd-closed-edit", [
          lineWrite("line-closed", 1, {
            purchaseOrderId: "po-closed",
            quantity: 3,
            baseUnitQuantity: 30,
          }),
        ]);
        const closedDelete = yield* write("cmd-closed-delete", [lineDelete("line-closed", 1)]);
        const movedToClosed = yield* write("cmd-move-closed", [
          lineWrite("line-1", 1, { purchaseOrderId: "po-closed" }),
        ]);
        const accepted = yield* write("cmd-lines", [
          orderWrite("po-1", 1, { status: "sent" }),
          lineWrite("line-units", null, { quantity: 5, quantityType: "unit", baseUnitQuantity: 5 }),
          lineWrite("line-1", 1, { quantity: 4, baseUnitQuantity: 40 }),
        ]);
        const lines = yield* db
          .select({
            id: purchaseOrderItems.id,
            purchaseOrderId: purchaseOrderItems.purchaseOrderId,
            quantity: purchaseOrderItems.quantity,
            quantityType: purchaseOrderItems.quantityType,
            baseUnitQuantity: purchaseOrderItems.baseUnitQuantity,
            receivedBaseUnits: purchaseOrderItems.receivedBaseUnits,
            rowVersion: purchaseOrderItems.rowVersion,
          })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.organizationId, organizationId))
          .orderBy(asc(purchaseOrderItems.id));
        return {
          missingOrder,
          missingProduct,
          wrongPacks,
          wrongUnits,
          closedInsert,
          closedEdit,
          closedDelete,
          movedToClosed,
          accepted,
          lines,
        };
      }),
    );
    expect(outcome.missingOrder).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_RELATION_INVALID",
    });
    expect(outcome.missingProduct).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_RELATION_INVALID",
    });
    expect(outcome.wrongPacks).toEqual(rejection(purchasingRejection.itemQuantityInvalid));
    expect(outcome.wrongUnits).toEqual(rejection(purchasingRejection.itemQuantityInvalid));
    expect(outcome.closedInsert).toEqual(rejection(purchasingRejection.orderNotOpen));
    expect(outcome.closedEdit).toEqual(rejection(purchasingRejection.orderNotOpen));
    expect(outcome.closedDelete).toEqual(rejection(purchasingRejection.orderNotOpen));
    expect(outcome.movedToClosed).toEqual(rejection(purchasingRejection.orderNotOpen));
    expect(outcome.accepted).toMatchObject({ ...ACCEPTED, rowsWritten: 3 });
    expect(outcome.lines).toEqual([
      {
        id: "line-1",
        purchaseOrderId: "po-1",
        quantity: 4,
        quantityType: "pack",
        baseUnitQuantity: 40,
        receivedBaseUnits: 0,
        rowVersion: 2,
      },
      {
        id: "line-closed",
        purchaseOrderId: "po-closed",
        quantity: 2,
        quantityType: "pack",
        baseUnitQuantity: 20,
        receivedBaseUnits: 0,
        rowVersion: 1,
      },
      {
        id: "line-units",
        purchaseOrderId: "po-1",
        quantity: 5,
        quantityType: "unit",
        baseUnitQuantity: 5,
        receivedBaseUnits: 0,
        rowVersion: 1,
      },
    ]);
  });

  it("receives a delivery: adds base units to the line and stamps the movement with the order", async () => {
    const organizationId = decodeOrganizationId("org-purchasing-receipt");
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db, write } = yield* openCatalog(organizationId);
        yield* write("cmd-seed", [
          ...seedPurchasing().writes,
          productInsert("prod-2", "cat-1", "Brufen"),
        ]);
        const first = yield* write("cmd-receive-1", [
          receivedBatch("batch-r1", "line-1", 1, 3),
          batchWrite("batch-plain", null, "mv-plain", 1, 0),
        ]);
        const second = yield* write("cmd-receive-2", [
          orderWrite("po-1", 1, { status: "sent" }),
          receivedBatch("batch-r2", "line-1", 1, 0),
        ]);
        const missingLine = yield* write("cmd-missing-line", [
          receivedBatch("batch-x", "line-missing", 1, 0),
        ]);
        const otherProduct = yield* write("cmd-other-product", [
          receivedBatch("batch-x", "line-1", 1, 0, { productId: "prod-2" }),
        ]);
        const onUpdate = yield* write("cmd-receipt-update", [
          receivedBatch("batch-r1", "line-1", 2, 3, { expectedRowVersion: 1 }),
        ]);
        const deleteReceived = yield* write("cmd-delete-received", [lineDelete("line-1", 3)]);
        const reassign = yield* write("cmd-reassign", [
          lineWrite("line-1", 3, { productId: "prod-2" }),
        ]);
        const edited = yield* write("cmd-edit", [
          lineWrite("line-1", 3, { quantity: 3, baseUnitQuantity: 30 }),
        ]);
        yield* write("cmd-close", [orderWrite("po-1", 2, { status: "closed" })]);
        const afterClose = yield* write("cmd-receive-closed", [
          receivedBatch("batch-x", "line-1", 1, 0),
        ]);
        const pulled = yield* commands.pull(actorFor(organizationId), pullFrom("1"));
        const [line] = yield* db
          .select()
          .from(purchaseOrderItems)
          .where(
            and(
              eq(purchaseOrderItems.organizationId, organizationId),
              eq(purchaseOrderItems.id, LINE_ID),
            ),
          );
        const movements = yield* db
          .select({ id: stockMovements.id, purchaseOrderId: stockMovements.purchaseOrderId })
          .from(stockMovements)
          .where(eq(stockMovements.organizationId, organizationId))
          .orderBy(asc(stockMovements.id));
        return {
          first,
          second,
          missingLine,
          otherProduct,
          onUpdate,
          deleteReceived,
          reassign,
          edited,
          afterClose,
          pulled,
          line,
          movements,
        };
      }),
    );
    expect(outcome.first).toMatchObject({ ...ACCEPTED, rowsWritten: 2 });
    expect(outcome.second).toMatchObject(ACCEPTED);
    expect(outcome.missingLine).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_RELATION_INVALID",
    });
    expect(outcome.otherProduct).toEqual(rejection(purchasingRejection.receiptProductMismatch));
    expect(outcome.onUpdate).toEqual(rejection(purchasingRejection.receiptOnExistingBatch));
    expect(outcome.deleteReceived).toEqual(rejection(purchasingRejection.itemReceived));
    expect(outcome.reassign).toEqual(rejection(purchasingRejection.itemReceived));
    expect(outcome.edited).toMatchObject(ACCEPTED);
    expect(outcome.afterClose).toEqual(rejection(purchasingRejection.orderNotOpen));
    expect(outcome.pulled.transactions[0]?.changes).toMatchObject([
      { entity: "batch", action: "upsert", entityId: "batch-r1", rowVersion: 1 },
      {
        entity: "stockMovement",
        action: "upsert",
        entityId: "mv-batch-r1-0",
        row: { type: "stock_in", packDelta: 1, unitDelta: 3, purchaseOrderId: "po-1" },
      },
      {
        entity: "purchaseOrderItem",
        action: "upsert",
        entityId: "line-1",
        rowVersion: 2,
        row: { receivedBaseUnits: 13, baseUnitQuantity: 20, rowVersion: 2 },
      },
      { entity: "batch", action: "upsert", entityId: "batch-plain" },
      {
        entity: "stockMovement",
        action: "upsert",
        entityId: "mv-plain",
        row: { purchaseOrderId: null },
      },
    ]);
    expect(outcome.line).toMatchObject({
      quantity: 3,
      baseUnitQuantity: 30,
      receivedBaseUnits: 23,
      rowVersion: 4,
    });
    expect(outcome.movements).toEqual([
      { id: "mv-batch-r1-0", purchaseOrderId: "po-1" },
      { id: "mv-batch-r2-0", purchaseOrderId: "po-1" },
      { id: "mv-plain", purchaseOrderId: null },
    ]);
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
          .set({ lastSeenAt: now - ACTIVE_REPLICA_WINDOW_MILLIS - 60_000 })
          .where(peer);
        const dormant = yield* write("cmd-dormant", [supplierWrite("sup-1", null, "Acme")]);
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

  it("returns the partition digest only when the page reaches the horizon", async () => {
    const organizationId = decodeOrganizationId("org-catalog-digest");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-rename", [productUpdate("prod-1", 9, "Panadol Extra", 10)]),
          ),
        );
        const complete = yield* commands.pull(actor, pullFrom("0", true));
        const withoutDigest = yield* commands.pull(actor, pullFrom("0"));
        const rows = yield* activePartitionRows(db, organizationId);
        const expected = yield* partitionDigestOf(rows);
        return { complete, withoutDigest, rows, expected };
      }),
    );
    expect(outcome.withoutDigest.digest).toBeUndefined();
    expect(outcome.rows.some((row) => row.entity === "stockMovement")).toBe(true);
    expect(outcome.complete.digest).toEqual(outcome.expected);
    expect(outcome.complete.digest?.version).toBe(PARTITION_DIGEST_VERSION);
  });

  it("retries a statement that Postgres aborts with a serialization failure", async () => {
    let attempts = 0;
    const committed = await run(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        return yield* withSerializationRetry(
          Effect.suspend(() => {
            attempts += 1;
            return attempts < 3
              ? db
                  .execute(
                    sql.raw(
                      "DO $$ BEGIN RAISE EXCEPTION 'conflict' USING ERRCODE = '40001'; END $$",
                    ),
                  )
                  .pipe(Effect.as(attempts))
              : Effect.succeed(attempts);
          }),
        );
      }),
    );
    expect(committed).toBe(3);
  });

  it("retries a deadlock and leaves other database errors alone", async () => {
    const sqlFailure = (reason: SqlError.SqlErrorReason) => new SqlError.SqlError({ reason });
    let deadlockAttempts = 0;
    const deadlocked = Effect.suspend(() => {
      deadlockAttempts += 1;
      if (deadlockAttempts < 2) {
        return Effect.fail(
          new EffectDrizzleQueryError({
            query: "update batches",
            params: [],
            cause: Cause.fail(
              sqlFailure(new SqlError.DeadlockError({ cause: new Error("deadlock detected") })),
            ),
          }),
        );
      }
      return Effect.succeed(deadlockAttempts);
    });
    expect(await Effect.runPromise(withSerializationRetry(deadlocked))).toBe(2);

    let uniqueAttempts = 0;
    const duplicated = Effect.suspend(() => {
      uniqueAttempts += 1;
      return Effect.fail(
        sqlFailure(
          new SqlError.UniqueViolation({ cause: new Error("duplicate key"), constraint: "pk" }),
        ),
      );
    });
    const failure = await Effect.runPromise(withSerializationRetry(duplicated).pipe(Effect.flip));
    expect(failure.reason._tag).toBe("UniqueViolation");
    expect(uniqueAttempts).toBe(1);
  });
});
