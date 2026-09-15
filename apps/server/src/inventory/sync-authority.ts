import type {
  CommandReceipt,
  RegisterReplicaRequest,
  RegisterReplicaResult,
  SyncCommandEnvelope,
  SyncProtocolError,
  SyncPullRequest,
  SyncPullResult,
} from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { InventoryActor } from "./model";

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  "SyncUnavailableError",
  { message: Schema.String },
) {}

export const syncUnavailableError = (message = "Organization sync is not provisioned.") =>
  SyncUnavailableError.make({ message });

export interface SyncAuthorityContract {
  readonly registerReplica: (
    actor: InventoryActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, SyncProtocolError | SyncUnavailableError>;
  readonly submitCommand: (
    actor: InventoryActor,
    envelope: SyncCommandEnvelope,
  ) => Effect.Effect<CommandReceipt, SyncProtocolError | SyncUnavailableError>;
  readonly getReceipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, SyncProtocolError | SyncUnavailableError>;
  readonly pull: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<SyncPullResult, SyncProtocolError | SyncUnavailableError>;
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
};

export const UnprovisionedSyncAuthorityLive = Layer.succeed(
  SyncAuthority,
  unprovisionedSyncAuthority,
);
