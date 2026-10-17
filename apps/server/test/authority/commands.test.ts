import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  type SyncCommandEnvelope,
  type SyncPullRequest,
} from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBEnvelope,
} from "@store/contracts/sync/fixtures";
import {
  authorityState,
  authorityTransactions,
  batches,
  categories,
  products,
  replicas,
} from "@store/db/authority.schema";
import type { ReplicaDb } from "@store/sync/authority";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import { typedCommands } from "../inventory/typed-commands";
import { makeTestAuthorities } from "./harness";

const run = <A, E>(effect: Effect.Effect<A, E, import("effect/Scope").Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

const actorFor = (organizationId: string): InventoryActor => ({
  organizationId,
  userId: "user-1",
});

const envelopeFor = (
  organizationId: ReturnType<typeof decodeOrganizationId>,
  envelope: SyncCommandEnvelope,
): SyncCommandEnvelope => ({ ...envelope, organizationId });

const pullFromStart = {
  epoch: LAST_UNIT_EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
  afterCommitSequence: OrgCommitSequence.make("0"),
} satisfies SyncPullRequest;

export const seedLastUnit = (db: ReplicaDb, organizationId: string, unitQuantity = 1) =>
  Effect.gen(function* () {
    const occurredAt = 1_700_000_000_000;
    const userId = "user-1";
    const stamp = {
      createdAt: occurredAt,
      updatedAt: occurredAt,
      organizationId,
      createdByUserId: userId,
      updatedByUserId: userId,
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
    };
    yield* db.insert(authorityState).values({
      id: 1,
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: 0,
      retentionFloor: 0,
      createdAt: occurredAt,
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      operationId: "seed-category",
      ...stamp,
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
      operationId: "seed-product",
      ...stamp,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity,
      operationId: "seed-batch",
      ...stamp,
    });
    for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
      yield* db.insert(replicas).values({
        replicaId,
        ownerUserId: userId,
        deviceLabel: replicaId,
        lastClientSequence: 0,
        processedThroughClientSequence: 0,
        registeredAt: occurredAt,
        lastSeenAt: occurredAt,
      });
    }
  });

const openCommands = (organizationId: string, unitQuantity = 1) =>
  Effect.gen(function* () {
    const authorities = makeTestAuthorities();
    const { db } = yield* authorities.open(organizationId);
    yield* seedLastUnit(db, organizationId, unitQuantity).pipe(Effect.orDie);
    return { commands: typedCommands(makeInventoryCommands(authorities)), db };
  });

const batchStock = (db: ReplicaDb) =>
  db
    .select({ unitQuantity: batches.unitQuantity, packQuantity: batches.packQuantity })
    .from(batches)
    .where(eq(batches.id, LAST_UNIT_BATCH_ID))
    .get();

describe("durable object inventory commands", () => {
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
        const stock = yield* batchStock(db);
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

  it("answers a replayed command with its receipt and refuses a reused id", async () => {
    const organizationId = decodeOrganizationId("org-replay");
    const actor = actorFor(organizationId);
    const envelope = envelopeFor(organizationId, lastUnitBuyerAEnvelope);
    const outcome = await run(
      Effect.gen(function* () {
        const { commands } = yield* openCommands(organizationId);
        const first = yield* commands.commit(actor, envelope);
        const replayed = yield* commands.commit(actor, envelope);
        const reused = yield* commands
          .commit(actor, {
            ...envelope,
            payloadHash: "0".repeat(64),
          })
          .pipe(Effect.flip);
        const gap = yield* commands
          .commit(actor, {
            ...envelopeFor(organizationId, lastUnitBuyerBEnvelope),
            clientSequence: ReplicaClientSequence.make("5"),
          })
          .pipe(Effect.flip);
        const receipt = yield* commands.receipt(actor, envelope.operationId);
        return { first, replayed, reused, gap, receipt };
      }),
    );
    expect(outcome.replayed).toEqual(outcome.first);
    expect(outcome.receipt).toEqual(outcome.first);
    expect(outcome.reused).toMatchObject({ code: "INVALID_PAYLOAD_HASH" });
    expect(outcome.gap).toMatchObject({ code: "REPLICA_SEQUENCE_GAP" });
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
          .select({ byteLength: authorityTransactions.byteLength })
          .from(authorityTransactions)
          .orderBy(authorityTransactions.commitSequence)
          .all();
        return { accepted, rejected, replayed, pulled, headers };
      }),
    );
    const page = JSON.parse(outcome.pulled.json);
    expect(outcome.accepted.fanout).toMatchObject({ epoch: LAST_UNIT_EPOCH, horizon: "1" });
    expect(outcome.rejected.fanout).toMatchObject({ epoch: LAST_UNIT_EPOCH, horizon: "2" });
    expect(outcome.replayed.fanout).toBeNull();
    expect(JSON.parse(outcome.replayed.json)).toMatchObject({
      operationId: first.operationId,
      commitSequence: "1",
    });
    expect(JSON.parse(outcome.accepted.fanout?.group ?? "null")).toEqual(page.transactions[0]);
    expect(JSON.parse(outcome.rejected.fanout?.group ?? "null")).toEqual(page.transactions[1]);
    expect(page.transactions[1]).toMatchObject({ decision: "rejected", changes: [] });
    expect(outcome.accepted.fanout?.byteLength).toBe(outcome.headers[0]?.byteLength);
    expect(outcome.rejected.fanout?.byteLength).toBe(outcome.headers[1]?.byteLength);
  });
});
