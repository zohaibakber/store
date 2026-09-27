import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { decodeOutboxStatusRow } from "./sqlite-row";
import type { OutboxCommandStatus } from "./sqlite-row";

const allocationRow = Schema.Struct({
  epoch: Schema.String,
  nextClientSequence: Schema.String,
});

const decodeAllocation = Schema.decodeUnknownSync(allocationRow);

export const readOutboxStatusesSqlite = Effect.fn("ReplicaNodeOutbox.readOutboxStatuses")(
  function* (sql: SqlClient) {
    const rows = yield* sql.unsafe(`select status from command_outbox`);
    const statuses: Array<OutboxCommandStatus> = [];
    for (const row of rows) {
      const decoded = decodeOutboxStatusRow(row);
      if (decoded._tag === "Some") statuses.push(decoded.value.status);
    }
    return statuses satisfies ReadonlyArray<OutboxCommandStatus>;
  },
);

export const readCommandAllocationSqlite = Effect.fn("ReplicaNodeOutbox.readCommandAllocation")(
  function* (sql: SqlClient) {
    const rows = yield* sql.unsafe(
      `select epoch, nextClientSequence from replica_state where id = 'singleton'`,
    );
    return decodeAllocation(rows[0]);
  },
);
