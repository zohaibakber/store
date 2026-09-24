import {
  SyncProtocolError,
  syncProtocolError,
  type AcquireSnapshotRequest,
} from "@store/contracts";
import * as Effect from "effect/Effect";

import type { ReplicaStoreContract, ReplicaStoreError } from "./replica/store";
import type { SyncTransport, SyncTransportError } from "./transport";

export type SnapshotRecoveryError = SyncTransportError | SyncProtocolError | ReplicaStoreError;

export const recoverRequiredSnapshot = (
  transport: SyncTransport,
  store: ReplicaStoreContract,
  request: AcquireSnapshotRequest,
): Effect.Effect<void, SnapshotRecoveryError> =>
  Effect.gen(function* () {
    const acquired = yield* transport.acquireSnapshot(request);
    if (acquired._tag !== "ready") {
      return yield* Effect.fail(
        syncProtocolError(
          "SNAPSHOT_UNAVAILABLE",
          "The server has not finished publishing a snapshot for this subscription.",
        ),
      );
    }
    const { manifest } = acquired;
    yield* store.beginSnapshotImport(manifest);
    yield* Effect.forEach(
      manifest.parts,
      (partRef) =>
        Effect.gen(function* () {
          const part = yield* transport.readSnapshotPart(manifest.snapshotId, partRef.partNumber);
          yield* store.importSnapshotPart(manifest, part);
        }),
      { discard: true },
    );
    yield* store.activateSnapshot(manifest.snapshotId);
  });

export const isSnapshotRequired = (
  error: SnapshotRecoveryError | SyncProtocolError,
): error is SyncProtocolError =>
  error instanceof SyncProtocolError && error.code === "SNAPSHOT_REQUIRED";
