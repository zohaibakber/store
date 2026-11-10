import {
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SYNC_SCHEMA_VERSION,
  type CommandReceipt,
  type SyncCommandEnvelope,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { loadReplicaState } from "../replica/commands";
import { type ProjectionActor } from "../replica/projection";
import type { ReplicaDb } from "../replica/sql-client/drizzle";
import { decideCatalogWrite, decideIssueInvoice } from "./decide";
import { rejected, type Decision } from "./decision";
import { loadCatalogFacts, loadInvoiceFacts } from "./facts";

export const decideCommandWithin = (
  tx: ReplicaDb,
  actor: ProjectionActor,
  envelope: SyncCommandEnvelope,
): Effect.Effect<Decision, EffectDrizzleQueryError | Schema.SchemaError> => {
  if (envelope.command.payload.commandId !== envelope.operationId) {
    return Effect.succeed(
      rejected("COMMAND_IDENTITY_MISMATCH", "The command id must match the envelope operation id."),
    );
  }
  switch (envelope.command._tag) {
    case "issueInvoice": {
      const { payload } = envelope.command;
      return loadInvoiceFacts(tx, actor.organizationId, payload).pipe(
        Effect.map((facts) => decideIssueInvoice(envelope, payload, actor, facts)),
      );
    }
    case "catalogWrite": {
      const { payload } = envelope.command;
      return loadCatalogFacts(tx, actor.organizationId, payload).pipe(
        Effect.map((facts) => decideCatalogWrite(payload, actor, facts)),
      );
    }
  }
};

export const decideLocalCommand = Effect.fn("LocalAuthority.decideLocalCommand")(function* (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
) {
  const state = yield* loadReplicaState(tx);
  const commitSequence = OrgCommitSequence.make(
    incrementDecimalSequence(state.appliedCommitSequence),
  );
  const decision = yield* decideCommandWithin(
    tx,
    { organizationId: state.organizationId, userId: state.userId },
    envelope,
  );
  const { group, result } = Result.match(decision, {
    onSuccess: ({ result, changes }) => ({
      group: {
        commitSequence,
        operationId: envelope.operationId,
        decision: "accepted",
        changes,
      } satisfies SyncTransactionGroup,
      result,
    }),
    onFailure: ({ code, message }) => ({
      group: {
        commitSequence,
        operationId: envelope.operationId,
        decision: "rejected",
        changes: [],
      } satisfies SyncTransactionGroup,
      result: { _tag: "rejected", code, message } satisfies CommandReceipt["result"],
    }),
  });
  const receipt = {
    operationId: envelope.operationId,
    replicaId: envelope.replicaId,
    clientSequence: envelope.clientSequence,
    payloadHash: envelope.payloadHash,
    decision: group.decision,
    commitSequence,
    result,
  } satisfies CommandReceipt;
  const page = {
    epoch: state.epoch,
    incarnation: state.incarnation,
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions: [group],
    nextCommitSequence: commitSequence,
    horizon: commitSequence,
    retentionFloor: state.appliedCommitSequence,
  } satisfies SyncPullResult;
  return { receipt, page };
});
