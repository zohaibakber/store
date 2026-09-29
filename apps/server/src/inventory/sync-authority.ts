import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SyncProtocolError,
  SyncPullRequest,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InventoryCommandsContract, SyncRequestMalformed } from "./commands";
import type { InventoryDatabaseError, InventoryError } from "./errors";
import type {
  EncodedJsonBody,
  EncodedSnapshotPart,
  InventorySyncActor,
  SubmittedCommand,
} from "./model";
import { inventoryPostgresUnavailable } from "./postgres";
import type { InventorySnapshotsContract } from "./snapshots";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  {
    code: Schema.Literals(["SYNC_NOT_PROVISIONED", "SYNC_UNAVAILABLE"]),
    message: Schema.String,
  },
) {}

const syncUnavailableError = (message: string) =>
  SyncUnavailableError.make({ code: "SYNC_NOT_PROVISIONED", message });

const syncDatabaseFailure = (error: InventoryDatabaseError) =>
  Effect.logError("inventory.database_failed", error.cause ?? error.message).pipe(
    Effect.annotateLogs({ detail: error.message }),
    Effect.andThen(
      Effect.fail(
        SyncUnavailableError.make({
          code: "SYNC_UNAVAILABLE",
          message: "Organization sync is temporarily unavailable. Try again shortly.",
        }),
      ),
    ),
  );

export type SyncAuthorityError = SyncProtocolError | SyncUnavailableError;

export interface SyncAuthorityContract {
  readonly registerReplica: (
    actor: InventorySyncActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncAuthorityError, RuntimeContext>;
  readonly submitCommand: (
    actor: InventorySyncActor,
    bodyText: string,
  ) => Effect.Effect<SubmittedCommand, SyncAuthorityError | SyncRequestMalformed, RuntimeContext>;
  readonly getReceipt: (
    actor: InventorySyncActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncAuthorityError, RuntimeContext>;
  readonly pull: (
    actor: InventorySyncActor,
    request: SyncPullRequest,
  ) => Effect.Effect<EncodedJsonBody, SyncAuthorityError, RuntimeContext>;
  readonly acquireSnapshot: (
    actor: InventorySyncActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, SyncAuthorityError, RuntimeContext>;
  readonly readSnapshotPart: (
    actor: InventorySyncActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<EncodedSnapshotPart, SyncAuthorityError, RuntimeContext>;
}

export class SyncAuthority extends Context.Service<SyncAuthority, SyncAuthorityContract>()(
  "@store/server/SyncAuthority",
) {}

const unavailableFrom = (error: InventoryDatabaseError) =>
  error === inventoryPostgresUnavailable
    ? Effect.fail(syncUnavailableError(error.message))
    : syncDatabaseFailure(error);

const toSyncAuthorityError = <A, R>(
  effect: Effect.Effect<A, InventoryError, R>,
): Effect.Effect<A, SyncAuthorityError, R> =>
  effect.pipe(Effect.catchTag("InventoryDatabaseError", unavailableFrom));

export const makeInventorySyncAuthority = (stores: {
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
}): SyncAuthorityContract => ({
  registerReplica: (actor, request) =>
    toSyncAuthorityError(stores.commands.register(actor, request)),
  submitCommand: (actor, bodyText) =>
    stores.commands
      .submitRaw(actor, bodyText)
      .pipe(Effect.catchTag("InventoryDatabaseError", unavailableFrom)),
  getReceipt: (actor, operationId) =>
    toSyncAuthorityError(stores.commands.receipt(actor, operationId)),
  pull: (actor, request) => toSyncAuthorityError(stores.commands.pullEncoded(actor, request)),
  acquireSnapshot: (actor, request) =>
    toSyncAuthorityError(stores.snapshots.acquireSnapshot(actor, request)),
  readSnapshotPart: (actor, snapshotId, partNumber) =>
    toSyncAuthorityError(stores.snapshots.readSnapshotPartEncoded(actor, snapshotId, partNumber)),
});
