import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { replicas, snapshotJobs } from "@store/db/inventory.schema";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { grantDownloadLease, stepRetention } from "../src/authority/retention";
import {
  loadReceiptAttempts,
  openInventoryStore,
  runCommit,
  seedLastUnitCatalog,
} from "../src/authority/store";
import { runSqliteTransaction } from "../src/sqlite";

const NOW = 1_700_000_000_000;

describe("authority retention", () => {
  it("refuses to advance the floor past a download lease pin", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    runSqliteTransaction(store.db, (tx) => {
      tx.insert(snapshotJobs)
        .values({
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          snapshotId: "snap-published",
          subscription: "operational",
          stage: "published",
          fence: 4,
          startedAtCommitSequence: "00000000000000000002",
          horizon: "00000000000000000002",
          copyEntity: null,
          copyCursor: null,
          stepDueAt: NOW,
        })
        .run();
      grantDownloadLease(
        tx,
        LAST_UNIT_ORGANIZATION_ID,
        LAST_UNIT_REPLICA_A,
        "snap-published",
        "1",
        NOW + 60_000,
      );
    });
    const progress = runSqliteTransaction(store.db, (tx) =>
      stepRetention(tx, LAST_UNIT_ORGANIZATION_ID, NOW),
    );
    expect(progress).toEqual({
      floor: "1",
      deletedTransactions: 0,
      compactedReceipts: 0,
    });
    const job = store.db
      .select()
      .from(snapshotJobs)
      .where(eq(snapshotJobs.snapshotId, "snap-published"))
      .get();
    expect(job?.horizon).toBe("00000000000000000002");
    store.close();
  });

  it("deletes receipts at or below a replica processed watermark", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    runCommit(store.db, lastUnitBuyerAEnvelope);
    expect(loadReceiptAttempts(store.db, lastUnitBuyerAEnvelope.operationId)?.attempts).toBe(1);
    runSqliteTransaction(store.db, (tx) => {
      tx.update(replicas)
        .set({ processedThroughClientSequence: "00000000000000000001" })
        .where(
          and(
            eq(replicas.organizationId, LAST_UNIT_ORGANIZATION_ID),
            eq(replicas.replicaId, LAST_UNIT_REPLICA_A),
          ),
        )
        .run();
    });
    const progress = runSqliteTransaction(store.db, (tx) =>
      stepRetention(tx, LAST_UNIT_ORGANIZATION_ID, NOW),
    );
    expect(progress.compactedReceipts).toBe(1);
    expect(loadReceiptAttempts(store.db, lastUnitBuyerAEnvelope.operationId)).toBeUndefined();
    store.close();
  });
});
