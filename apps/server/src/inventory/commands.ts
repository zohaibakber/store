import {
  CommandReceipt,
  RegisterReplicaResult,
  type RegisterReplicaRequest,
  type SyncPullRequest,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { answered, answeredOrMalformed, type AuthorityNamespace } from "./authority-client";
import { InventoryDatabaseError, type InventoryError, type SyncRequestMalformed } from "./errors";
import type { EncodedCommit, EncodedJsonBody, InventoryActor } from "./model";

export { SyncRequestMalformed } from "./errors";

export const MAX_SUBMIT_BODY_BYTES = 2 * 1024 * 1024;

const decodeRegisterResult = Schema.decodeUnknownEffect(RegisterReplicaResult);

const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandReceipt));

const garbled = (error: Schema.SchemaError) =>
  InventoryDatabaseError.make({ message: error.message, cause: error });

export interface InventoryCommandsContract<R = never> {
  readonly register: (
    actor: InventoryActor,
    request: RegisterReplicaRequest,
  ) => Effect.Effect<RegisterReplicaResult, InventoryError, R>;
  readonly submitRaw: (
    actor: InventoryActor,
    bodyText: string,
  ) => Effect.Effect<EncodedCommit, InventoryError | SyncRequestMalformed, R>;
  readonly receipt: (
    actor: InventoryActor,
    operationId: string,
  ) => Effect.Effect<CommandReceipt | undefined, InventoryError, R>;
  readonly pullEncoded: (
    actor: InventoryActor,
    request: SyncPullRequest,
  ) => Effect.Effect<EncodedJsonBody, InventoryError, R>;
}

export class InventoryCommands extends Context.Service<
  InventoryCommands,
  InventoryCommandsContract<RuntimeContext>
>()("@store/server/InventoryCommands") {}

export const makeInventoryCommands = <R, E>(
  authorities: AuthorityNamespace<R, E>,
): InventoryCommandsContract<R> => ({
  register: Effect.fn("InventoryCommands.register")(function* (actor, request) {
    const result = yield* answered(
      authorities.getByName(actor.organizationId).register(actor, request),
    );
    return yield* decodeRegisterResult(result).pipe(Effect.mapError(garbled));
  }),
  submitRaw: Effect.fn("InventoryCommands.submitRaw")(function* (actor, bodyText) {
    return yield* answeredOrMalformed(
      authorities.getByName(actor.organizationId).submit(actor, bodyText),
    );
  }),
  receipt: Effect.fn("InventoryCommands.receipt")(function* (actor, operationId) {
    const json = yield* answered(
      authorities.getByName(actor.organizationId).receipt(actor, operationId),
    );
    return json === null ? undefined : yield* decodeReceipt(json).pipe(Effect.mapError(garbled));
  }),
  pullEncoded: Effect.fn("InventoryCommands.pullEncoded")(function* (actor, request) {
    const json = yield* answered(authorities.getByName(actor.organizationId).pull(actor, request));
    return { json } satisfies EncodedJsonBody;
  }),
});
