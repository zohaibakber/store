import {
  CommandReceipt,
  type OperationId,
  OrgCommitSequence,
  type SyncCommandEnvelope,
  type SyncTransactionGroup,
} from "@store/contracts";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type ProjectionActor } from "../replica/projection";
import type { ReplicaDb } from "../replica/sql-client/drizzle";
import { decideCatalogWrite, decideIssueInvoice } from "./decide";
import { rejected, type Decision } from "./decision";
import {
  SETTLED_CATALOG,
  loadCatalogFacts,
  loadInvoiceFacts,
  replicaJournal,
  type PendingJournal,
} from "./facts";
import { type ReplicaStateRow } from "./pull";

export const decideCommandWithin = (
  tx: ReplicaDb,
  actor: ProjectionActor,
  envelope: SyncCommandEnvelope,
  journal: PendingJournal,
): Effect.Effect<Decision, EffectDrizzleQueryError | Schema.SchemaError> => {
  if (envelope.command.payload.commandId !== envelope.operationId) {
    return Effect.succeed(
      rejected("COMMAND_IDENTITY_MISMATCH", "The command id must match the envelope operation id."),
    );
  }
  switch (envelope.command._tag) {
    case "issueInvoice": {
      const { payload } = envelope.command;
      return loadInvoiceFacts(tx, actor.organizationId, payload, journal).pipe(
        Effect.map((facts) => decideIssueInvoice(envelope, payload, actor, facts)),
      );
    }
    case "catalogWrite": {
      const { payload } = envelope.command;
      return loadCatalogFacts(tx, actor.organizationId, payload, journal).pipe(
        Effect.map((facts) => decideCatalogWrite(payload, actor, facts)),
      );
    }
  }
};

export const decideCommand = (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  envelope: SyncCommandEnvelope,
): Effect.Effect<Decision, EffectDrizzleQueryError | Schema.SchemaError> => {
  const actor = { organizationId: state.organizationId, userId: state.userId };
  return envelope.command.payload.commandId !== envelope.operationId
    ? decideCommandWithin(tx, actor, envelope, SETTLED_CATALOG)
    : Effect.flatMap(replicaJournal(tx), (journal) =>
        decideCommandWithin(tx, actor, envelope, journal),
      );
};

type DecidedGroup = {
  readonly group: SyncTransactionGroup;
  readonly result: CommandReceipt["result"];
};

export const groupOf = (
  commitSequence: OrgCommitSequence,
  operationId: OperationId,
  decision: Decision,
): DecidedGroup =>
  Result.match(decision, {
    onSuccess: ({ result, changes }) => ({
      group: { commitSequence, operationId, decision: "accepted", changes },
      result,
    }),
    onFailure: ({ code, message }) => ({
      group: { commitSequence, operationId, decision: "rejected", changes: [] },
      result: { _tag: "rejected", code, message },
    }),
  });
