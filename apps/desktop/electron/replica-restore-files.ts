import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { ReplicaWorkerFailure } from "./replica-rpc";

const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];

const twoDigits = (value: number) => String(value).padStart(2, "0");

export const backupFileName = (now: Date): string =>
  `tabaaq-backup-${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}.sqlite`;

const failure = (message: string) => new ReplicaWorkerFailure({ message });

const attempt = <A, R>(work: Effect.Effect<A, unknown, R>, message: string) =>
  Effect.mapError(work, () => failure(message));

const removeAll = Effect.fn("ReplicaRestore.removeAll")(function* (paths: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.forEach(paths, (file) => fs.remove(file, { force: true }).pipe(Effect.ignore), {
    discard: true,
  });
});

const sidecarsOf = (file: string) => SIDECAR_SUFFIXES.map((suffix) => `${file}${suffix}`);

export const removeReplicaFile = (file: string) => removeAll([file, ...sidecarsOf(file)]);

const closedUncleanly = Effect.fn("ReplicaRestore.closedUncleanly")(function* (
  databasePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.stat(`${databasePath}-wal`).pipe(
    Effect.map((wal) => !ByteSize.isZero(wal.size)),
    Effect.orElseSucceed(() => false),
  );
});

export const detachReplicaFile = Effect.fn("ReplicaRestore.detach")(function* (
  databasePath: string,
) {
  if (yield* closedUncleanly(databasePath)) {
    return yield* failure("The workspace did not close cleanly.");
  }
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.forEach(
    sidecarsOf(databasePath),
    (file) => attempt(fs.remove(file, { force: true }), "The workspace file is still in use."),
    { discard: true },
  );
});

export const swapReplicaFile = Effect.fn("ReplicaRestore.swap")(function* (input: {
  readonly databasePath: string;
  readonly stagedPath: string;
  readonly previousPath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* closedUncleanly(input.databasePath)) {
    return yield* failure("The workspace did not close cleanly.");
  }
  yield* attempt(fs.stat(input.stagedPath), "The chosen backup is no longer available.");
  yield* detachReplicaFile(input.databasePath);
  yield* fs
    .link(input.databasePath, input.previousPath)
    .pipe(
      Effect.catch(() =>
        attempt(
          fs.copyFile(input.databasePath, input.previousPath),
          "The current workspace could not be set aside.",
        ),
      ),
    );
  yield* attempt(
    fs.rename(input.stagedPath, input.databasePath),
    "The backup could not be moved into place.",
  ).pipe(Effect.tapError(() => removeAll([input.previousPath])));
});

export const restorePreviousReplicaFile = Effect.fn("ReplicaRestore.putBack")(function* (input: {
  readonly databasePath: string;
  readonly previousPath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  yield* removeAll(sidecarsOf(input.databasePath));
  yield* attempt(
    fs.rename(input.previousPath, input.databasePath),
    "The previous workspace could not be put back.",
  );
});
