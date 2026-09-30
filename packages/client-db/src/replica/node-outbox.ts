import { commandOutbox } from "@store/db/replica.schema";
import type { ReplicaDb } from "@store/sync/sql-client";
import * as Effect from "effect/Effect";

import { decodeOutboxStatusRow } from "./sqlite-row";
import type { OutboxCommandStatus } from "./sqlite-row";

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
