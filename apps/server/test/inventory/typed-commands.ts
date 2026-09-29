import {
  CommandReceipt,
  SyncPullResult,
  SyncSubmitCommandResult,
  type SyncPullRequest,
  type SyncSubmitCommandRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { InventoryCommandsContract } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";

const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandReceipt));
const decodeSubmitResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SyncSubmitCommandResult),
);
const decodePullResult = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncPullResult));

export const typedCommands = (commands: InventoryCommandsContract) => {
  const submitEncoded = (actor: InventoryActor, request: SyncSubmitCommandRequest) =>
    commands
      .submitRaw(actor, JSON.stringify(request))
      .pipe(Effect.catchTag("SyncRequestMalformed", (error) => Effect.die(error)));
  return {
    ...commands,
    submitEncoded,
    commit: (actor: InventoryActor, request: SyncSubmitCommandRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeReceipt(submitted.body))),
      ),
    submit: (actor: InventoryActor, request: SyncSubmitCommandRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeSubmitResult(submitted.body))),
      ),
    pull: (actor: InventoryActor, request: SyncPullRequest) =>
      commands
        .pullEncoded(actor, request)
        .pipe(Effect.flatMap((encoded) => Effect.orDie(decodePullResult(encoded.json)))),
  };
};
