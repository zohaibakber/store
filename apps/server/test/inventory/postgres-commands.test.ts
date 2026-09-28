import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  CATALOG_PARTITION_DIGEST_VERSION,
  PARTITION_DIGEST_VERSION,
  SyncEpoch,
  SyncProtocolError,
  type SyncCommandEnvelope,
  type SyncPullRequest,
} from "@store/contracts";
import { decodeInvoiceId, decodeInvoiceItemId, decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerACommand,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBCommand,
  lastUnitBuyerBEnvelope,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  inventoryState,
  inventoryTransactions,
  products,
  replicas,
} from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { InventoryDatabaseError } from "../../src/inventory/errors";
import type { InventoryActor } from "../../src/inventory/model";
import { countStatements } from "../lib/statement-count";
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

  it("logs each draw on a batch shared by several allocations with the row it left behind", async () => {
    const organizationId = decodeOrganizationId("org-shared-batch");
    const actor = actorFor(organizationId);
    const take = (item: string, sale: string) => ({
      invoiceItemId: decodeInvoiceItemId(item),
      saleMovementId: sale,
      openPackMovementId: null,
      productId: LAST_UNIT_PRODUCT_ID,
      batchId: LAST_UNIT_BATCH_ID,
      quantity: 6,
      quantityType: "unit" as const,
      salePrice: 100,
      packsOpened: 1,
    });
    const envelope = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: "1",
        command: {
          ...lastUnitBuyerACommand,
          commandId: "sale-shared",
          invoiceId: decodeInvoiceId("sale-shared"),
          input: {
            customerName: null,
            items: [
              {
                productId: LAST_UNIT_PRODUCT_ID,
                batchId: LAST_UNIT_BATCH_ID,
                quantity: 12,
                quantityType: "unit",
                salePrice: 100,
              },
            ],
          },
          allocations: [
            take("item-shared-1", "move-shared-1"),
            take("item-shared-2", "move-shared-2"),
          ],
        },
      }),
    );
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId, 0);
        yield* db
          .update(products)
          .set({ unitsPerPack: 10 })
          .where(eq(products.organizationId, organizationId));
        yield* db
          .update(batches)
          .set({ packQuantity: 2, unitQuantity: 0 })
          .where(eq(batches.organizationId, organizationId));
        const receipt = yield* commands.commit(actor, envelope);
        const pulled = yield* commands.pull(actor, pullFromStart);
        const [stored] = yield* db
          .select()
          .from(batches)
          .where(
            and(eq(batches.organizationId, organizationId), eq(batches.id, LAST_UNIT_BATCH_ID)),
          );
        return { receipt, pulled, stored };
      }),
    );
    expect(outcome.receipt.decision).toBe("accepted");
    const changes = outcome.pulled.transactions[0]?.changes ?? [];
    expect(changes.map((change) => [change.entity, change.entityId])).toEqual([
      ["invoice", "sale-shared"],
      ["batch", LAST_UNIT_BATCH_ID],
      ["invoiceItem", "item-shared-1"],
      ["stockMovement", "move-shared-1:open-pack"],
      ["stockMovement", "move-shared-1"],
      ["batch", LAST_UNIT_BATCH_ID],
      ["invoiceItem", "item-shared-2"],
      ["stockMovement", "move-shared-2:open-pack"],
      ["stockMovement", "move-shared-2"],
    ]);
    expect(outcome.stored).toMatchObject({ packQuantity: 0, unitQuantity: 8, rowVersion: 2 });
    expect(JSON.stringify(changes[5]?.row)).toBe(JSON.stringify(outcome.stored));
    expect(JSON.stringify(changes[1]?.row)).toBe(
      JSON.stringify({ ...outcome.stored, packQuantity: 1, unitQuantity: 4 }),
    );
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
      _tag: "issueInvoice" as const,
      payload: { ...lastUnitBuyerACommand, invoiceNumber: 2 },
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

  it("records deterministic command failures as rejected receipts that consume the sequence", async () => {
    const organizationId = decodeOrganizationId("org-deterministic-rejections");
    const actor = actorFor(organizationId);
    const [allocation] = lastUnitBuyerACommand.allocations;
    if (allocation === undefined) throw new Error("The fixture has no allocation.");
    const invalidOperation = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: "1",
        command: {
          ...lastUnitBuyerACommand,
          commandId: "sale-invalid",
          invoiceId: decodeInvoiceId("sale-invalid"),
          allocations: [{ ...allocation, quantity: 2 }],
        },
      }),
    );
    const accepted = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: "2",
        command: lastUnitBuyerACommand,
      }),
    );
    const identityConflict = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_B,
        clientSequence: "1",
        command: {
          ...lastUnitBuyerBCommand,
          commandId: "sale-conflict",
          invoiceId: lastUnitBuyerACommand.invoiceId,
        },
      }),
    );
    const identityMismatch = {
      ...envelopeFor(
        organizationId,
        lastUnitEnvelope({
          replicaId: LAST_UNIT_REPLICA_B,
          clientSequence: "2",
          command: lastUnitBuyerBCommand,
        }),
      ),
      operationId: "sale-mismatch",
    };
    const outOfStock = envelopeFor(
      organizationId,
      lastUnitEnvelope({
        replicaId: LAST_UNIT_REPLICA_B,
        clientSequence: "3",
        command: {
          ...lastUnitBuyerBCommand,
          input: {
            ...lastUnitBuyerBCommand.input,
            items: lastUnitBuyerBCommand.input.items.map((item) => ({ ...item, quantity: 9 })),
          },
          allocations: lastUnitBuyerBCommand.allocations.map((take) => ({
            ...take,
            quantity: 9,
          })),
        },
      }),
    );
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId, 5);
        const receipts = [];
        for (const envelope of [
          invalidOperation,
          accepted,
          identityConflict,
          identityMismatch,
          outOfStock,
        ]) {
          receipts.push(yield* commands.commit(actor, envelope));
        }
        const retried = yield* commands.commit(actor, identityMismatch);
        const stock = yield* batchStock(db, organizationId);
        const sequences = yield* db
          .select({ replicaId: replicas.replicaId, last: replicas.lastClientSequence })
          .from(replicas)
          .where(eq(replicas.organizationId, organizationId));
        const pulled = yield* commands.pull(actor, pullFromStart);
        return { receipts, retried, stock, sequences, pulled };
      }),
    );
    expect(outcome.receipts.map((receipt) => [receipt.decision, receipt.result._tag])).toEqual([
      ["rejected", "rejected"],
      ["accepted", "issueInvoice"],
      ["rejected", "rejected"],
      ["rejected", "rejected"],
      ["rejected", "rejected"],
    ]);
    expect(
      outcome.receipts.map((receipt) =>
        receipt.result._tag === "rejected" ? receipt.result.code : undefined,
      ),
    ).toEqual([
      "INVALID_OPERATION",
      undefined,
      "INVOICE_IDENTITY_CONFLICT",
      "COMMAND_IDENTITY_MISMATCH",
      "INSUFFICIENT_STOCK",
    ]);
    expect(outcome.retried).toEqual(outcome.receipts[3]);
    expect(outcome.stock).toEqual({ unitQuantity: 4, packQuantity: 0 });
    expect(Object.fromEntries(outcome.sequences.map((row) => [row.replicaId, row.last]))).toEqual({
      [LAST_UNIT_REPLICA_A]: "2",
      [LAST_UNIT_REPLICA_B]: "3",
    });
    expect(outcome.pulled.transactions.map((transaction) => transaction.decision)).toEqual([
      "rejected",
      "accepted",
      "rejected",
      "rejected",
      "rejected",
    ]);
  });

  it("rejects commands that collide with stored identities or overflow a column instead of failing the request", async () => {
    const organizationId = decodeOrganizationId("org-poison-commands");
    const actor = actorFor(organizationId);
    const [take] = lastUnitBuyerBCommand.allocations;
    const [line] = lastUnitBuyerBCommand.input.items;
    if (take === undefined || line === undefined) throw new Error("The fixture has no allocation.");
    const [first] = lastUnitBuyerACommand.allocations;
    if (first === undefined) throw new Error("The fixture has no allocation.");
    const saleOnB = (
      clientSequence: string,
      commandId: string,
      allocation: typeof take,
      salePrice = line.salePrice,
      invoiceNumber = lastUnitBuyerBCommand.invoiceNumber,
    ) =>
      envelopeFor(
        organizationId,
        lastUnitEnvelope({
          replicaId: LAST_UNIT_REPLICA_B,
          clientSequence,
          command: {
            ...lastUnitBuyerBCommand,
            commandId,
            invoiceId: decodeInvoiceId(commandId),
            invoiceNumber,
            input: { ...lastUnitBuyerBCommand.input, items: [{ ...line, salePrice }] },
            allocations: [{ ...allocation, salePrice }],
          },
        }),
      );
    const poisoned = [
      saleOnB("1", "sale-reused-item", { ...take, invoiceItemId: first.invoiceItemId }),
      saleOnB("2", "sale-reused-movement", { ...take, saleMovementId: first.saleMovementId }),
      saleOnB("3", "sale-overflow", take, 3_000_000_000),
      saleOnB("4", "sale-number-overflow", take, line.salePrice, 3_000_000_000),
    ];
    const malformed = saleOnB("5", "sale-fraction", take, 0.5);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId, 5);
        const accepted = yield* commands.commit(
          actor,
          envelopeFor(organizationId, lastUnitBuyerAEnvelope),
        );
        const receipts = [];
        for (const envelope of poisoned) receipts.push(yield* commands.commit(actor, envelope));
        const retried = yield* commands.commit(actor, poisoned[0]!);
        const refused = yield* commands
          .submitRaw(actor, JSON.stringify(malformed))
          .pipe(Effect.flip);
        const stock = yield* batchStock(db, organizationId);
        const [replica] = yield* db
          .select({ last: replicas.lastClientSequence })
          .from(replicas)
          .where(
            and(
              eq(replicas.organizationId, organizationId),
              eq(replicas.replicaId, LAST_UNIT_REPLICA_B),
            ),
          );
        return { accepted, receipts, retried, refused, stock, last: replica?.last };
      }),
    );
    expect(outcome.accepted.decision).toBe("accepted");
    expect(
      outcome.receipts.map((receipt) => [
        receipt.decision,
        receipt.result._tag === "rejected" ? receipt.result.code : receipt.result._tag,
      ]),
    ).toEqual([
      ["rejected", "ENTITY_CONFLICT"],
      ["rejected", "ENTITY_CONFLICT"],
      ["rejected", "INVALID_OPERATION"],
      ["rejected", "INVALID_OPERATION"],
    ]);
    expect(outcome.retried).toEqual(outcome.receipts[0]);
    expect(outcome.refused._tag).toBe("SyncRequestMalformed");
    expect(outcome.stock).toEqual({ unitQuantity: 4, packQuantity: 0 });
    expect(outcome.last).toBe("4");
  });

  it("keeps identity and ownership failures as request errors that leave the sequence", async () => {
    const organizationId = decodeOrganizationId("org-request-failures");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const epoch = yield* commands
          .commit(actor, { ...envelope, epoch: SyncEpoch.make("2") })
          .pipe(Effect.flip);
        const unknown = yield* commands
          .commit(actor, { ...envelope, replicaId: "replica-unknown" })
          .pipe(Effect.flip);
        const foreign = yield* commands
          .commit({ ...actor, userId: "user-2" }, envelope)
          .pipe(Effect.flip);
        const receipt = yield* commands.commit(actor, envelope);
        return { codes: [epoch, unknown, foreign], receipt };
      }),
    );
    expect(outcome.codes.map((cause) => isProtocol(cause) && cause.code)).toEqual([
      "EPOCH_MISMATCH",
      "REPLICA_UNKNOWN",
      "REPLICA_OWNED_BY_OTHER",
    ]);
    expect(outcome.receipt).toMatchObject({ decision: "accepted", clientSequence: "1" });
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

  it("answers a caught-up submit with its own group as the next pull page", async () => {
    const organizationId = decodeOrganizationId("org-submit-caught-up");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const submitted = yield* commands.submit(actor, {
          ...envelope,
          afterCommitSequence: OrgCommitSequence.make("0"),
        });
        const pulled = yield* commands.pull(actor, pullFromStart);
        return { submitted, pulled };
      }),
    );
    const { page, ...receipt } = outcome.submitted;
    expect(receipt).toMatchObject({ decision: "accepted", commitSequence: "1" });
    expect(page).toEqual(outcome.pulled);
    expect(page).toMatchObject({ nextCommitSequence: "1", horizon: "1", retentionFloor: "0" });
    expect(page?.transactions[0]?.changes.length).toBeGreaterThan(0);
  });

  it("reads the page after the commit for a client that is behind or retrying", async () => {
    const organizationId = decodeOrganizationId("org-submit-behind");
    const actor = actorFor(organizationId);
    const first = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const second = envelopeFor(organizationId, lastUnitBuyerBEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        yield* commands.commit(actor, first);
        const behind = yield* commands.submit(actor, {
          ...second,
          afterCommitSequence: OrgCommitSequence.make("0"),
        });
        const retried = yield* commands.submit(actor, {
          ...second,
          afterCommitSequence: OrgCommitSequence.make("1"),
        });
        const pulled = yield* commands.pull(actor, pullFromStart);
        return { behind, retried, pulled };
      }),
    );
    expect(outcome.behind.decision).toBe("rejected");
    expect(outcome.behind.page).toEqual(outcome.pulled);
    expect(outcome.behind.page?.transactions.map((group) => group.commitSequence)).toEqual([
      "1",
      "2",
    ]);
    expect(outcome.retried.commitSequence).toBe(outcome.behind.commitSequence);
    expect(outcome.retried.page?.transactions.map((group) => group.commitSequence)).toEqual(["2"]);
  });

  it("omits the page for old clients and for cursors the log cannot serve", async () => {
    const organizationId = decodeOrganizationId("org-submit-no-page");
    const actor = actorFor(organizationId);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const legacy = yield* commands.submit(
          actor,
          envelopeFor(organizationId, lastUnitBuyerAEnvelope),
        );
        const ahead = yield* commands.submit(actor, {
          ...envelopeFor(organizationId, lastUnitBuyerBEnvelope),
          afterCommitSequence: OrgCommitSequence.make("9"),
        });
        return { legacy, ahead };
      }),
    );
    expect(outcome.legacy.decision).toBe("accepted");
    expect("page" in outcome.legacy).toBe(false);
    expect(outcome.ahead.decision).toBe("rejected");
    expect("page" in outcome.ahead).toBe(false);
  });

  it("clamps a client pull byte budget to the server bounds", async () => {
    const organizationId = decodeOrganizationId("org-pull-max-bytes");
    const actor = actorFor(organizationId);
    const [allocation] = lastUnitBuyerACommand.allocations;
    if (allocation === undefined) throw new Error("The fixture has no allocation.");
    const rejectedAt = (clientSequence: string) =>
      envelopeFor(
        organizationId,
        lastUnitEnvelope({
          replicaId: LAST_UNIT_REPLICA_A,
          clientSequence,
          command: {
            ...lastUnitBuyerACommand,
            commandId: `sale-invalid-${clientSequence}`,
            invoiceId: decodeInvoiceId(`sale-invalid-${clientSequence}`),
            allocations: [{ ...allocation, quantity: 2 }],
          },
        }),
      );
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId);
        for (const clientSequence of ["1", "2", "3"]) {
          yield* commands.commit(actor, rejectedAt(clientSequence));
        }
        yield* db
          .update(inventoryTransactions)
          .set({ byteLength: 40_000 })
          .where(eq(inventoryTransactions.organizationId, organizationId));
        const groupsFor = (maxBytes: number | undefined) =>
          commands
            .pull(actor, maxBytes === undefined ? pullFromStart : { ...pullFromStart, maxBytes })
            .pipe(Effect.map((page) => page.transactions.length));
        return {
          floor: yield* groupsFor(1),
          custom: yield* groupsFor(100_000),
          ceiling: yield* groupsFor(50_000_000),
          omitted: yield* groupsFor(undefined),
        };
      }),
    );
    expect(outcome).toEqual({ floor: 1, custom: 2, ceiling: 3, omitted: 3 });
  });

  it("publishes a fan-out group for every commit that consumes a sequence and none for replays", async () => {
    const organizationId = decodeOrganizationId("org-submit-fanout");
    const actor = actorFor(organizationId);
    const first = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const second = envelopeFor(organizationId, lastUnitBuyerBEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands, db } = yield* openCommands(organizationId);
        const accepted = yield* commands.submitEncoded(actor, first);
        const rejected = yield* commands.submitEncoded(actor, second);
        const replayed = yield* commands.submitEncoded(actor, first);
        const pulled = yield* commands.pullEncoded(actor, pullFromStart);
        const headers = yield* db
          .select({ byteLength: inventoryTransactions.byteLength })
          .from(inventoryTransactions)
          .where(eq(inventoryTransactions.organizationId, organizationId))
          .orderBy(inventoryTransactions.commitSequence);
        return { accepted, rejected, replayed, pulled, headers };
      }),
    );
    const page = JSON.parse(outcome.pulled.json);
    expect(outcome.accepted.fanout).toMatchObject({ epoch: LAST_UNIT_EPOCH, horizon: "1" });
    expect(outcome.rejected.fanout).toMatchObject({ epoch: LAST_UNIT_EPOCH, horizon: "2" });
    expect(outcome.replayed.fanout).toBeNull();
    expect(outcome.replayed.body).toBe(outcome.accepted.body);
    expect(JSON.parse(outcome.accepted.fanout?.group ?? "null")).toEqual(page.transactions[0]);
    expect(JSON.parse(outcome.rejected.fanout?.group ?? "null")).toEqual(page.transactions[1]);
    expect(page.transactions[1]).toMatchObject({ decision: "rejected", changes: [] });
    expect(outcome.accepted.fanout?.byteLength).toBe(outcome.headers[0]?.byteLength);
    expect(outcome.rejected.fanout?.byteLength).toBe(outcome.headers[1]?.byteLength);
  });

  it("answers submit, pull and replica registration with one statement each", async () => {
    const organizationId = decodeOrganizationId("org-statement-count");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const counted = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const register = yield* countStatements(
          commands.register(actor, { replicaId: "replica-counted", deviceLabel: "Counter" }),
        );
        const caughtUp = yield* countStatements(
          commands.submitEncoded(actor, {
            ...envelope,
            afterCommitSequence: OrgCommitSequence.make("0"),
          }),
        );
        const behind = yield* countStatements(
          commands.submitEncoded(actor, {
            ...envelopeFor(organizationId, lastUnitBuyerBEnvelope),
            afterCommitSequence: OrgCommitSequence.make("0"),
          }),
        );
        const replayed = yield* countStatements(
          commands.submitEncoded(actor, {
            ...envelope,
            afterCommitSequence: OrgCommitSequence.make("0"),
          }),
        );
        const pulled = yield* countStatements(commands.pullEncoded(actor, pullFromStart));
        const digested = yield* countStatements(
          commands.pullEncoded(actor, {
            ...pullFromStart,
            digestVersion: PARTITION_DIGEST_VERSION,
          }),
        );
        const digestedCatalog = yield* countStatements(
          commands.pullEncoded(actor, {
            ...pullFromStart,
            digestVersion: CATALOG_PARTITION_DIGEST_VERSION,
          }),
        );
        return { register, caughtUp, behind, replayed, pulled, digested, digestedCatalog };
      }),
    );
    for (const [name, count] of Object.entries(counted)) {
      expect({ name, roundTrips: count.roundTrips, transactions: count.transactions }).toEqual({
        name,
        roundTrips: 1,
        transactions: 0,
      });
    }
    expect(JSON.parse(counted.digested.result.json).digest).toMatchObject({ version: 3 });
    expect(JSON.parse(counted.digestedCatalog.result.json).digest).toMatchObject({ version: 2 });
    expect(JSON.parse(counted.caughtUp.result.body).page.transactions).toHaveLength(1);
    expect(JSON.parse(counted.behind.result.body).page.transactions).toHaveLength(2);
    expect(JSON.parse(counted.replayed.result.body).page.transactions).toHaveLength(2);
  });
});
