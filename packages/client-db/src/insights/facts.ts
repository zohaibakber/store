import type { ReplicaInsightsWindow } from "@store/contracts";
import { runReplicaTransaction, type SqliteReplicaHandle } from "@store/sync/sql-client";
import * as Effect from "effect/Effect";

import { readSqliteInsightsFacts } from "../replica/insights-sqlite";
import { replicaStampQuery } from "../replica/replica-queries";
import { decodeReplicaStampRow } from "../replica/sqlite-row";
import { readFailure } from "../store/failures";

export const readReplicaStamp = Effect.fn("InventoryInsights.readStamp")(function* (
  replica: SqliteReplicaHandle,
) {
  const rows = yield* replica.db.all(replicaStampQuery);
  const decoded = decodeReplicaStampRow(rows[0]);
  return { generationId: String(decoded.generation), localCommitVersion: decoded.version };
}, Effect.mapError(readFailure));

export const readInsightsFacts = Effect.fn("InventoryInsights.readFacts")(function* (
  replica: SqliteReplicaHandle,
  window: ReplicaInsightsWindow,
) {
  return yield* runReplicaTransaction(replica, () =>
    Effect.gen(function* () {
      const stamp = yield* readReplicaStamp(replica);
      const facts = yield* readSqliteInsightsFacts(replica, window);
      return { stamp, facts };
    }),
  );
}, Effect.mapError(readFailure));
