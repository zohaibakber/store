import {
  SyncCommandEnvelope,
  syncProtocolError,
  type EnqueueCommandRequest,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideEnqueueReplay } from "./decisions";
import { loadCommandContext, type CatalogReads, type CommandContext } from "./footprint";
import { checkEnqueueAllowed } from "./projection";

type AdmittingReplica = {
  readonly organizationId: string;
  readonly epoch: string;
  readonly replicaId: string;
  readonly nextClientSequence: string;
};

type StoredCommand = {
  readonly status: CommandStatus;
  readonly envelope: SyncCommandEnvelope;
};

type CommandAdmission =
  | { readonly _tag: "replayed"; readonly status: CommandStatus }
  | {
      readonly _tag: "admitted";
      readonly envelope: SyncCommandEnvelope;
      readonly context: CommandContext;
    };

const decodeEnvelope = Schema.decodeUnknownEffect(SyncCommandEnvelope);

export const admitCommand = Effect.fn("ReplicaAdmission.admitCommand")(function* <E, R>(
  replica: AdmittingReplica,
  stored: StoredCommand | undefined,
  request: EnqueueCommandRequest,
  reads: CatalogReads<E, R>,
) {
  const payloadHash = canonicalPayloadHash(request.command);
  const replay = yield* Effect.fromResult(decideEnqueueReplay(stored, payloadHash));
  if (replay !== undefined) {
    return { _tag: "replayed", status: replay } satisfies CommandAdmission;
  }
  const envelope = yield* decodeEnvelope({
    organizationId: replica.organizationId,
    epoch: replica.epoch,
    replicaId: replica.replicaId,
    clientSequence: replica.nextClientSequence,
    operationId: request.operationId,
    payloadHash,
    command: request.command,
  }).pipe(Effect.mapError((error) => syncProtocolError("INVALID_OPERATION", error.message)));
  const context = yield* loadCommandContext(envelope.command, reads, {
    checkRules: true,
    withStock: true,
  });
  yield* checkEnqueueAllowed(envelope, context.lookup, context.unitsPerPackFor, context.stockFor);
  return { _tag: "admitted", envelope, context } satisfies CommandAdmission;
});
