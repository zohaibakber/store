import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  LiveTicket,
  LiveTicketRequest,
  LiveUpgradeQuery,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SnapshotId,
  SnapshotPartPayload,
  SyncCommandEnvelope,
  SyncLiveSseEvent,
  SyncLiveWakeHint,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
  syncProtocolError,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import type { InventoryCommandsContract } from "./commands";
import type { InventoryDatabaseError, InventoryError } from "./errors";
import type { InventoryLiveContract } from "./live-tickets";
import type { InventorySyncActor } from "./model";
import { inventoryPostgresUnavailable } from "./postgres";
import type { InventorySnapshotsContract } from "./snapshots";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  {
    code: Schema.Literals(["SYNC_NOT_PROVISIONED", "SYNC_UNAVAILABLE"]),
    message: Schema.String,
  },
) {}

const syncUnavailableError = (message = "Organization sync is not provisioned.") =>
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
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, SyncAuthorityError, RuntimeContext>;
  readonly getReceipt: (
    actor: InventorySyncActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncAuthorityError, RuntimeContext>;
  readonly pull: (
    actor: InventorySyncActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, SyncAuthorityError, RuntimeContext>;
  readonly acquireSnapshot: (
    actor: InventorySyncActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, SyncAuthorityError, RuntimeContext>;
  readonly readSnapshotPart: (
    actor: InventorySyncActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<SnapshotPartPayload, SyncAuthorityError, RuntimeContext>;
  readonly mintLiveTicket: (
    actor: InventorySyncActor,
    request: LiveTicketRequest,
  ) => Effect.Effect<LiveTicket, SyncAuthorityError, RuntimeContext>;
}

export class SyncAuthority extends Context.Service<SyncAuthority, SyncAuthorityContract>()(
  "@store/server/SyncAuthority",
) {}

const unavailable = () => Effect.fail(syncUnavailableError());

export const unprovisionedSyncAuthority: SyncAuthorityContract = {
  registerReplica: () => unavailable(),
  submitCommand: () => unavailable(),
  getReceipt: () => unavailable(),
  pull: () => unavailable(),
  acquireSnapshot: () => unavailable(),
  readSnapshotPart: () => unavailable(),
  mintLiveTicket: () => unavailable(),
};

export const toSyncAuthorityError = <A, R>(
  effect: Effect.Effect<A, InventoryError, R>,
): Effect.Effect<A, SyncAuthorityError, R> =>
  effect.pipe(
    Effect.catchTag("InventoryDatabaseError", (error) =>
      error === inventoryPostgresUnavailable
        ? Effect.fail(syncUnavailableError(error.message))
        : syncDatabaseFailure(error),
    ),
  );

export const makeInventorySyncAuthority = (stores: {
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
  readonly live: InventoryLiveContract;
}): SyncAuthorityContract => ({
  registerReplica: (actor, request) =>
    toSyncAuthorityError(stores.commands.register(actor, request)),
  submitCommand: (actor, envelope) => toSyncAuthorityError(stores.commands.commit(actor, envelope)),
  getReceipt: (actor, operationId) =>
    toSyncAuthorityError(stores.commands.receipt(actor, operationId)),
  pull: (actor, request) => toSyncAuthorityError(stores.commands.pull(actor, request)),
  acquireSnapshot: (actor, request) =>
    toSyncAuthorityError(stores.snapshots.acquireSnapshot(actor, request)),
  readSnapshotPart: (actor, snapshotId, partNumber) =>
    toSyncAuthorityError(stores.snapshots.readSnapshotPart(actor, snapshotId, partNumber)),
  mintLiveTicket: (actor, request) =>
    toSyncAuthorityError(stores.live.mintLiveTicket(actor, request)),
});

type SyncLiveUpgradeSuccess = SyncLiveWakeHint | void | Stream.Stream<SyncLiveSseEvent>;

export interface SyncLiveUpgradeContract {
  readonly handle: (
    actor: InventorySyncActor,
    query: LiveUpgradeQuery,
    preferSse: boolean,
  ) => Effect.Effect<SyncLiveUpgradeSuccess, SyncAuthorityError, RuntimeContext>;
}

export class SyncLiveUpgrade extends Context.Service<SyncLiveUpgrade, SyncLiveUpgradeContract>()(
  "@store/server/SyncLiveUpgrade",
) {}

export const unprovisionedSyncLiveUpgrade: SyncLiveUpgradeContract = {
  handle: () => Effect.fail(syncUnavailableError()),
};

export const unavailableSyncLiveUpgrade: SyncLiveUpgradeContract = {
  handle: () => Effect.fail(syncProtocolError("TICKET_INVALID", "Live updates are not available.")),
};
