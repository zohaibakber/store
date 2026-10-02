import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  CommandReceipt,
  ImportCatalogRequest,
  ImportId,
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
import type { InventoryImportsContract } from "./imports";
import type {
  EncodedJsonBody,
  ImportedCatalog,
  EncodedSnapshotPart,
  InventoryActor,
  SubmittedCommand,
} from "./model";
import type { InventorySnapshotsContract } from "./snapshots";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  {
    code: Schema.Literal("SYNC_UNAVAILABLE"),
    message: Schema.String,
  },
) {}

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
    actor: InventoryActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncAuthorityError, RuntimeContext>;
  readonly submitCommand: (
    actor: InventoryActor,
    bodyText: string,
  ) => Effect.Effect<SubmittedCommand, SyncAuthorityError | SyncRequestMalformed, RuntimeContext>;
  readonly getReceipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncAuthorityError, RuntimeContext>;
  readonly pull: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<EncodedJsonBody, SyncAuthorityError, RuntimeContext>;
  readonly acquireSnapshot: (
    actor: InventoryActor,
    request: AcquireSnapshotRequest,
  ) => Effect.Effect<AcquireSnapshotResult, SyncAuthorityError, RuntimeContext>;
  readonly readSnapshotPart: (
    actor: InventoryActor,
    snapshotId: SnapshotId,
    partNumber: number,
  ) => Effect.Effect<EncodedSnapshotPart, SyncAuthorityError, RuntimeContext>;
  readonly stageImportPart: (
    actor: InventoryActor,
    importId: ImportId,
    partNumber: number,
    bodyText: string,
  ) => Effect.Effect<EncodedJsonBody, SyncAuthorityError, RuntimeContext>;
  readonly commitImport: (
    actor: InventoryActor,
    importId: ImportId,
    request: ImportCatalogRequest,
  ) => Effect.Effect<ImportedCatalog, SyncAuthorityError, RuntimeContext>;
}

export class SyncAuthority extends Context.Service<SyncAuthority, SyncAuthorityContract>()(
  "@store/server/SyncAuthority",
) {}

const toSyncAuthorityError = <A, R>(
  effect: Effect.Effect<A, InventoryError, R>,
): Effect.Effect<A, SyncAuthorityError, R> =>
  effect.pipe(Effect.catchTag("InventoryDatabaseError", syncDatabaseFailure));

export const makeInventorySyncAuthority = (stores: {
  readonly commands: InventoryCommandsContract;
  readonly snapshots: InventorySnapshotsContract;
  readonly imports: InventoryImportsContract;
}): SyncAuthorityContract => ({
  registerReplica: (actor, request) =>
    toSyncAuthorityError(stores.commands.register(actor, request)),
  submitCommand: (actor, bodyText) =>
    stores.commands
      .submitRaw(actor, bodyText)
      .pipe(Effect.catchTag("InventoryDatabaseError", syncDatabaseFailure)),
  getReceipt: (actor, operationId) =>
    toSyncAuthorityError(stores.commands.receipt(actor, operationId)),
  pull: (actor, request) => toSyncAuthorityError(stores.commands.pullEncoded(actor, request)),
  acquireSnapshot: (actor, request) =>
    toSyncAuthorityError(stores.snapshots.acquireSnapshot(actor, request)),
  readSnapshotPart: (actor, snapshotId, partNumber) =>
    toSyncAuthorityError(stores.snapshots.readSnapshotPartEncoded(actor, snapshotId, partNumber)),
  stageImportPart: (actor, importId, partNumber, bodyText) =>
    toSyncAuthorityError(stores.imports.stagePart(actor, importId, partNumber, bodyText)),
  commitImport: (actor, importId, request) =>
    toSyncAuthorityError(stores.imports.commit(actor, importId, request)),
});
