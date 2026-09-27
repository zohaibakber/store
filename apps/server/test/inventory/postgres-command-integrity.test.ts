import * as PgClient from "@effect/sql-pg/PgClient";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  SyncEpoch,
  type CatalogWriteCommand,
  type SyncCommandEnvelope,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeOrganizationId,
  decodeProductId,
} from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { batches, categories, inventoryState, stockMovements } from "@store/db/postgres/schema";
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";

let database: AuthorityPostgres;

const OCCURRED_AT = 1_700_000_000_000;
const EPOCH = SyncEpoch.make("1");
const REPLICA_ID = "integrity-replica";
const CATEGORY_ID = decodeCategoryId("integrity-category");
const PRODUCT_ID = decodeProductId("integrity-product");
const BATCH_ID = decodeBatchId("integrity-batch");

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({ url: Redacted.make(database.connectionString), maxConnections: 4 }),
      ),
      Effect.scoped,
    ),
  );

const envelope = (
  organizationId: ReturnType<typeof decodeOrganizationId>,
  sequence: string,
  commandId: string,
  writes: CatalogWriteCommand["writes"],
): SyncCommandEnvelope => {
  const command = {
    _tag: "catalogWrite" as const,
    payload: { commandId, deviceId: REPLICA_ID, occurredAt: OCCURRED_AT, writes },
  };
  return {
    organizationId,
    epoch: EPOCH,
    replicaId: REPLICA_ID,
    clientSequence: ReplicaClientSequence.make(sequence),
    operationId: commandId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
};

const categoryInsert = {
  entity: "category" as const,
  action: "upsert" as const,
  id: CATEGORY_ID,
  expectedRowVersion: null,
  row: { name: "Integrity", tracksPacks: true },
};

const productInsert = {
  entity: "product" as const,
  action: "upsert" as const,
  id: PRODUCT_ID,
  expectedRowVersion: null,
  row: {
    name: "Integrity product",
    categoryId: CATEGORY_ID,
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack: 10,
    purchasePrice: 10,
    retailPrice: 20,
    unitPrice: 2,
    visible: true,
  },
};

const batchWrite = (expectedRowVersion: number | null, packQuantity: number) => ({
  entity: "batch" as const,
  action: "upsert" as const,
  id: BATCH_ID,
  expectedRowVersion,
  movementId: "integrity-movement",
  note: null,
  row: { productId: PRODUCT_ID, batchNumber: null, expiresAt: null, packQuantity, unitQuantity: 0 },
});

const openRegistered = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* PgDrizzle.makeWithDefaults();
    const commands = makeInventoryCommands(db);
    const actor = { organizationId, userId: "integrity-user" };
    yield* commands.register(actor, { replicaId: REPLICA_ID });
    return { db, commands, actor };
  });

const pullAfter = (sequence: string) => ({
  epoch: EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
  afterCommitSequence: OrgCommitSequence.make(sequence),
});

describe("postgres command integrity", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("rolls back every write of a rejected multi-row command and still records the decision", async () => {
    const organizationId = decodeOrganizationId("integrity-partial");
    const result = await run(
      Effect.gen(function* () {
        const { db, commands, actor } = yield* openRegistered(organizationId);
        const rejected = yield* commands.commit(
          actor,
          envelope(organizationId, "1", "integrity-partial-command", [
            categoryInsert,
            categoryInsert,
          ]),
        );
        const afterRejection = yield* db
          .select()
          .from(categories)
          .where(eq(categories.organizationId, organizationId));
        const pull = yield* commands.pull(actor, pullAfter("0"));
        const retried = yield* commands.commit(
          actor,
          envelope(organizationId, "2", "integrity-partial-retry", [categoryInsert]),
        );
        const afterRetry = yield* db
          .select()
          .from(categories)
          .where(eq(categories.organizationId, organizationId));
        return { rejected, afterRejection, pull, retried, afterRetry };
      }),
    );
    expect(result.rejected.decision).toBe("rejected");
    expect(result.rejected.result).toMatchObject({ _tag: "rejected", code: "ENTITY_CONFLICT" });
    expect(result.afterRejection).toHaveLength(0);
    expect(result.pull.transactions).toHaveLength(1);
    expect(result.pull.transactions[0]?.decision).toBe("rejected");
    expect(result.pull.transactions[0]?.changes).toHaveLength(0);
    expect(result.retried.decision).toBe("accepted");
    expect(result.afterRetry).toHaveLength(1);
  });

  it("keeps the stored stock and movements when a stock update is rejected", async () => {
    const organizationId = decodeOrganizationId("integrity-stock");
    const result = await run(
      Effect.gen(function* () {
        const { db, commands, actor } = yield* openRegistered(organizationId);
        const seeded = yield* commands.commit(
          actor,
          envelope(organizationId, "1", "integrity-seed", [
            categoryInsert,
            productInsert,
            batchWrite(null, 2),
          ]),
        );
        const rejected = yield* commands.commit(
          actor,
          envelope(organizationId, "2", "integrity-adjust", [batchWrite(1, 99)]),
        );
        const stock = yield* db
          .select()
          .from(batches)
          .where(eq(batches.organizationId, organizationId));
        const movements = yield* db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.organizationId, organizationId));
        const pull = yield* commands.pull(actor, pullAfter("1"));
        return { seeded, rejected, stock, movements, pull };
      }),
    );
    expect(result.seeded.decision).toBe("accepted");
    expect(result.rejected.decision).toBe("rejected");
    expect(result.stock).toHaveLength(1);
    expect(result.stock[0]).toMatchObject({ packQuantity: 2, rowVersion: 1 });
    expect(result.movements).toHaveLength(1);
    expect(result.pull.transactions[0]?.changes).toHaveLength(0);
  });

  it("provisions a ready inventory state when an organization registers its first replica", async () => {
    const organizationId = decodeOrganizationId("integrity-fresh");
    const result = await run(
      Effect.gen(function* () {
        const { db, commands, actor } = yield* openRegistered(organizationId);
        const registration = yield* commands.register(actor, { replicaId: REPLICA_ID });
        const [state] = yield* db
          .select()
          .from(inventoryState)
          .where(eq(inventoryState.organizationId, organizationId));
        const committed = yield* commands.commit(
          actor,
          envelope(organizationId, "1", "integrity-first-write", [categoryInsert]),
        );
        return { registration, state, committed };
      }),
    );
    expect(result.registration).toMatchObject({
      epoch: "1",
      horizon: "0",
      retentionFloor: "0",
      nextClientSequence: "1",
    });
    expect(result.state).toMatchObject({
      status: "ready",
      epoch: "1",
      commitSequence: "0",
      retentionFloor: "0",
    });
    expect(result.state?.releaseId).not.toBeNull();
    expect(result.state?.incarnation).toBe(result.registration.incarnation);
    expect(result.committed.decision).toBe("accepted");
  });

  it("re-registers the same replica idempotently with its next client sequence", async () => {
    const organizationId = decodeOrganizationId("integrity-reregister");
    const result = await run(
      Effect.gen(function* () {
        const { commands, actor } = yield* openRegistered(organizationId);
        const first = yield* commands.register(actor, { replicaId: REPLICA_ID });
        yield* commands.commit(
          actor,
          envelope(organizationId, "1", "integrity-reregister-write", [categoryInsert]),
        );
        const second = yield* commands.register(actor, { replicaId: REPLICA_ID });
        return { first, second };
      }),
    );
    expect(result.first.nextClientSequence).toBe("1");
    expect(result.second).toMatchObject({
      replicaId: REPLICA_ID,
      epoch: result.first.epoch,
      incarnation: result.first.incarnation,
      nextClientSequence: "2",
      horizon: "1",
    });
  });

  it("provisions exactly one inventory state under concurrent first registrations", async () => {
    const organizationId = decodeOrganizationId("integrity-concurrent");
    const result = await run(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        const commands = makeInventoryCommands(db);
        const actor = { organizationId, userId: "integrity-user" };
        const registrations = yield* Effect.all(
          [
            commands.register(actor, { replicaId: "integrity-replica-a" }),
            commands.register(actor, { replicaId: "integrity-replica-b" }),
          ],
          { concurrency: "unbounded" },
        );
        const states = yield* db
          .select()
          .from(inventoryState)
          .where(eq(inventoryState.organizationId, organizationId));
        return { registrations, states };
      }),
    );
    expect(result.states).toHaveLength(1);
    expect(new Set(result.registrations.map((registration) => registration.incarnation))).toEqual(
      new Set([result.states[0]?.incarnation]),
    );
  });
});
