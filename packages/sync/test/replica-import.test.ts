import {
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, commandOutbox, replicaState, snapshotStagedRows } from "@store/db/replica.schema";
import { eq, inArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { commandStatus, saveLocalCommand, visibleBatchStock } from "../src/replica/commands";
import {
  activateSnapshotGeneration,
  beginSnapshotImport,
  importSnapshotPart,
} from "../src/replica/import";
import { runReplicaTransaction } from "../src/replica/storage";
import { withSeededReplica } from "./lib/replica-fixture";

const manifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-1"),
  epoch: LAST_UNIT_EPOCH,
  subscription: "operational",
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("3"),
  parts: [
    {
      partNumber: 1,
      objectKey: "parts/1",
      byteLength: 1,
      sha256: SnapshotPartHash.make("a".repeat(64)),
    },
  ],
  entityCounts: [{ entity: "batch", rowCount: 1 }],
};

const partPayload: SnapshotPartPayload = {
  snapshotId: manifest.snapshotId,
  partNumber: 1,
  rows: [
    {
      entity: "batch",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion: 3,
      row: {
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 8,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_003,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: "user-1",
        updatedByUserId: "user-1",
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "snapshot-batch",
        rowVersion: 3,
      },
    },
  ],
};

describe("replica snapshot import", () => {
  it("stages snapshot parts without writing live tables", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* beginSnapshotImport(tx, manifest);
            const first = yield* importSnapshotPart(tx, manifest, partPayload);
            const second = yield* importSnapshotPart(tx, manifest, partPayload);
            const staged = yield* tx
              .select()
              .from(snapshotStagedRows)
              .where(eq(snapshotStagedRows.snapshotId, manifest.snapshotId))
              .all();
            const batch = yield* tx
              .select()
              .from(batches)
              .where(eq(batches.id, LAST_UNIT_BATCH_ID))
              .get();
            return {
              first,
              second,
              staged: staged.length,
              unitQuantity: batch?.unitQuantity,
            };
          }),
        ),
      ),
    );
    expect(seen.first).toEqual({ _tag: "caught_up", throughCommitSequence: "3" });
    expect(seen.second).toEqual({ _tag: "caught_up", throughCommitSequence: "3" });
    expect(seen.staged).toBe(1);
    expect(seen.unitQuantity).toBe(10);
  });

  it("activates a snapshot generation while preserving pending commands", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            yield* beginSnapshotImport(tx, manifest);
            yield* importSnapshotPart(tx, manifest, partPayload);
            yield* activateSnapshotGeneration(tx, manifest.snapshotId);
            const outstanding = (yield* tx
              .select()
              .from(commandOutbox)
              .where(
                inArray(commandOutbox.status, [
                  "pending",
                  "sending",
                  "accepted_awaiting_integration",
                ]),
              )
              .all()).length;
            const status = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            const stock = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            const state = yield* tx.select().from(replicaState).get();
            const outbox = yield* tx
              .select()
              .from(commandOutbox)
              .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
              .get();
            const staged = yield* tx
              .select()
              .from(snapshotStagedRows)
              .where(eq(snapshotStagedRows.snapshotId, manifest.snapshotId))
              .all();
            return {
              outstanding,
              status,
              unitQuantity: stock?.unitQuantity,
              activeGeneration: state?.activeGeneration,
              appliedCommitSequence: state?.appliedCommitSequence,
              outbox: outbox !== undefined,
              staged: staged.length,
            };
          }),
        ),
      ),
    );
    expect(seen.outstanding).toBe(1);
    expect(seen.status).toBe("pending");
    expect(seen.unitQuantity).toBe(7);
    expect(seen.activeGeneration).toBe(2);
    expect(seen.appliedCommitSequence).toBe("3");
    expect(seen.outbox).toBe(true);
    expect(seen.staged).toBe(0);
  });
});
