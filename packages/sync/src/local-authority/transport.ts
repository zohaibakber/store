import {
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  ReplicaClientSequence,
  SYNC_SCHEMA_VERSION,
  syncProtocolError,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncPullRequest,
  type SyncSubmitCommandRequest,
  type SyncSubmitCommandResult,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { loadReplicaState } from "../replica/commands";
import type { ReplicaDb } from "../replica/sql-client/drizzle";
import {
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "../replica/sql-client/handle";
import { SyncTransportService, SyncTransportUnavailable, type SyncTransport } from "../transport";
import { decideCommand, groupOf } from "./command";
import { RETRY_MILLIS, readFailure, snapshotUnavailable, type ReadFailureCause } from "./failures";
import {
  decidedTail,
  epochOf,
  incarnationOf,
  nextCommitSequence,
  pageAfter,
  pageOf,
  storedReceipt,
} from "./pull";

const submitWithin = Effect.fn("LocalAuthority.submitWithin")(function* (
  tx: ReplicaDb,
  request: SyncSubmitCommandRequest,
) {
  const state = yield* loadReplicaState(tx);
  if (request.organizationId !== state.organizationId) {
    return yield* syncProtocolError(
      "ORGANIZATION_MISMATCH",
      "The command does not belong to the active organization.",
    );
  }
  if (canonicalPayloadHash(request.command) !== request.payloadHash) {
    return yield* syncProtocolError("INVALID_PAYLOAD_HASH", "The payload hash does not match.");
  }
  if (request.epoch !== (yield* epochOf(state))) {
    return yield* syncProtocolError("EPOCH_MISMATCH", "The replica epoch does not match.");
  }
  const receipted = yield* storedReceipt(tx, request.operationId);
  if (receipted !== undefined) {
    if (receipted.payloadHash !== request.payloadHash) {
      return yield* syncProtocolError("OPERATION_ID_REUSED", "The command id was reused.");
    }
    const page = yield* pageAfter(tx, state, request.afterCommitSequence);
    return (
      page === undefined ? receipted : { ...receipted, page }
    ) satisfies SyncSubmitCommandResult;
  }
  if (request.replicaId !== state.replicaId || state.registeredAt === null) {
    return yield* syncProtocolError("REPLICA_UNKNOWN", "This replica is not registered.");
  }
  const tail = yield* decidedTail(tx, state);
  const expected = incrementDecimalSequence(tail.lastClientSequence);
  if (compareDecimalSequence(request.clientSequence, expected) !== 0) {
    return yield* syncProtocolError(
      "REPLICA_SEQUENCE_GAP",
      `Expected client sequence ${expected}, received ${request.clientSequence}.`,
    );
  }
  if (tail.unapplied !== undefined) {
    return yield* new SyncTransportUnavailable({
      message: "An earlier decision has not reached the local replica yet.",
      retryAfterMillis: RETRY_MILLIS,
    });
  }
  const { group, result } = groupOf(
    nextCommitSequence(state),
    request.operationId,
    yield* decideCommand(tx, state, request),
  );
  const receipt = {
    operationId: request.operationId,
    replicaId: request.replicaId,
    clientSequence: request.clientSequence,
    payloadHash: request.payloadHash,
    decision: group.decision,
    commitSequence: group.commitSequence,
    result,
  } satisfies CommandReceipt;
  if (request.afterCommitSequence !== state.appliedCommitSequence) {
    return receipt satisfies SyncSubmitCommandResult;
  }
  return {
    ...receipt,
    page: yield* pageOf(state, request.afterCommitSequence, [group]),
  } satisfies SyncSubmitCommandResult;
});

const makeLocalAuthority = (handle: SqliteReplicaHandle): SyncTransport => {
  const reading = <A, E extends ReadFailureCause>(run: (tx: ReplicaDb) => Effect.Effect<A, E>) =>
    runReplicaTransaction(handle, run).pipe(Effect.mapError(readFailure));

  const registerReplica = Effect.fn("LocalAuthority.registerReplica")(function* (
    request: RegisterReplicaRequest,
  ) {
    return yield* reading((tx) =>
      Effect.gen(function* () {
        const state = yield* loadReplicaState(tx);
        if (request.replicaId !== state.replicaId) {
          return yield* syncProtocolError(
            "REPLICA_UNKNOWN",
            "This replica does not own the local workspace.",
          );
        }
        const applied = state.appliedCommitSequence;
        const { lastClientSequence } = yield* decidedTail(tx, state);
        return {
          replicaId: request.replicaId,
          epoch: yield* epochOf(state),
          incarnation: yield* incarnationOf(state),
          nextClientSequence: ReplicaClientSequence.make(
            incrementDecimalSequence(lastClientSequence),
          ),
          retentionFloor: applied,
          horizon: applied,
          schemaVersion: SYNC_SCHEMA_VERSION,
          lowestActiveSchemaVersion: SYNC_SCHEMA_VERSION,
        } satisfies RegisterReplicaResult;
      }),
    );
  });

  const submitCommand = Effect.fn("LocalAuthority.submitCommand")(function* (
    request: SyncSubmitCommandRequest,
  ) {
    return yield* reading((tx) => submitWithin(tx, request));
  });

  const getReceipt = Effect.fn("LocalAuthority.getReceipt")(function* (operationId: string) {
    return yield* reading((tx) => storedReceipt(tx, operationId));
  });

  const pull = Effect.fn("LocalAuthority.pull")(function* (request: SyncPullRequest) {
    return yield* reading((tx) =>
      Effect.gen(function* () {
        const state = yield* loadReplicaState(tx);
        if (request.epoch !== (yield* epochOf(state))) {
          return yield* syncProtocolError("EPOCH_MISMATCH", "The replica epoch does not match.");
        }
        const page = yield* pageAfter(tx, state, request.afterCommitSequence);
        return page === undefined
          ? yield* syncProtocolError(
              "SNAPSHOT_REQUIRED",
              "The local authority keeps no history outside the replica's own position.",
            )
          : page;
      }),
    );
  });

  return {
    registerReplica,
    submitCommand,
    getReceipt,
    pull,
    acquireSnapshot: () => snapshotUnavailable,
    readSnapshotPart: () => snapshotUnavailable,
  };
};

export const LocalAuthority = {
  submitWithin,
  layer: Layer.effect(
    SyncTransportService,
    SqliteReplica.use((handle) => Effect.succeed(makeLocalAuthority(handle))),
  ),
};
