import { decodeProductId, SnapshotId } from "@store/contracts";
import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import {
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  products,
  snapshotJobs,
  snapshotStagedRows,
} from "@store/db/inventory.schema";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  recordUploadedPart,
  startSnapshotJob,
  stepSnapshotJob,
  type SnapshotFence,
  type SnapshotStep,
} from "../src/authority/snapshots";
import { openInventoryStore, seedLastUnitCatalog } from "../src/authority/store";
import { runSqliteTransaction } from "../src/sqlite";

const NOW = 1_700_000_000_000;
const SNAPSHOT = SnapshotId.make("snap-1");
const PRODUCT_TWO = decodeProductId("product-2");

const isAdvanced = (
  step: SnapshotStep,
): step is Extract<SnapshotStep, { readonly _tag: "advanced" }> => step._tag === "advanced";

const loadJob = (db: ReturnType<typeof openInventoryStore>["db"]) =>
  db
    .select()
    .from(snapshotJobs)
    .where(
      and(
        eq(snapshotJobs.organizationId, LAST_UNIT_ORGANIZATION_ID),
        eq(snapshotJobs.snapshotId, SNAPSHOT),
      ),
    )
    .get();

describe("authority snapshots", () => {
  it("resumes a copy from the persisted cursor after a partial page", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const started = runSqliteTransaction(store.db, (tx) =>
      startSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, SNAPSHOT, NOW),
    );
    if (!isAdvanced(started)) {
      throw new Error("start must advance");
    }
    expect(started).toMatchObject({
      _tag: "advanced",
      stage: "copying",
      fence: { snapshotId: "snap-1", value: 1 },
    });
    const first = runSqliteTransaction(store.db, (tx) =>
      stepSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, started.fence, NOW, 1),
    );
    expect(first).toMatchObject({
      _tag: "advanced",
      stage: "copying",
      fence: { snapshotId: "snap-1", value: 2 },
    });
    const job = loadJob(store.db);
    expect(job?.copyEntity).toBe("category");
    expect(job?.copyCursor).toBe("general");
    store.close();
  });

  it("rejects a late settlement that presents a stale fence", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const started = runSqliteTransaction(store.db, (tx) =>
      startSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, SNAPSHOT, NOW),
    );
    if (!isAdvanced(started)) {
      throw new Error("start must advance");
    }
    const stepped = runSqliteTransaction(store.db, (tx) =>
      stepSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, started.fence, NOW, 1),
    );
    expect(stepped._tag).toBe("advanced");
    const staleStep = runSqliteTransaction(store.db, (tx) =>
      stepSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, started.fence, NOW, 1),
    );
    expect(staleStep).toEqual({ _tag: "staleFence" });
    const stalePart = runSqliteTransaction(store.db, (tx) =>
      recordUploadedPart(
        tx,
        LAST_UNIT_ORGANIZATION_ID,
        started.fence,
        {
          snapshotId: SNAPSHOT,
          partNumber: 1,
          rows: [],
        },
        "orphan",
        0,
        "0000000000000000000000000000000000000000000000000000000000000000",
        NOW,
      ),
    );
    expect(stalePart).toEqual({ _tag: "staleFence" });
    store.close();
  });

  it("repairs a row deleted during copy and includes a row created during copy", () => {
    const store = openInventoryStore();
    seedLastUnitCatalog(store.db);
    const started = runSqliteTransaction(store.db, (tx) =>
      startSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, SNAPSHOT, NOW),
    );
    if (!isAdvanced(started)) {
      throw new Error("start must advance");
    }
    let fence: SnapshotFence = started.fence;
    for (let i = 0; i < 8; i += 1) {
      const job = loadJob(store.db);
      if (job?.copyEntity === "batch" && job.copyCursor === null) break;
      const step = runSqliteTransaction(store.db, (tx) =>
        stepSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, fence, NOW, 1),
      );
      if (!isAdvanced(step)) {
        throw new Error("copy must still be advancing");
      }
      fence = step.fence;
    }
    const beforeMutate = loadJob(store.db);
    expect(beforeMutate?.copyEntity).toBe("batch");
    expect(beforeMutate?.copyCursor).toBeNull();
    runSqliteTransaction(store.db, (tx) => {
      tx.update(inventoryState)
        .set({ commitSequence: "00000000000000000001" })
        .where(eq(inventoryState.organizationId, LAST_UNIT_ORGANIZATION_ID))
        .run();
      tx.insert(inventoryTransactions)
        .values({
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          commitSequence: "00000000000000000001",
          operationId: "mutate-during-copy",
          decision: "accepted",
          epoch: "1",
        })
        .run();
      tx.update(products)
        .set({ deletedAt: NOW, rowVersion: 2 })
        .where(
          and(
            eq(products.organizationId, LAST_UNIT_ORGANIZATION_ID),
            eq(products.id, LAST_UNIT_PRODUCT_ID),
          ),
        )
        .run();
      tx.insert(products)
        .values({
          id: PRODUCT_TWO,
          name: "Created during copy",
          categoryId: "general",
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 1,
          purchasePrice: 50,
          retailPrice: 100,
          unitPrice: 100,
          visible: true,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: "mutate-during-copy",
          rowVersion: 1,
        })
        .run();
      tx.insert(inventoryChanges)
        .values({
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          commitSequence: "00000000000000000001",
          ordinal: 0,
          entity: "product",
          action: "delete",
          entityId: LAST_UNIT_PRODUCT_ID,
          rowVersion: 2,
          rowJson: JSON.stringify({ id: LAST_UNIT_PRODUCT_ID }),
        })
        .run();
      tx.insert(inventoryChanges)
        .values({
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          commitSequence: "00000000000000000001",
          ordinal: 1,
          entity: "product",
          action: "upsert",
          entityId: PRODUCT_TWO,
          rowVersion: 1,
          rowJson: JSON.stringify({ id: PRODUCT_TWO, name: "Created during copy" }),
        })
        .run();
    });
    for (let i = 0; i < 12; i += 1) {
      const step = runSqliteTransaction(store.db, (tx) =>
        stepSnapshotJob(tx, LAST_UNIT_ORGANIZATION_ID, fence, NOW, 1),
      );
      if (step._tag === "upload" || step._tag === "settled") break;
      if (!isAdvanced(step)) {
        throw new Error("snapshot step left the copy/repair path");
      }
      fence = step.fence;
      if (step.stage === "frozen") break;
    }
    const staged = store.db
      .select()
      .from(snapshotStagedRows)
      .where(
        and(
          eq(snapshotStagedRows.organizationId, LAST_UNIT_ORGANIZATION_ID),
          eq(snapshotStagedRows.snapshotId, SNAPSHOT),
          eq(snapshotStagedRows.entity, "product"),
        ),
      )
      .all();
    expect(staged.map((row) => row.entityId).sort()).toEqual(["product-2"]);
    expect(staged[0]?.rowJson).toBe(
      JSON.stringify({ id: PRODUCT_TWO, name: "Created during copy" }),
    );
    store.close();
  });
});
