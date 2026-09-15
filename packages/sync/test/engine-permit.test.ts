import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, products, replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeSyncEngine } from "../src/engine";
import { commandStatus, saveLocalCommand } from "../src/replica/commands";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import type { SyncTransport } from "../src/transport";

describe("sync engine permit", () => {
  it("releases the replica permit before the HTTP submit", async () => {
    const store = openReplicaStore();
    runReplicaTransaction(store.db, (tx) => {
      tx.insert(replicaState)
        .values({
          id: "singleton",
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
          epoch: LAST_UNIT_EPOCH,
          appliedCommitSequence: "0",
          nextClientSequence: "1",
          localCommitVersion: 0,
        })
        .run();
      tx.insert(products)
        .values({
          id: LAST_UNIT_PRODUCT_ID,
          name: "Ten pack",
          categoryId: "general",
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 1,
          purchasePrice: null,
          retailPrice: null,
          unitPrice: null,
          visible: true,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "seed",
          rowVersion: 1,
        })
        .run();
      tx.insert(batches)
        .values({
          id: LAST_UNIT_BATCH_ID,
          productId: LAST_UNIT_PRODUCT_ID,
          batchNumber: "B-1",
          expiresAt: null,
          packQuantity: 0,
          unitQuantity: 10,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "seed",
          rowVersion: 1,
        })
        .run();
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
    });

    let held = 0;
    let heldDuringHttp = true;
    const mutex = {
      withPermits:
        (permits: number) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              held += permits;
            }),
            () => effect,
            () =>
              Effect.sync(() => {
                held -= permits;
              }),
          ),
    };
    const transport: SyncTransport = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () => Effect.die("unused"),
      submitCommand: () =>
        Effect.sync(() => {
          heldDuringHttp = held > 0;
          return {
            operationId: lastUnitBuyerAEnvelope.operationId,
            replicaId: LAST_UNIT_REPLICA_A,
            clientSequence: lastUnitBuyerAEnvelope.clientSequence,
            payloadHash: lastUnitBuyerAEnvelope.payloadHash,
            decision: "accepted" as const,
            commitSequence: OrgCommitSequence.make("1"),
            result: {
              _tag: "issueInvoice" as const,
              invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
              invoiceNumber: 1,
            },
          };
        }),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* makeSyncEngine(store.db, mutex, transport);
        yield* engine.uploadOnce();
      }),
    );
    expect(heldDuringHttp).toBe(false);
    runReplicaTransaction(store.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe(
        "accepted_awaiting_integration",
      );
    });
    store.close();
  });
});
