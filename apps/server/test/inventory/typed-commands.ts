import {
  CommandReceipt,
  OrgCommitSequence,
  SyncPullResult,
  SyncSubmitCommandResult,
  type SyncCommandEnvelope,
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

type SubmitRequest = SyncCommandEnvelope & Partial<SyncSubmitCommandRequest>;

export const typedCommands = (commands: InventoryCommandsContract) => {
  const submitEncoded = (actor: InventoryActor, request: SubmitRequest) =>
    commands
      .submitRaw(
        actor,
        JSON.stringify({ afterCommitSequence: OrgCommitSequence.make("0"), ...request }),
      )
      .pipe(Effect.catchTag("SyncRequestMalformed", (error) => Effect.die(error)));
  return {
    ...commands,
    submitEncoded,
    commit: (actor: InventoryActor, request: SubmitRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeReceipt(submitted.body))),
      ),
    submit: (actor: InventoryActor, request: SubmitRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeSubmitResult(submitted.body))),
      ),
    pull: (actor: InventoryActor, request: SyncPullRequest) =>
      commands
        .pullEncoded(actor, request)
        .pipe(Effect.flatMap((encoded) => Effect.orDie(decodePullResult(encoded.json)))),
  };
};
