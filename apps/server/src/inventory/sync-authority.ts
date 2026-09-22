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
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import type { InventoryCommandsContract } from "./commands";
import { InventoryDatabaseError } from "./errors";
import type { InventoryLiveContract } from "./live-tickets";
import type { InventorySyncActor } from "./model";
import type { InventorySnapshotsContract } from "./snapshots";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  { message: Schema.String },
) {}

export const syncUnavailableError = (message = "Organization sync is not provisioned.") =>
  SyncUnavailableError.make({ message });

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

export const UnprovisionedSyncAuthorityLive = Layer.succeed(
  SyncAuthority,
  unprovisionedSyncAuthority,
);

const mapInventoryError = <A, R>(
  effect: Effect.Effect<A, SyncProtocolError | InventoryDatabaseError, R>,
): Effect.Effect<A, SyncAuthorityError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      error._tag === "InventoryDatabaseError" ? syncUnavailableError(error.message) : error,
    ),
  );

export const makeInventorySyncAuthority = (stores: {
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
  readonly live: InventoryLiveContract;
}): SyncAuthorityContract => ({
  registerReplica: (actor, request) => mapInventoryError(stores.commands.register(actor, request)),
  submitCommand: (actor, envelope) => mapInventoryError(stores.commands.commit(actor, envelope)),
  getReceipt: (actor, operationId) =>
    mapInventoryError(stores.commands.receipt(actor, operationId)),
  pull: (actor, request) => mapInventoryError(stores.commands.pull(actor, request)),
  acquireSnapshot: (actor, request) =>
    mapInventoryError(stores.snapshots.acquireSnapshot(actor, request)),
  readSnapshotPart: (actor, snapshotId, partNumber) =>
    mapInventoryError(stores.snapshots.readSnapshotPart(actor, snapshotId, partNumber)),
  mintLiveTicket: (actor, request) => mapInventoryError(stores.live.mintLiveTicket(actor, request)),
});

export type SyncLiveUpgradeSuccess = SyncLiveWakeHint | void | Stream.Stream<SyncLiveSseEvent>;

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

export const UnprovisionedSyncLiveUpgradeLive = Layer.succeed(
  SyncLiveUpgrade,
  unprovisionedSyncLiveUpgrade,
);
