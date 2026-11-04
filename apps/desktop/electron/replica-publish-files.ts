import { ImportId, OrganizationId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PrivateFiles } from "./private-files";
import { detachReplicaFile } from "./replica-restore-files";
import { ReplicaWorkerFailure } from "./replica-rpc";

const MARKER_SUFFIX = ".publishing";

const ARCHIVE_INFIX = ".published-";

const ARCHIVE_NAME = /\.published-(\d{1,16})$/u;

const ARCHIVE_RETENTION_MILLIS = 30 * 24 * 60 * 60_000;

export const PublishMarker = Schema.Struct({
  organizationId: OrganizationId,
  importId: ImportId,
  startedAt: Schema.Number,
});
export type PublishMarker = typeof PublishMarker.Type;

const PublishMarkerJson = Schema.fromJsonString(PublishMarker);
const decodeMarker = Schema.decodeUnknownOption(PublishMarkerJson);
const encodeMarker = Schema.encodeSync(PublishMarkerJson);

const markerPath = (databasePath: string) => `${databasePath}${MARKER_SUFFIX}`;

const failure = (message: string) => new ReplicaWorkerFailure({ message });

export const replicaFileExists = Effect.fn("ReplicaPublish.exists")(function* (
  databasePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.stat(databasePath).pipe(
    Effect.map((file) => file.type === "File"),
    Effect.orElseSucceed(() => false),
  );
});

export type PublishMarkers = {
  readonly read: Effect.Effect<Option.Option<PublishMarker>>;
  readonly write: (marker: PublishMarker) => Effect.Effect<void, ReplicaWorkerFailure>;
  readonly remove: Effect.Effect<void>;
};

export const publishMarkers = (
  files: PrivateFiles["Service"],
  databasePath: string,
): PublishMarkers => {
  const file = markerPath(databasePath);
  return {
    read: files.readText(file).pipe(
      Effect.map(Option.flatMap(decodeMarker)),
      Effect.orElseSucceed(() => Option.none<PublishMarker>()),
    ),
    write: Effect.fn("ReplicaPublish.writeMarker")(
      (marker: PublishMarker) => files.replaceText(file, encodeMarker(marker)),
      Effect.mapError(() => failure("This device could not record the move. Nothing was moved.")),
    ),
    remove: Effect.ignore(files.remove(file)),
  };
};

const archivedReplicaPath = (databasePath: string, now: number): string =>
  `${databasePath}${ARCHIVE_INFIX}${now}`;

export const archiveReplicaFile = Effect.fn("ReplicaPublish.archive")(function* (input: {
  readonly databasePath: string;
  readonly now: number;
}) {
  if (!(yield* replicaFileExists(input.databasePath))) return;
  yield* detachReplicaFile(input.databasePath);
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .rename(input.databasePath, archivedReplicaPath(input.databasePath, input.now))
    .pipe(Effect.mapError(() => failure("This device's copy could not be set aside.")));
});

export const isExpiredReplicaArchive = (name: string, now: number): boolean => {
  const archivedAt = ARCHIVE_NAME.exec(name)?.[1];
  return archivedAt !== undefined && now - Number(archivedAt) > ARCHIVE_RETENTION_MILLIS;
};
