import { describe, expect, it } from "@effect/vitest";
import {
  ACTIVE_REPLICA_WINDOW_MILLIS,
  MAX_TRANSPORT_PAYLOAD_BYTES,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  ReplicaClientSequence,
  staleReplicaRejection,
  type CatalogRowWrite,
  type CatalogWriteCommand,
  type SyncCommandEnvelope,
  type SyncPullRequest,
  OperationId,
  Money,
  decodeBatchId,
  decodeCategoryId,
  decodeOrganizationId,
  decodeProductId,
  decodePurchaseOrderItemId,
  decodeSupplierId,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  authorityChanges,
  authorityState,
  authorityTransactions,
  replicas,
} from "@store/db/authority.schema";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
} from "../../../../packages/contracts/test/fixtures/last-unit-invoice";
import type { Actor } from "../../src/authority/engine";
import { OrganizationAuthority } from "../../src/inventory/organization-authority";
import { typedCommands } from "../inventory/typed-commands";
import { scenario, TestAuthorities } from "./harness";

const OCCURRED_AT = 1_700_000_000_000;
const PRODUCT_ID = decodeProductId("prod-1");

const actorFor = (organizationId: string): Actor => ({
  organizationId,
  userId: "user-1",
});

const pullFrom = (afterCommitSequence: string, withDigest = false): SyncPullRequest => {
  const request: SyncPullRequest = {
    epoch: LAST_UNIT_EPOCH,
    subscription: OPERATIONAL_SUBSCRIPTION,
    afterCommitSequence: OrgCommitSequence.make(afterCommitSequence),
  };
  if (withDigest === false) return request;
  return { ...request, digestVersion: PARTITION_DIGEST_VERSION };
};

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
) => {
  const command = { _tag: "catalogWrite" as const, payload };
  return Effect.map(canonicalPayloadHash(command), (payloadHash): SyncCommandEnvelope => ({
    organizationId,
    epoch: LAST_UNIT_EPOCH,
    replicaId: LAST_UNIT_REPLICA_A,
    clientSequence: ReplicaClientSequence.make(clientSequence),
    operationId: OperationId.make(payload.commandId),
    payloadHash,
    command,
  }));
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
  purchasePrice: Money.make(100),
  retailPrice: Money.make(200),
  unitPrice: Money.make(25),
  visible: true,
});

const productInsert = (id: string, categoryId: string, name: string): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(id),
  expectedRowVersion: null,
  row: productRow(categoryId, name, 10),
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

const openCatalog = (organizationId: string, commitSequence = 0) =>
  Effect.gen(function* () {
    const authorities = yield* TestAuthorities;
    const { db } = yield* authorities.open(organizationId);
    yield* db.insert(authorityState).values({
      id: 1,
      organizationId,
      incarnation: "incarnation-test",
      epoch: LAST_UNIT_EPOCH,
      commitSequence,
      retentionFloor: 0,
      createdAt: OCCURRED_AT,
    });
    yield* db.insert(replicas).values({
      replicaId: LAST_UNIT_REPLICA_A,
      ownerUserId: "user-1",
      deviceLabel: LAST_UNIT_REPLICA_A,
      lastClientSequence: 0,
      processedThroughClientSequence: 0,
      registeredAt: OCCURRED_AT,
      lastSeenAt: OCCURRED_AT,
    });
    const commands = typedCommands(yield* OrganizationAuthority);
    let clientSequence = 0;
    const write = (commandId: string, writes: ReadonlyArray<CatalogRowWrite>) =>
      Effect.suspend(() => {
        clientSequence += 1;
        return Effect.flatMap(
          catalogEnvelope(
            decodeOrganizationId(organizationId),
            String(clientSequence),
            catalogCommand(commandId, writes),
          ),
          (envelope) => commands.commit(actorFor(organizationId), envelope),
        );
      }).pipe(Effect.map((receipt) => receipt.result));
    return { authorities, commands, db, write };
  }).pipe(Effect.orDie);

const rejection = (rule: { readonly code: string; readonly message: string }) => ({
  _tag: "rejected",
  ...rule,
});

const ACCEPTED = { _tag: "catalogWrite" };

describe("durable object catalog writes", () => {
  it.effect(
    "holds supplier and order rows back while another device on the old schema was seen within 14 days",
    () =>
      Effect.gen(function* () {
        const organizationId = decodeOrganizationId("org-purchasing-gate");
        const actor = actorFor(organizationId);
        const { authorities, commands, db, write } = yield* openCatalog(organizationId);
        const { api } = authorities.of(organizationId);
        const now = yield* Clock.currentTimeMillis;
        const peer = eq(replicas.replicaId, LAST_UNIT_REPLICA_B);
        yield* db.insert(replicas).values({
          replicaId: LAST_UNIT_REPLICA_B,
          ownerUserId: "user-1",
          deviceLabel: "Till 2",
          lastClientSequence: 0,
          processedThroughClientSequence: 0,
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
        yield* api.liveHorizon(actor, LAST_UNIT_REPLICA_B);
        const reconnected = yield* write("cmd-reconnected", [
          supplierWrite("sup-3", null, "Initech"),
        ]);
        yield* db
          .update(replicas)
          .set({ ignoredAt: yield* Clock.currentTimeMillis })
          .where(peer);
        const ignored = yield* write("cmd-ignored", [supplierWrite("sup-4", null, "Umbrella")]);
        yield* db.update(replicas).set({ ignoredAt: null }).where(peer);
        const heeded = yield* write("cmd-heeded", [supplierWrite("sup-5", null, "Hooli")]);
        yield* db
          .update(replicas)
          .set({ removedAt: yield* Clock.currentTimeMillis })
          .where(peer);
        const removed = yield* write("cmd-removed", [supplierWrite("sup-5", null, "Hooli")]);
        yield* TestClock.adjust("5 millis");
        yield* api.liveHorizon(actor, LAST_UNIT_REPLICA_B);
        const returned = yield* write("cmd-returned", [supplierWrite("sup-6", null, "Stark")]);
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
        const outcome = {
          catalog,
          supplier,
          receipt,
          registeredBlocked,
          unnamed,
          abandoned,
          registeredAbandoned,
          reconnected,
          ignored,
          heeded,
          removed,
          returned,
          dormant,
          registeredClear,
          upgraded,
        };
        expect(outcome.catalog).toMatchObject(ACCEPTED);
        expect(outcome.supplier).toEqual(rejection(staleReplicaRejection("Till 2")));
        expect(outcome.receipt).toEqual(rejection(staleReplicaRejection("Till 2")));
        expect(outcome.registeredBlocked.lowestActiveSchemaVersion).toBe(1);
        expect(outcome.unnamed).toEqual(rejection(staleReplicaRejection(null)));
        expect(outcome.abandoned).toMatchObject(ACCEPTED);
        expect(outcome.registeredAbandoned.lowestActiveSchemaVersion).toBe(2);
        expect(outcome.reconnected).toEqual(rejection(staleReplicaRejection(null)));
        expect(outcome.ignored).toMatchObject(ACCEPTED);
        expect(outcome.heeded).toEqual(rejection(staleReplicaRejection(null)));
        expect(outcome.removed).toMatchObject(ACCEPTED);
        expect(outcome.returned).toEqual(rejection(staleReplicaRejection(null)));
        expect(outcome.dormant).toMatchObject(ACCEPTED);
        expect(outcome.registeredClear.lowestActiveSchemaVersion).toBe(2);
        expect(outcome.upgraded).toMatchObject(ACCEPTED);
      }).pipe(scenario),
  );

  it.effect("bounds a pull page by the payload budget without splitting a group", () =>
    Effect.gen(function* () {
      const organizationId = decodeOrganizationId("org-catalog-budget");
      const actor = actorFor(organizationId);
      const filler = "x".repeat(600_000);
      const { commands, db } = yield* openCatalog(organizationId, 2);
      for (const commitSequence of [1, 2]) {
        const changes = [0, 1].map((ordinal) => ({
          commitSequence,
          ordinal,
          entity: "category",
          action: "upsert" as const,
          entityId: `big-${commitSequence}-${ordinal}`,
          rowVersion: 1,
          rowJson: `{"id":"big-${commitSequence}-${ordinal}","filler":"${filler}"}`,
        }));
        yield* db.insert(authorityTransactions).values({
          commitSequence,
          operationId: `bulk-${commitSequence}`,
          decision: "accepted",
          epoch: LAST_UNIT_EPOCH,
          byteLength: changes.reduce((total, change) => total + change.rowJson.length, 128),
        });
        yield* db.insert(authorityChanges).values(changes);
      }
      const first = yield* commands.pull(actor, pullFrom("0"));
      const second = yield* commands.pull(actor, pullFrom(first.nextCommitSequence));
      const outcome = { first, second };
      expect(MAX_TRANSPORT_PAYLOAD_BYTES).toBeLessThan(2 * 1_200_000);
      expect(outcome.first.transactions).toHaveLength(1);
      expect(outcome.first.transactions[0]?.changes).toHaveLength(2);
      expect(outcome.first.nextCommitSequence).toBe("1");
      expect(outcome.second.transactions).toHaveLength(1);
      expect(outcome.second.nextCommitSequence).toBe("2");
    }).pipe(scenario),
  );
});
