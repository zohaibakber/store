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

import type { Actor } from "../../src/authority/engine";
import type { OrganizationAuthority } from "../../src/inventory/organization-authority";

const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandReceipt));
const decodeSubmitResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SyncSubmitCommandResult),
);
const decodePullResult = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncPullResult));

type SubmitRequest = SyncCommandEnvelope & Partial<SyncSubmitCommandRequest>;

export const typedCommands = (commands: OrganizationAuthority["Service"]) => {
  const submitEncoded = (actor: Actor, request: SubmitRequest) =>
    commands
      .submit(
        actor,
        JSON.stringify({ afterCommitSequence: OrgCommitSequence.make("0"), ...request }),
      )
      .pipe(Effect.catchTag("SyncRequestMalformed", (error) => Effect.die(error)));
  return {
    ...commands,
    submitRaw: commands.submit,
    pullEncoded: commands.pull,
    submitEncoded,
    commit: (actor: Actor, request: SubmitRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeReceipt(submitted.json))),
      ),
    submit: (actor: Actor, request: SubmitRequest) =>
      submitEncoded(actor, request).pipe(
        Effect.flatMap((submitted) => Effect.orDie(decodeSubmitResult(submitted.json))),
      ),
    pull: (actor: Actor, request: SyncPullRequest) =>
      commands
        .pull(actor, request)
        .pipe(Effect.flatMap((encoded) => Effect.orDie(decodePullResult(encoded.json)))),
  };
};
