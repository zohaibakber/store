import { copyFile, link, rename, rm, stat } from "node:fs/promises";

import * as Effect from "effect/Effect";

import { ReplicaWorkerFailure } from "./replica-rpc";

const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];

const twoDigits = (value: number) => String(value).padStart(2, "0");

export const backupFileName = (now: Date): string =>
  `tabaaq-backup-${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}.sqlite`;

const failure = (message: string) => new ReplicaWorkerFailure({ message });

const attempt = <A>(work: () => Promise<A>, message: string) =>
  Effect.tryPromise({ try: work, catch: () => failure(message) });

const removeAll = (paths: ReadonlyArray<string>) =>
  Effect.forEach(
    paths,
    (file) => Effect.tryPromise(() => rm(file, { force: true })).pipe(Effect.ignore),
    { discard: true },
  );

const sidecarsOf = (file: string) => SIDECAR_SUFFIXES.map((suffix) => `${file}${suffix}`);

export const removeReplicaFile = (file: string): Effect.Effect<void> =>
  removeAll([file, ...sidecarsOf(file)]);

export const swapReplicaFile = Effect.fn("ReplicaRestore.swap")(function* (input: {
  readonly databasePath: string;
  readonly stagedPath: string;
  readonly previousPath: string;
}) {
  const unsettled = yield* Effect.tryPromise(() => stat(`${input.databasePath}-wal`)).pipe(
    Effect.map((wal) => wal.size > 0),
    Effect.orElseSucceed(() => false),
  );
  if (unsettled) return yield* failure("The workspace did not close cleanly.");
  yield* attempt(() => stat(input.stagedPath), "The chosen backup is no longer available.");
  yield* Effect.forEach(
    sidecarsOf(input.databasePath),
    (file) => attempt(() => rm(file, { force: true }), "The workspace file is still in use."),
    { discard: true },
  );
  yield* Effect.tryPromise(() => link(input.databasePath, input.previousPath)).pipe(
    Effect.catch(() =>
      attempt(
        () => copyFile(input.databasePath, input.previousPath),
        "The current workspace could not be set aside.",
      ),
    ),
  );
  yield* attempt(
    () => rename(input.stagedPath, input.databasePath),
    "The backup could not be moved into place.",
  ).pipe(Effect.tapError(() => removeAll([input.previousPath])));
});

export const restorePreviousReplicaFile = Effect.fn("ReplicaRestore.putBack")(function* (input: {
  readonly databasePath: string;
  readonly previousPath: string;
}) {
  yield* removeAll(sidecarsOf(input.databasePath));
  yield* attempt(
    () => rename(input.previousPath, input.databasePath),
    "The previous workspace could not be put back.",
  );
});
