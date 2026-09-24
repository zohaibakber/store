import {
  rowImageDigest,
  subscriptionEntities,
  type PartitionDigest,
  type SnapshotRow,
  type SyncSubscription,
} from "@store/contracts";
import * as Effect from "effect/Effect";

import { readPartitionRows } from "./partition";
import type { InventoryTransaction } from "./postgres";

export const partitionDigestFromPostgres = Effect.fn("InventoryDigest.partitionDigest")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  subscription: SyncSubscription,
) {
  const rows: SnapshotRow[] = [];
  for (const entity of subscriptionEntities(subscription)) {
    rows.push(...(yield* readPartitionRows(tx, organizationId, entity)));
  }
  return rowImageDigest(rows) satisfies PartitionDigest;
});
