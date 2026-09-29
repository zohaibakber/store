import {
  PARTITION_DIGEST_VERSION,
  SyncProtocolError,
  type AcquireSnapshotRequest,
  type SnapshotManifest,
} from "@store/contracts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Stream from "effect/Stream";

import type { ReplicaSnapshotImportStore, ReplicaStoreError } from "./replica/store";
import type { SyncTransport, SyncTransportError } from "./transport";

export type SnapshotRecoveryError = SyncTransportError | SyncProtocolError | ReplicaStoreError;

export const SNAPSHOT_PART_FETCH_CONCURRENCY = 4;

type SnapshotPartRef = SnapshotManifest["parts"][number];

const byPartNumber = Order.mapInput(Order.Number, (part: SnapshotPartRef) => part.partNumber);

export const recoverRequiredSnapshot = (
  transport: SyncTransport,
  store: ReplicaSnapshotImportStore,
  request: AcquireSnapshotRequest,
): Effect.Effect<void, SnapshotRecoveryError> =>
  Effect.gen(function* () {
    const acquired = yield* transport.acquireSnapshot({
      ...request,
      digestVersion: PARTITION_DIGEST_VERSION,
    });
    const { manifest } = acquired;
    const progress = yield* store.beginSnapshotImport(manifest);
    const remaining = Arr.sort(
      manifest.parts.filter((part) => part.partNumber > progress.partsImported),
      byPartNumber,
    );
    yield* Stream.fromIterable(remaining).pipe(
      Stream.mapEffect(
        (partRef) => transport.readSnapshotPart(manifest.snapshotId, partRef.partNumber),
        { concurrency: SNAPSHOT_PART_FETCH_CONCURRENCY },
      ),
      Stream.runForEach((part) => store.importSnapshotPart(manifest, part)),
    );
    yield* store.activateSnapshot(manifest.snapshotId);
  });

export const isSnapshotRequired = (
  error: SnapshotRecoveryError | SyncProtocolError,
): error is SyncProtocolError =>
  error instanceof SyncProtocolError && error.code === "SNAPSHOT_REQUIRED";
