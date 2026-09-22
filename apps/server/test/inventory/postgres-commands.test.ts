import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncProtocolError,
  type SyncCommandEnvelope,
  type SyncPullRequest,
} from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBEnvelope,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, categories, inventoryState, products, replicas } from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { InventoryDatabaseError } from "../../src/inventory/errors";
import type { InventoryActor } from "../../src/inventory/model";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

const isProtocol = Schema.is(SyncProtocolError);
const isDatabaseError = Schema.is(InventoryDatabaseError);

let database: AuthorityPostgres;

const layer = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-inventory-command-tests",
  });

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer()), Effect.scoped));

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const envelopeFor = (
  organizationId: ReturnType<typeof decodeOrganizationId>,
  envelope: SyncCommandEnvelope,
): SyncCommandEnvelope => ({
  ...envelope,
  organizationId,
});

const pullFromStart = {
  epoch: LAST_UNIT_EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
  afterCommitSequence: OrgCommitSequence.make("0"),
} satisfies SyncPullRequest;

const openCommands = (organizationId: string, unitQuantity = 1) =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
    const occurredAt = 1_700_000_000_000;
    const userId = "user-1";
    yield* db.insert(inventoryState).values({
      organizationId,
      status: "ready",
      importId: "import-test",
      releaseId: "release-test",
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: "0",
      retentionFloor: "0",
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-category",
      rowVersion: 1,
    });
    yield* db.insert(products).values({
      id: LAST_UNIT_PRODUCT_ID,
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
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-product",
      rowVersion: 1,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      operationId: "seed-batch",
      rowVersion: 1,
    });
    for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
      yield* db.insert(replicas).values({
        organizationId,
        replicaId,
        ownerUserId: userId,
        deviceLabel: replicaId,
        lastClientSequence: "0",
        processedThroughClientSequence: "0",
        registeredAt: occurredAt,
        lastSeenAt: occurredAt,
      });
    }
    return { commands: makeInventoryCommands(db), db };
  });

const batchStock = (
  db: Effect.Success<ReturnType<typeof openCommands>>["db"],
  organizationId: string,
) =>
  Effect.gen(function* () {
    const [batch] = yield* db
      .select({ unitQuantity: batches.unitQuantity, packQuantity: batches.packQuantity })
      .from(batches)
      .where(and(eq(batches.organizationId, organizationId), eq(batches.id, LAST_UNIT_BATCH_ID)))
      .limit(1);
    return batch;
  });

const query = (statement: string) =>
  run(
    Effect.gen(function* () {
      const client = yield* PgClient.PgClient;
      yield* client.unsafe(statement);
    }),
  );

describe("postgres inventory commands", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("accepts one concurrent last-unit sale and rejects the other", async () => {
    const organizationId = decodeOrganizationId("org-last-unit");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId);
        const [first, second] = yield* Effect.all(
          [
            commands.commit(actor, envelopeFor(organizationId, lastUnitBuyerAEnvelope)),
            commands.commit(actor, envelopeFor(organizationId, lastUnitBuyerBEnvelope)),
          ],
          { concurrency: 2 },
        );
        const pulled = yield* commands.pull(actor, pullFromStart);
        const stock = yield* batchStock(db, organizationId);
        return { first, second, pulled, stock };
      }),
    );
    const decisions = [outcome.first.decision, outcome.second.decision].slice().sort();
    expect(decisions).toEqual(["accepted", "rejected"]);
    const rejected = outcome.first.decision === "rejected" ? outcome.first : outcome.second;
    expect(rejected.result).toMatchObject({ _tag: "rejected", code: "INSUFFICIENT_STOCK" });
    expect(outcome.stock).toEqual({ unitQuantity: 0, packQuantity: 0 });
    expect(outcome.pulled.transactions).toHaveLength(2);
    expect(
      outcome.pulled.transactions.filter((transaction) =>
        transaction.changes.some((change) => change.entity === "invoice"),
      ),
    ).toHaveLength(1);
  });

  it("returns the stored receipt on an identical retry", async () => {
    const organizationId = decodeOrganizationId("org-retry");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const first = yield* commands.commit(actor, envelope);
        const retry = yield* commands.commit(actor, envelope);
        const pulled = yield* commands.pull(actor, pullFromStart);
        const stored = yield* commands.receipt(actor, envelope.operationId);
        return { first, retry, pulled, stored };
      }),
    );
    expect(outcome.retry).toEqual(outcome.first);
    expect(outcome.stored).toEqual(outcome.first);
    expect(outcome.pulled.transactions).toHaveLength(1);
    expect(outcome.pulled.nextCommitSequence).toBe(outcome.first.commitSequence);
  });

  it("rejects a reused operation id and leaves the original invoice in place", async () => {
    const organizationId = decodeOrganizationId("org-reused");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const otherCommand = {
      ...envelope.command,
      payload: { ...envelope.command.payload, invoiceNumber: 2 },
    };
    const mismatched = {
      ...envelope,
      command: otherCommand,
      payloadHash: canonicalPayloadHash(otherCommand),
    };
    const failure = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        yield* commands.commit(actor, envelope);
        const cause = yield* commands.commit(actor, mismatched).pipe(Effect.flip);
        const pulled = yield* commands.pull(actor, pullFromStart);
        return { cause, pulled };
      }),
    );
    expect(isProtocol(failure.cause) && failure.cause.code).toBe("OPERATION_ID_REUSED");
    expect(failure.pulled.transactions).toHaveLength(1);
  });

  it("rejects a client sequence gap without consuming stock", async () => {
    const organizationId = decodeOrganizationId("org-gap");
    const actor = actorFor(organizationId);
    const gapped = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: "3",
        command: lastUnitBuyerACommand,
      }),
    );
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId);
        const cause = yield* commands.commit(actor, gapped).pipe(Effect.flip);
        const stock = yield* batchStock(db, organizationId);
        const stored = yield* commands.receipt(actor, gapped.operationId);
        return { cause, stock, stored };
      }),
    );
    expect(isProtocol(outcome.cause) && outcome.cause.code).toBe("REPLICA_SEQUENCE_GAP");
    expect(outcome.stock).toEqual({ unitQuantity: 1, packQuantity: 0 });
    expect(outcome.stored).toBeUndefined();
  });

  it("rolls the invoice, stock, receipt, and log back together when a write fails", async () => {
    const organizationId = decodeOrganizationId("org-rollback");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    await query(`
      CREATE OR REPLACE FUNCTION store_test_fail_invoice() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced rollback';
      END;
      $$
    `);
    await query(`
      CREATE TRIGGER fail_after_invoice
      AFTER INSERT ON invoices
      FOR EACH ROW EXECUTE FUNCTION store_test_fail_invoice()
    `);
    try {
      const failed = await run(
        Effect.gen(function* () {
          const { commands, db } = yield* openCommands(organizationId);
          const cause = yield* commands.commit(actor, envelope).pipe(Effect.flip);
          const stock = yield* batchStock(db, organizationId);
          const pulled = yield* commands.pull(actor, pullFromStart);
          const stored = yield* commands.receipt(actor, envelope.operationId);
          return { cause, stock, pulled, stored };
        }),
      );
      expect(isDatabaseError(failed.cause)).toBe(true);
      expect(failed.stock).toEqual({ unitQuantity: 1, packQuantity: 0 });
      expect(failed.pulled.transactions).toHaveLength(0);
      expect(failed.stored).toBeUndefined();
    } finally {
      await query("DROP TRIGGER IF EXISTS fail_after_invoice ON invoices");
      await query("DROP FUNCTION IF EXISTS store_test_fail_invoice()");
    }

    const recovered = await run(
      Effect.gen(function* () {
        const client = yield* PgClient.PgClient;
        const db = yield* PgDrizzle.makeWithDefaults().pipe(
          Effect.provideService(PgClient.PgClient, client),
        );
        const commands = makeInventoryCommands(db);
        return yield* commands.commit(actor, envelope);
      }),
    );
    expect(recovered.decision).toBe("accepted");
    expect(recovered.result).toMatchObject({ _tag: "issueInvoice", invoiceNumber: 1 });
  });
});
