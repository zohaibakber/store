import * as PgClient from "@effect/sql-pg/PgClient";
import {
  catalogWriteError,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  rowImageDigest,
  SyncProtocolError,
  type CatalogRowWrite,
  type CatalogWriteCommand,
  type SnapshotRow,
  type SyncCommandEnvelope,
  type SyncPullRequest,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeOrganizationId,
  decodeProductId,
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
  products,
  replicas,
  stockMovements,
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

import { makeInventoryCommands, PULL_PAYLOAD_BUDGET_BYTES } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import { runTransaction, withSerializationRetry } from "../../src/inventory/postgres";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);

const OCCURRED_AT = 1_700_000_000_000;
const CATEGORY_ID = decodeCategoryId("cat-1");
const PRODUCT_ID = decodeProductId("prod-1");
const BATCH_ID = decodeBatchId("batch-1");

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

const pullFrom = (afterCommitSequence: string, includeDigest = false) =>
  ({
    epoch: LAST_UNIT_EPOCH,
    subscription: OPERATIONAL_SUBSCRIPTION,
    afterCommitSequence: OrgCommitSequence.make(afterCommitSequence),
    includeDigest,
  }) satisfies SyncPullRequest;

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

const openCatalog = (organizationId: string, commitSequence = "0") =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
    yield* db.insert(inventoryState).values({
      organizationId,
      status: "ready",
      importId: "import-test",
      releaseId: "release-test",
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
    return { commands: makeInventoryCommands(db), db };
  });

type CatalogDb = Effect.Success<ReturnType<typeof openCatalog>>["db"];

const seedCatalog = () =>
  catalogCommand("cmd-seed", [
    categoryInsert("cat-1", "Painkillers"),
    productInsert("prod-1", "cat-1", "Panadol"),
    batchWrite("batch-1", null, "mv-seed", 2, 0),
  ]);

const activePartitionRows = (db: CatalogDb, organizationId: string) =>
  Effect.gen(function* () {
    const rows: SnapshotRow[] = [];
    const categoryRows = yield* db
      .select()
      .from(categories)
      .where(eq(categories.organizationId, organizationId))
      .orderBy(asc(categories.id));
    for (const row of categoryRows) {
      rows.push({ entity: "category", entityId: row.id, rowVersion: row.rowVersion, row });
    }
    const productRows = yield* db
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), isNull(products.deletedAt)))
      .orderBy(asc(products.id));
    for (const row of productRows) {
      rows.push({ entity: "product", entityId: row.id, rowVersion: row.rowVersion, row });
    }
    const batchRows = yield* db
      .select()
      .from(batches)
      .where(and(eq(batches.organizationId, organizationId), isNull(batches.deletedAt)))
      .orderBy(asc(batches.id));
    for (const row of batchRows) {
      rows.push({ entity: "batch", entityId: row.id, rowVersion: row.rowVersion, row });
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

  it("rejects a batch update whose expected row version is stale", async () => {
    const organizationId = decodeOrganizationId("org-catalog-batch-version");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        const stale = yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-stale-batch", [batchWrite("batch-1", 9, "mv-stale", 7, 0)]),
          ),
        );
        const [batch] = yield* db
          .select()
          .from(batches)
          .where(and(eq(batches.organizationId, organizationId), eq(batches.id, BATCH_ID)))
          .limit(1);
        const pulled = yield* commands.pull(actor, pullFrom("0"));
        return { stale, batch, pulled };
      }),
    );
    expect(outcome.stale.decision).toBe("rejected");
    expect(outcome.stale.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(outcome.batch).toMatchObject({ packQuantity: 2, rowVersion: 1 });
    expect(outcome.pulled.transactions[1]?.changes).toHaveLength(0);
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

  it("blocks a units-per-pack change while the product still has stock", async () => {
    const organizationId = decodeOrganizationId("org-catalog-units-stock");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        return yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-units-stock", [productUpdate("prod-1", 1, "Panadol", 20)]),
          ),
        );
      }),
    );
    expect(outcome.result).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_CONFLICT",
      message: catalogWriteError.unitsPerPackWithStock,
    });
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

  it("rejects a product whose category does not exist", async () => {
    const organizationId = decodeOrganizationId("org-catalog-relation");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        return yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "1",
            catalogCommand("cmd-orphan", [productInsert("prod-1", "cat-missing", "Panadol")]),
          ),
        );
      }),
    );
    expect(outcome.result).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_RELATION_INVALID",
    });
  });

  it("blocks deleting a category that still has an active product", async () => {
    const organizationId = decodeOrganizationId("org-catalog-category-delete");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        return yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-delete-category", [
              {
                entity: "category",
                action: "delete",
                id: CATEGORY_ID,
                expectedRowVersion: 1,
              },
            ]),
          ),
        );
      }),
    );
    expect(outcome.result).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_CONFLICT",
      message: catalogWriteError.categoryHasProducts,
    });
  });

  it("blocks deleting a batch that still has stock", async () => {
    const organizationId = decodeOrganizationId("org-catalog-batch-delete");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        yield* commands.commit(actor, catalogEnvelope(organizationId, "1", seedCatalog()));
        return yield* commands.commit(
          actor,
          catalogEnvelope(
            organizationId,
            "2",
            catalogCommand("cmd-delete-batch", [
              { entity: "batch", action: "delete", id: BATCH_ID, expectedRowVersion: 1 },
            ]),
          ),
        );
      }),
    );
    expect(outcome.result).toMatchObject({
      _tag: "rejected",
      code: "ENTITY_CONFLICT",
      message: catalogWriteError.batchHasStock,
    });
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
    expect(outcome.remainingRows).toEqual([]);
    expect(outcome.digested.digest).toBe(rowImageDigest([]));
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

  it("returns the stored receipt on an identical catalog retry", async () => {
    const organizationId = decodeOrganizationId("org-catalog-retry");
    const actor = actorFor(organizationId);
    const envelopeOf = catalogEnvelope(organizationId, "1", seedCatalog());
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        const first = yield* commands.commit(actor, envelopeOf);
        const retry = yield* commands.commit(actor, envelopeOf);
        const pulled = yield* commands.pull(actor, pullFrom("0"));
        return { first, retry, pulled };
      }),
    );
    expect(outcome.retry).toEqual(outcome.first);
    expect(outcome.pulled.transactions).toHaveLength(1);
  });

  it("rejects a catalog command that skips a client sequence", async () => {
    const organizationId = decodeOrganizationId("org-catalog-gap");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCatalog(organizationId);
        const cause = yield* commands
          .commit(actor, catalogEnvelope(organizationId, "4", seedCatalog()))
          .pipe(Effect.flip);
        const stored = yield* commands.receipt(actor, "cmd-seed");
        return { cause, stored };
      }),
    );
    expect(isProtocol(outcome.cause) && outcome.cause.code).toBe("REPLICA_SEQUENCE_GAP");
    expect(outcome.stored).toBeUndefined();
  });

  it("bounds a pull page by the payload budget without splitting a group", async () => {
    const organizationId = decodeOrganizationId("org-catalog-budget");
    const actor = actorFor(organizationId);
    const filler = "x".repeat(600_000);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCatalog(organizationId, "2");
        for (const commitSequence of ["1", "2"]) {
          yield* db.insert(inventoryTransactions).values({
            organizationId,
            commitSequence,
            operationId: `bulk-${commitSequence}`,
            decision: "accepted",
            epoch: LAST_UNIT_EPOCH,
          });
          for (const ordinal of [0, 1]) {
            yield* db.insert(inventoryChanges).values({
              organizationId,
              commitSequence,
              ordinal,
              entity: "category",
              action: "upsert",
              entityId: `big-${commitSequence}-${ordinal}`,
              rowVersion: 1,
              rowJson: `{"id":"big-${commitSequence}-${ordinal}","filler":"${filler}"}`,
            });
          }
        }
        const first = yield* commands.pull(actor, pullFrom("0"));
        const second = yield* commands.pull(actor, pullFrom(first.nextCommitSequence));
        return { first, second };
      }),
    );
    expect(PULL_PAYLOAD_BUDGET_BYTES).toBeLessThan(2 * 1_200_000);
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
        const partial = yield* commands.pull(actor, { ...pullFrom("0", true), limit: 1 });
        const complete = yield* commands.pull(actor, pullFrom("0", true));
        const withoutDigest = yield* commands.pull(actor, pullFrom("0"));
        const rows = yield* activePartitionRows(db, organizationId);
        return { partial, complete, withoutDigest, rows };
      }),
    );
    expect(outcome.partial.digest).toBeUndefined();
    expect(outcome.withoutDigest.digest).toBeUndefined();
    expect(outcome.complete.digest).toBe(rowImageDigest(outcome.rows));
  });

  it("retries a transaction that Postgres aborts with a serialization failure", async () => {
    let attempts = 0;
    const committed = await run(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        return yield* runTransaction(db)("read committed", "read write", (tx) =>
          Effect.gen(function* () {
            attempts += 1;
            if (attempts < 3) {
              yield* tx.execute(
                sql.raw("DO $$ BEGIN RAISE EXCEPTION 'conflict' USING ERRCODE = '40001'; END $$"),
              );
            }
            return attempts;
          }),
        );
      }),
    );
    expect(committed).toBe(3);
  });

  it("retries a serialization failure and leaves other database errors alone", async () => {
    const sqlFailure = (reason: SqlError.SqlErrorReason) => new SqlError.SqlError({ reason });
    let serializationAttempts = 0;
    const flaky = Effect.suspend(() => {
      serializationAttempts += 1;
      if (serializationAttempts < 3) {
        return Effect.fail(
          sqlFailure(new SqlError.SerializationError({ cause: new Error("could not serialize") })),
        );
      }
      return Effect.succeed(serializationAttempts);
    });
    const recovered = await Effect.runPromise(withSerializationRetry(flaky));
    expect(recovered).toBe(3);

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
