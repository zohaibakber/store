import { SyncProtocolError, syncProtocolError } from "@store/contracts";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/sql/SqlError";

import type { ReplicaStorageError } from "../replica/errors";
import { SyncTransportUnavailable, SyncTransportGarbled } from "../transport";

export const RETRY_MILLIS = 1_000;

export type ReadFailureCause =
  | SyncProtocolError
  | SyncTransportUnavailable
  | SyncTransportGarbled
  | SqlError
  | EffectDrizzleQueryError
  | ReplicaStorageError
  | Schema.SchemaError;

export const readFailure = (
  cause: ReadFailureCause,
): SyncProtocolError | SyncTransportUnavailable | SyncTransportGarbled => {
  switch (cause._tag) {
    case "SyncProtocolError":
    case "SyncTransportUnavailable":
    case "SyncTransportGarbled":
      return cause;
    case "SchemaError":
      return new SyncTransportGarbled({ message: cause.message });
    case "SqlError":
    case "EffectDrizzleQueryError":
    case "ReplicaStorageError":
      return new SyncTransportUnavailable({
        message: cause.message,
        retryAfterMillis: RETRY_MILLIS,
      });
  }
};

export const snapshotUnavailable = Effect.fail(
  syncProtocolError("SNAPSHOT_UNAVAILABLE", "A local workspace has no snapshots."),
);
