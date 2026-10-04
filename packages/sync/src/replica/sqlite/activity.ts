import { CommandStatus, type SyncEntity } from "@store/contracts";
import { commandOutbox, pendingRowMarks, replicaState } from "@store/db/replica.schema";
import { count, desc, eq, inArray } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ACTIVITY_COMMAND_STATUSES,
  MAX_REJECTED_ACTIVITY_ROWS,
  type ReplicaOutboxActivity,
} from "../activity";
import { clientSequenceLength } from "../commands";
import type { ReplicaDb } from "../sql-client/drizzle";

const StatusCountRow = Schema.Struct({ status: CommandStatus, count: Schema.Number });

const RejectedOutboxRow = Schema.Struct({
  operationId: Schema.String,
  clientSequence: Schema.String,
  createdAt: Schema.Number,
  envelopeJson: Schema.String,
  receiptJson: Schema.NullOr(Schema.String),
});

const ActivityStateRow = Schema.Struct({
  caughtUpAt: Schema.NullOr(Schema.Number),
  lowestActiveSchemaVersion: Schema.NullOr(Schema.Number),
});

const PendingRowIdRow = Schema.Struct({ entityId: Schema.String });

const decodeStatusCountRows = Schema.decodeUnknownEffect(Schema.Array(StatusCountRow));
const decodeRejectedOutboxRows = Schema.decodeUnknownEffect(Schema.Array(RejectedOutboxRow));
const decodeActivityStateRow = Schema.decodeUnknownEffect(ActivityStateRow);
const decodePendingRowIdRows = Schema.decodeUnknownEffect(Schema.Array(PendingRowIdRow));

export const readOutboxActivitySqlite = Effect.fn("SqliteReplicaActivity.readOutboxActivity")(
  function* (db: ReplicaDb) {
    const statusCounts = yield* db
      .select({ status: commandOutbox.status, count: count() })
      .from(commandOutbox)
      .where(inArray(commandOutbox.status, [...ACTIVITY_COMMAND_STATUSES]))
      .groupBy(commandOutbox.status)
      .all()
      .pipe(Effect.flatMap(decodeStatusCountRows), Effect.orDie);
    const rejected = yield* db
      .select({
        operationId: commandOutbox.operationId,
        clientSequence: commandOutbox.clientSequence,
        createdAt: commandOutbox.createdAt,
        envelopeJson: commandOutbox.envelopeJson,
        receiptJson: commandOutbox.receiptJson,
      })
      .from(commandOutbox)
      .where(eq(commandOutbox.status, "rejected"))
      .orderBy(desc(clientSequenceLength), desc(commandOutbox.clientSequence))
      .limit(MAX_REJECTED_ACTIVITY_ROWS)
      .all()
      .pipe(Effect.flatMap(decodeRejectedOutboxRows), Effect.orDie);
    const state = yield* db
      .select({
        caughtUpAt: replicaState.caughtUpAt,
        lowestActiveSchemaVersion: replicaState.lowestActiveSchemaVersion,
      })
      .from(replicaState)
      .where(eq(replicaState.id, "singleton"))
      .all()
      .pipe(
        Effect.flatMap((rows) => decodeActivityStateRow(rows[0])),
        Effect.orDie,
      );
    return { statusCounts, rejected, ...state } satisfies ReplicaOutboxActivity;
  },
);

export const readPendingRowIdsSqlite = Effect.fn("SqliteReplicaActivity.readPendingRowIds")(
  function* (db: ReplicaDb, entity: SyncEntity) {
    const rows = yield* db
      .select({ entityId: pendingRowMarks.entityId })
      .from(pendingRowMarks)
      .where(eq(pendingRowMarks.entity, entity))
      .all()
      .pipe(Effect.flatMap(decodePendingRowIdRows), Effect.orDie);
    return rows.map((row) => row.entityId);
  },
);
