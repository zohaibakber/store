import {
  compareDecimalSequence,
  OrgCommitSequence,
  SyncProtocolError,
  syncProtocolError,
  type AcquireSnapshotRequest,
  type SnapshotManifest,
} from "@store/contracts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Stream from "effect/Stream";

import { isStorageFullFailure } from "./replica/errors";
import type {
  ReplicaSnapshotImportStore,
  ReplicaStoreError,
  SnapshotActivation,
} from "./replica/store";
import { SyncTransportUnavailable, type SyncTransport, type SyncTransportError } from "./transport";

export type SnapshotRecoveryError = SyncTransportError | SyncProtocolError | ReplicaStoreError;

const SNAPSHOT_PART_FETCH_CONCURRENCY = 12;

const SNAPSHOT_STORAGE_RETRY_MILLIS = 10 * 60_000;

type SnapshotPartRef = SnapshotManifest["parts"][number];

const byPartNumber = Order.mapInput(Order.Number, (part: SnapshotPartRef) => part.partNumber);

type AuthorityGap = Extract<SnapshotActivation, { readonly _tag: "needsAuthority" }>;

const catchUpCandidate = (
  transport: SyncTransport,
  store: ReplicaSnapshotImportStore,
  request: AcquireSnapshotRequest,
  manifest: SnapshotManifest,
  gap: AuthorityGap,
) =>
  Stream.paginate(gap.afterCommitSequence, (after) =>
    transport
      .pull({
        epoch: request.epoch,
        subscription: request.subscription,
        afterCommitSequence: OrgCommitSequence.make(after),
      })
      .pipe(
        Effect.flatMap((page) => store.applyCandidateAuthority(manifest.snapshotId, page)),
        Effect.flatMap((through) =>
          compareDecimalSequence(through, after) <= 0
            ? Effect.fail(
                syncProtocolError(
                  "SNAPSHOT_UNAVAILABLE",
                  "The authority history does not reach the replica position.",
                ),
              )
            : Effect.succeed([
                [through],
                compareDecimalSequence(through, gap.throughCommitSequence) >= 0
                  ? Option.none<string>()
                  : Option.some(through),
              ] as const),
        ),
      ),
  ).pipe(Stream.runDrain);

const activateCandidate = (
  transport: SyncTransport,
  store: ReplicaSnapshotImportStore,
  request: AcquireSnapshotRequest,
  manifest: SnapshotManifest,
) =>
  Effect.repeat(
    store
      .activateSnapshot(manifest.snapshotId)
      .pipe(
        Effect.tap(({ value }) =>
          value._tag === "needsAuthority"
            ? catchUpCandidate(transport, store, request, manifest, value)
            : Effect.void,
        ),
      ),
    { until: ({ value }) => value._tag === "activated" },
  );

const abandonedCandidate = (message: string) =>
  syncProtocolError("SNAPSHOT_REQUIRED", `${message} A fresh snapshot will be requested.`);

const abandonOnInvalidCandidate = (
  store: ReplicaSnapshotImportStore,
  manifest: SnapshotManifest,
  error: SnapshotRecoveryError,
): Effect.Effect<never, SnapshotRecoveryError> => {
  const abandon = store.abandonSnapshot(manifest.snapshotId).pipe(Effect.ignore);
  if (isStorageFullFailure(error)) {
    return abandon.pipe(
      Effect.andThen(
        Effect.fail(
          SyncTransportUnavailable.make({
            message: "Local storage is full; snapshot preparation was cancelled.",
            retryAfterMillis: SNAPSHOT_STORAGE_RETRY_MILLIS,
          }),
        ),
      ),
    );
  }
  if (
    error instanceof SyncProtocolError &&
    (error.code === "SNAPSHOT_UNAVAILABLE" || error.code === "SNAPSHOT_REQUIRED")
  ) {
    return abandon.pipe(Effect.andThen(Effect.fail(abandonedCandidate(error.message))));
  }
  return Effect.fail(error);
};

const importCandidate = (
  transport: SyncTransport,
  store: ReplicaSnapshotImportStore,
  request: AcquireSnapshotRequest,
  manifest: SnapshotManifest,
) =>
  store.beginSnapshotImport(manifest).pipe(
    Effect.flatMap((progress) =>
      Stream.fromIterable(
        Arr.sort(
          manifest.parts.filter((part) => part.partNumber > progress.partsImported),
          byPartNumber,
        ),
      ).pipe(
        Stream.mapEffect(
          (partRef) => transport.readSnapshotPart(manifest.snapshotId, partRef.partNumber),
          { concurrency: SNAPSHOT_PART_FETCH_CONCURRENCY },
        ),
        Stream.runForEach((part) => store.importSnapshotPart(manifest, part)),
      ),
    ),
    Effect.andThen(activateCandidate(transport, store, request, manifest)),
  );

export const recoverRequiredSnapshot = (
  transport: SyncTransport,
  store: ReplicaSnapshotImportStore,
  request: AcquireSnapshotRequest,
): Effect.Effect<void, SnapshotRecoveryError> =>
  transport.acquireSnapshot(request).pipe(
    Effect.flatMap(({ manifest }) =>
      importCandidate(transport, store, request, manifest).pipe(
        Effect.scoped,
        Effect.catch((error: SnapshotRecoveryError) =>
          abandonOnInvalidCandidate(store, manifest, error),
        ),
      ),
    ),
    Effect.asVoid,
  );

export const isSnapshotRequired = (
  error: SnapshotRecoveryError | SyncProtocolError,
): error is SyncProtocolError =>
  error instanceof SyncProtocolError && error.code === "SNAPSHOT_REQUIRED";
