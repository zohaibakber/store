import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import { ImportId } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { detachReplicaFile } from "./replica-restore-files";
import { ReplicaPublishSeal, ReplicaWorkerFailure } from "./replica-rpc";

const MARKER_SUFFIX = ".publishing";

const ARCHIVE_INFIX = ".published-";

const ARCHIVE_NAME = /\.published-(\d{1,16})$/u;

const ARCHIVE_RETENTION_MILLIS = 30 * 24 * 60 * 60_000;

export const PublishMarker = Schema.Struct({
  organizationId: Schema.String,
  importId: ImportId,
  seal: ReplicaPublishSeal,
  startedAt: Schema.Number,
});
export type PublishMarker = typeof PublishMarker.Type;

const PublishMarkerJson = Schema.fromJsonString(PublishMarker);
const decodeMarker = Schema.decodeUnknownOption(PublishMarkerJson);
const encodeMarker = Schema.encodeSync(PublishMarkerJson);

const markerPath = (databasePath: string) => `${databasePath}${MARKER_SUFFIX}`;

const draftPath = (databasePath: string) => `${markerPath(databasePath)}.draft`;

const failure = (message: string) => new ReplicaWorkerFailure({ message });

export const replicaFileExists = (databasePath: string): Effect.Effect<boolean> =>
  Effect.tryPromise(() => stat(databasePath)).pipe(
    Effect.map((file) => file.isFile()),
    Effect.orElseSucceed(() => false),
  );

export const readPublishMarker = (
  databasePath: string,
): Effect.Effect<Option.Option<PublishMarker>> =>
  Effect.tryPromise(() => readFile(markerPath(databasePath), "utf8")).pipe(
    Effect.map(decodeMarker),
    Effect.orElseSucceed(() => Option.none()),
  );

export const writePublishMarker = (databasePath: string, marker: PublishMarker) =>
  Effect.tryPromise({
    try: async () => {
      await writeFile(draftPath(databasePath), encodeMarker(marker), { flush: true });
      await rename(draftPath(databasePath), markerPath(databasePath));
    },
    catch: () => failure("This device could not record the move. Nothing was moved."),
  });

export const removePublishMarker = (databasePath: string): Effect.Effect<void> =>
  Effect.forEach(
    [markerPath(databasePath), draftPath(databasePath)],
    (file) => Effect.tryPromise(() => rm(file, { force: true })).pipe(Effect.ignore),
    { discard: true },
  );

const archivedReplicaPath = (databasePath: string, now: number): string =>
  `${databasePath}${ARCHIVE_INFIX}${now}`;

export const archiveReplicaFile = Effect.fn("ReplicaPublish.archive")(function* (input: {
  readonly databasePath: string;
  readonly now: number;
}) {
  if (!(yield* replicaFileExists(input.databasePath))) return;
  yield* detachReplicaFile(input.databasePath);
  yield* Effect.tryPromise({
    try: () => rename(input.databasePath, archivedReplicaPath(input.databasePath, input.now)),
    catch: () => failure("This device's copy could not be set aside."),
  });
});

export const isExpiredReplicaArchive = (name: string, now: number): boolean => {
  const archivedAt = ARCHIVE_NAME.exec(name)?.[1];
  return archivedAt !== undefined && now - Number(archivedAt) > ARCHIVE_RETENTION_MILLIS;
};
