import { CommandStatus, type SyncEntity } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { MAX_REJECTED_ACTIVITY_ROWS, type ReplicaOutboxActivity } from "../activity";

const StatusCountRow = Schema.Struct({ status: CommandStatus, count: Schema.Number });

const RejectedOutboxRow = Schema.Struct({
  operationId: Schema.String,
  clientSequence: Schema.String,
  createdAt: Schema.Number,
  envelopeJson: Schema.String,
  receiptJson: Schema.NullOr(Schema.String),
});

const CaughtUpRow = Schema.Struct({ caughtUpAt: Schema.NullOr(Schema.Number) });

const PendingRowIdRow = Schema.Struct({ entityId: Schema.String });

const decodeStatusCountRows = Schema.decodeUnknownEffect(Schema.Array(StatusCountRow));
const decodeRejectedOutboxRows = Schema.decodeUnknownEffect(Schema.Array(RejectedOutboxRow));
const decodeCaughtUpRow = Schema.decodeUnknownEffect(CaughtUpRow);
const decodePendingRowIdRows = Schema.decodeUnknownEffect(Schema.Array(PendingRowIdRow));

export const readOutboxActivitySqlite = Effect.fn("SqliteReplicaActivity.readOutboxActivity")(
  function* (sql: SqlClient) {
    const statusCounts = yield* sql
      .unsafe(
        `select status, count(*) as count from command_outbox
          where status in ('pending', 'sending', 'accepted_awaiting_integration', 'rejected')
          group by status`,
      )
      .pipe(Effect.flatMap(decodeStatusCountRows), Effect.orDie);
    const rejected = yield* sql
      .unsafe(
        `select operationId, clientSequence, createdAt, envelopeJson, receiptJson from command_outbox
          where status = 'rejected'
          order by length(clientSequence) desc, clientSequence desc
          limit ?`,
        [MAX_REJECTED_ACTIVITY_ROWS],
      )
      .pipe(Effect.flatMap(decodeRejectedOutboxRows), Effect.orDie);
    const state = yield* sql
      .unsafe(`select caughtUpAt from replica_state where id = 'singleton'`)
      .pipe(
        Effect.flatMap((rows) => decodeCaughtUpRow(rows[0])),
        Effect.orDie,
      );
    return { statusCounts, rejected, caughtUpAt: state.caughtUpAt } satisfies ReplicaOutboxActivity;
  },
);

export const readPendingRowIdsSqlite = Effect.fn("SqliteReplicaActivity.readPendingRowIds")(
  function* (sql: SqlClient, entity: SyncEntity) {
    const rows = yield* sql
      .unsafe(`select entityId from pending_row_marks where entity = ?`, [entity])
      .pipe(Effect.flatMap(decodePendingRowIdRows), Effect.orDie);
    return rows.map((row) => row.entityId);
  },
);
