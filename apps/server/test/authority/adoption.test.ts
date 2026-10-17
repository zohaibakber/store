import * as PgClient from "@effect/sql-pg/PgClient";
import { OPERATIONAL_SUBSCRIPTION, OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { authorityState, products as authorityProducts } from "@store/db/authority.schema";
import {
  batches,
  categories,
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  products,
  replicas,
} from "@store/db/postgres/schema";
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresAdoption, settleAdoption } from "../../src/authority/adopt";
import { makeInventoryCommands } from "../../src/inventory/commands";
import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { typedCommands } from "../inventory/typed-commands";
import { makeTestAuthorities } from "./harness";

const USER_ID = "user-1";
const OCCURRED_AT = 1_700_000_000_000;
const ORGANIZATION_ID = LAST_UNIT_ORGANIZATION_ID;
const actor = { organizationId: ORGANIZATION_ID, userId: USER_ID };

let database: AuthorityPostgres;

const seedPostgres = (ORGANIZATION_ID: string) =>
  Effect.gen(function* () {
    const db = yield* PgDrizzle.makeWithDefaults();
    const managed = {
      organizationId: ORGANIZATION_ID,
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
      createdByUserId: USER_ID,
      updatedByUserId: USER_ID,
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
    };
    yield* db.insert(inventoryState).values({
      organizationId: ORGANIZATION_ID,
      incarnation: "incarnation-postgres",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: "3",
      retentionFloor: "1",
    });
    yield* db.insert(categories).values({
      ...managed,
      id: "general",
      name: "General",
      tracksPacks: true,
      operationId: "seed-category",
    });
    const product = {
      ...managed,
      name: "Last unit",
      categoryId: "general",
      aisle: null,
      composition: null,
      strength: null,
      unitsPerPack: 1,
      purchasePrice: 50,
      retailPrice: 100,
      unitPrice: 100,
      visible: true,
    };
    yield* db.insert(products).values([
      { ...product, id: LAST_UNIT_PRODUCT_ID, deletedAt: null, operationId: "seed-product" },
      { ...product, id: "product-gone", deletedAt: OCCURRED_AT, operationId: "seed-gone" },
    ]);
    yield* db.insert(batches).values({
      ...managed,
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 5,
      deletedAt: null,
      operationId: "seed-batch",
    });
    yield* db.insert(replicas).values({
      organizationId: ORGANIZATION_ID,
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: USER_ID,
      deviceLabel: "Counter",
      lastClientSequence: "1",
      processedThroughClientSequence: "1",
      registeredAt: OCCURRED_AT,
      lastSeenAt: OCCURRED_AT,
      schemaVersion: 2,
    });
    for (const commitSequence of ["1", "2", "3"]) {
      yield* db.insert(inventoryTransactions).values({
        organizationId: ORGANIZATION_ID,
        commitSequence,
        operationId: `op-${commitSequence}`,
        decision: "accepted",
        epoch: LAST_UNIT_EPOCH,
        byteLength: 300,
      });
      yield* db.insert(inventoryChanges).values({
        organizationId: ORGANIZATION_ID,
        commitSequence,
        ordinal: 0,
        entity: "category",
        action: "upsert",
        entityId: "general",
        rowVersion: 1,
        rowJson: JSON.stringify({ id: "general", name: "General" }),
      });
    }
    yield* db.insert(commandReceipts).values({
      organizationId: ORGANIZATION_ID,
      operationId: lastUnitBuyerAEnvelope.operationId,
      replicaId: LAST_UNIT_REPLICA_A,
      clientSequence: "1",
      payloadHash: lastUnitBuyerAEnvelope.payloadHash,
      decision: "accepted",
      commitSequence: "3",
      resultJson: JSON.stringify({
        _tag: "issueInvoice",
        invoiceId: "invoice-a",
        invoiceNumber: 1,
      }),
      receivedAt: OCCURRED_AT,
      attempts: 1,
    });
    return db;
  });

describe("adopting an organization from Postgres", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("copies the catalog, history and receipts, keeps the epoch, and fences Postgres", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* seedPostgres(ORGANIZATION_ID);
        const authorities = makeTestAuthorities({ adoption: postgresAdoption(source) });
        const authority = yield* authorities.open(ORGANIZATION_ID);
        const commands = typedCommands(makeInventoryCommands(authorities));
        const pulled = yield* commands.pull(actor, {
          epoch: LAST_UNIT_EPOCH,
          subscription: OPERATIONAL_SUBSCRIPTION,
          afterCommitSequence: OrgCommitSequence.make("1"),
        });
        const replayed = yield* commands.receipt(actor, lastUnitBuyerAEnvelope.operationId);
        const state = yield* authority.db.select().from(authorityState).get();
        const adoptedProducts = yield* authority.db
          .select({ id: authorityProducts.id })
          .from(authorityProducts)
          .all();
        const [fenced] = yield* source
          .select({ epoch: inventoryState.epoch })
          .from(inventoryState)
          .where(eq(inventoryState.organizationId, ORGANIZATION_ID));
        return { pulled, replayed, state, adoptedProducts, fenced };
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url: Redacted.make(database.connectionString),
            maxConnections: 2,
            applicationName: "tabaaq-adoption-tests",
          }),
        ),
        Effect.scoped,
      ),
    );
    expect(outcome.state).toMatchObject({
      epoch: LAST_UNIT_EPOCH,
      incarnation: "incarnation-postgres",
      commitSequence: 3,
      retentionFloor: 1,
      adoptedFrom: "postgres",
    });
    expect(outcome.pulled.transactions.map((group) => group.commitSequence)).toEqual(["2", "3"]);
    expect(outcome.replayed).toMatchObject({ commitSequence: "3", decision: "accepted" });
    expect(outcome.adoptedProducts).toEqual([{ id: LAST_UNIT_PRODUCT_ID }]);
    expect(outcome.fenced?.epoch).not.toBe(LAST_UNIT_EPOCH);
  });

  it("finishes fencing Postgres when an earlier adoption copied but did not fence", async () => {
    const organizationId = "org-fence-retry";
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* seedPostgres(organizationId);
        const authorities = makeTestAuthorities({ adoption: postgresAdoption(source) });
        const first = yield* authorities.open(organizationId);
        yield* first.api.devices({ organizationId, userId: USER_ID });
        yield* source
          .update(inventoryState)
          .set({ epoch: LAST_UNIT_EPOCH })
          .where(eq(inventoryState.organizationId, organizationId));
        yield* first.db
          .update(authorityState)
          .set({ adoptedFrom: "postgres:fencing" })
          .where(eq(authorityState.id, 1));
        yield* settleAdoption(
          postgresAdoption(source),
          { organizationId, userId: USER_ID },
          first.sql,
          first.db,
        );
        const [after] = yield* source
          .select({ epoch: inventoryState.epoch })
          .from(inventoryState)
          .where(eq(inventoryState.organizationId, organizationId));
        const state = yield* first.db.select().from(authorityState).get();
        return { after, state };
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url: Redacted.make(database.connectionString),
            maxConnections: 2,
            applicationName: "tabaaq-adoption-fence-tests",
          }),
        ),
        Effect.scoped,
      ),
    );
    expect(outcome.after?.epoch).not.toBe(LAST_UNIT_EPOCH);
    expect(outcome.state?.adoptedFrom).toBe("postgres");
  });
});
