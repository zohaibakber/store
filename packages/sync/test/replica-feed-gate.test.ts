import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import { batches } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { applyTransactionGroup } from "../src/replica/apply";
import { runReplicaTransaction } from "../src/replica/storage";
import { withSeededReplica } from "./lib/replica-fixture";

describe("replica stale group gate", () => {
  it("ignores a group at or below the applied commit sequence", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* applyTransactionGroup(tx, {
              commitSequence: OrgCommitSequence.make("5"),
              operationId: "operation-head",
              decision: "accepted",
              changes: [
                {
                  entity: "batch",
                  action: "upsert",
                  entityId: LAST_UNIT_BATCH_ID,
                  rowVersion: 5,
                  row: {
                    id: LAST_UNIT_BATCH_ID,
                    productId: LAST_UNIT_PRODUCT_ID,
                    batchNumber: "B-1",
                    expiresAt: null,
                    packQuantity: 0,
                    unitQuantity: 5,
                    createdAt: 1_700_000_000_000,
                    updatedAt: 1_700_000_000_005,
                    deletedAt: null,
                    organizationId: LAST_UNIT_ORGANIZATION_ID,
                    createdByUserId: "user-1",
                    updatedByUserId: "user-1",
                    deviceId: LAST_UNIT_REPLICA_A,
                    operationId: "operation-head",
                    rowVersion: 5,
                  },
                },
              ],
            });
            const applied = yield* applyTransactionGroup(tx, {
              commitSequence: OrgCommitSequence.make("3"),
              operationId: "operation-stale",
              decision: "accepted",
              changes: [
                {
                  entity: "batch",
                  action: "upsert",
                  entityId: LAST_UNIT_BATCH_ID,
                  rowVersion: 3,
                  row: {
                    id: LAST_UNIT_BATCH_ID,
                    productId: LAST_UNIT_PRODUCT_ID,
                    batchNumber: "B-1",
                    expiresAt: null,
                    packQuantity: 0,
                    unitQuantity: 3,
                    createdAt: 1_700_000_000_000,
                    updatedAt: 1_700_000_000_003,
                    deletedAt: null,
                    organizationId: LAST_UNIT_ORGANIZATION_ID,
                    createdByUserId: "user-1",
                    updatedByUserId: "user-1",
                    deviceId: LAST_UNIT_REPLICA_A,
                    operationId: "operation-stale",
                    rowVersion: 3,
                  },
                },
              ],
            });
            const row = yield* tx
              .select()
              .from(batches)
              .where(eq(batches.id, LAST_UNIT_BATCH_ID))
              .get();
            return { appliedThrough: applied.appliedThrough, unitQuantity: row?.unitQuantity };
          }),
        ),
      ),
    );
    expect(seen.appliedThrough).toBe("5");
    expect(seen.unitQuantity).toBe(5);
  });
});
