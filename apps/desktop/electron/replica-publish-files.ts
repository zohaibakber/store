import { ImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { detachReplicaFile } from "./replica-restore-files";
import { ReplicaWorkerFailure } from "./replica-rpc";

const MARKER_SUFFIX = ".publishing";

const ARCHIVE_INFIX = ".published-";

const ARCHIVE_NAME = /\.published-(\d{1,16})$/u;

const ARCHIVE_RETENTION_MILLIS = 30 * 24 * 60 * 60_000;

export const PublishMarker = Schema.Struct({
  organizationId: Schema.String,
  importId: ImportId,
  startedAt: Schema.Number,
});
export type PublishMarker = typeof PublishMarker.Type;

const PublishMarkerJson = Schema.fromJsonString(PublishMarker);
const decodeMarker = Schema.decodeUnknownOption(PublishMarkerJson);
const encodeMarker = Schema.encodeSync(PublishMarkerJson);

const encoder = new TextEncoder();

const markerPath = (databasePath: string) => `${databasePath}${MARKER_SUFFIX}`;

const draftPath = (databasePath: string) => `${markerPath(databasePath)}.draft`;

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

export const readPublishMarker = Effect.fn("ReplicaPublish.readMarker")(function* (
  databasePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(markerPath(databasePath)).pipe(
    Effect.map(decodeMarker),
    Effect.orElseSucceed(() => Option.none<PublishMarker>()),
  );
});

export const writePublishMarker = Effect.fn("ReplicaPublish.writeMarker")(
  function* (databasePath: string, marker: PublishMarker) {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const draft = yield* fs.open(draftPath(databasePath), { flag: "w" });
        yield* draft.writeAll(encoder.encode(encodeMarker(marker)));
        yield* draft.sync;
      }),
    );
    yield* fs.rename(draftPath(databasePath), markerPath(databasePath));
  },
  Effect.mapError(() => failure("This device could not record the move. Nothing was moved.")),
);

export const removePublishMarker = Effect.fn("ReplicaPublish.removeMarker")(function* (
  databasePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.forEach(
    [markerPath(databasePath), draftPath(databasePath)],
    (file) => fs.remove(file, { force: true }).pipe(Effect.ignore),
    { discard: true },
  );
});

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
