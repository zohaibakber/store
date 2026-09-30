import type { SqliteResultRow } from "@store/client-db";
import {
  openReadonlySnapshotRunner,
  readSnapshotBatch,
  readSnapshotSubset,
  readSnapshotSummary,
  type ReplicaSnapshotRunner,
} from "@store/client-db/node-sqlite";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ReplicaReaderRpcs, ReplicaWorkerFailure, type ReplicaReaderBoot } from "./replica-rpc";

const toIpcRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): ReadonlyArray<Record<string, string | number | null>> =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
      ]),
    ),
  );

const stampOf = (stamp: {
  readonly generationId: string;
  readonly localCommitVersion: number;
}) => ({
  generationId: stamp.generationId,
  localCommitVersion: stamp.localCommitVersion,
});

const readFailure = (error: { readonly message: string }) =>
  new ReplicaWorkerFailure({ message: error.message });

export const makeReplicaReaderHandlers = <R>(
  boot: Effect.Effect<typeof ReplicaReaderBoot.Type, unknown, R>,
) =>
  ReplicaReaderRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const opened = yield* openReadonlySnapshotRunner(config.databasePath).pipe(
        Effect.tapError((cause) => Effect.logError("ReplicaReader.open_failed", cause)),
        Effect.option,
      );

      const withSnapshot = <A, E extends { readonly message: string }>(
        use: (snapshot: ReplicaSnapshotRunner, workspaceToken: string) => Effect.Effect<A, E>,
      ): Effect.Effect<A, ReplicaWorkerFailure> =>
        Option.match(opened, {
          onNone: () =>
            Effect.fail(new ReplicaWorkerFailure({ message: "Replica reader is not booted." })),
          onSome: (snapshot) =>
            use(snapshot, config.databasePath).pipe(Effect.mapError(readFailure)),
        });

      return ReplicaReaderRpcs.of({
        Engine: () => Effect.succeed(Option.isSome(opened) ? "sqlite" : "unavailable"),
        ReadSubset: ({ spec }) =>
          withSnapshot((snapshot, workspaceToken) =>
            readSnapshotSubset(snapshot, workspaceToken, spec),
          ).pipe(
            Effect.map((read) => ({ stamp: stampOf(read.stamp), rows: toIpcRows(read.rows) })),
          ),
        ReadBatch: ({ specs }) =>
          withSnapshot((snapshot, workspaceToken) =>
            readSnapshotBatch(snapshot, workspaceToken, specs),
          ).pipe(
            Effect.map((read) => ({
              stamp: stampOf(read.stamp),
              reads: read.reads.map(toIpcRows),
            })),
          ),
        SummarizeSubset: ({ spec }) =>
          withSnapshot((snapshot, workspaceToken) =>
            readSnapshotSummary(snapshot, workspaceToken, spec),
          ).pipe(Effect.map((read) => ({ stamp: stampOf(read.stamp), summary: read.summary }))),
      });
    }),
  );
