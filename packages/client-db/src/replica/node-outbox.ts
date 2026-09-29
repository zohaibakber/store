import { commandOutbox, replicaState } from "@store/db/replica.schema";
import type { ReplicaDb } from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeOutboxStatusRow } from "./sqlite-row";
import type { OutboxCommandStatus } from "./sqlite-row";

const allocationRow = Schema.Struct({
  epoch: Schema.String,
  nextClientSequence: Schema.String,
});

const decodeAllocation = Schema.decodeUnknownSync(allocationRow);

export const readOutboxStatusesSqlite = Effect.fn("ReplicaNodeOutbox.readOutboxStatuses")(
  function* (db: ReplicaDb) {
    const rows = yield* db.select({ status: commandOutbox.status }).from(commandOutbox).all();
    const statuses: Array<OutboxCommandStatus> = [];
    for (const row of rows) {
      const decoded = decodeOutboxStatusRow(row);
      if (decoded._tag === "Some") statuses.push(decoded.value.status);
    }
    return statuses satisfies ReadonlyArray<OutboxCommandStatus>;
  },
);

export const readCommandAllocationSqlite = Effect.fn("ReplicaNodeOutbox.readCommandAllocation")(
  function* (db: ReplicaDb) {
    const rows = yield* db
      .select({ epoch: replicaState.epoch, nextClientSequence: replicaState.nextClientSequence })
      .from(replicaState)
      .where(eq(replicaState.id, "singleton"))
      .all();
    return decodeAllocation(rows[0]);
  },
);
