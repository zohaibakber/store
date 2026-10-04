import {
  layerNodeSqliteReadonlyReplica,
  openReadonlySnapshotRunner,
  type NodeSqliteRow,
  readSnapshotSummary,
  type ReplicaSnapshotRunner,
} from "@store/client-db/node-sqlite";
import { layerInventoryReads } from "@store/client-db/reads";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcServer from "effect/rpc/RpcServer";

import { ReadDeadline, readDeadline, TimedInventoryReads } from "./renderer-read-deadline";
import { makeRendererServers, noRendererServers } from "./renderer-servers";
import {
  commitStampOf,
  ReplicaReaderRpcs,
  ReplicaWorkerFailure,
  type ReplicaReaderBoot,
} from "./replica-rpc";

const readFailure = (error: { readonly message: string }) =>
  new ReplicaWorkerFailure({ message: error.message });

export const makeReplicaReaderHandlers = <R>(
  boot: Effect.Effect<typeof ReplicaReaderBoot.Type, unknown, R>,
) =>
  ReplicaReaderRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const booted = yield* Effect.all({
        snapshot: openReadonlySnapshotRunner(config.databasePath),
        reads: Layer.build(
          layerInventoryReads.pipe(
            Layer.provide(layerNodeSqliteReadonlyReplica(config.databasePath)),
          ),
        ).pipe(Effect.catchDefect(Effect.fail)),
      }).pipe(
        Effect.tapError((cause) => Effect.logError("ReplicaReader.open_failed", cause)),
        Effect.option,
      );
      const opened = Option.map(booted, (reader) => reader.snapshot);
      const renderers = Option.isNone(booted)
        ? noRendererServers
        : yield* makeRendererServers((protocol) =>
            RpcServer.layer(TimedInventoryReads).pipe(
              Layer.provide(Layer.succeedContext(booted.value.reads)),
              Layer.provide(Layer.succeed(ReadDeadline, readDeadline)),
              Layer.provide(protocol),
            ),
          );

      const withSnapshot = <A, E extends { readonly message: string }>(
        use: (
          snapshot: ReplicaSnapshotRunner<NodeSqliteRow>,
          workspaceToken: string,
        ) => Effect.Effect<A, E>,
      ): Effect.Effect<A, ReplicaWorkerFailure> =>
        Option.match(opened, {
          onNone: () =>
            Effect.fail(new ReplicaWorkerFailure({ message: "Replica reader is not booted." })),
          onSome: (snapshot) =>
            use(snapshot, config.databasePath).pipe(Effect.mapError(readFailure)),
        });

      return ReplicaReaderRpcs.of({
        Engine: () => Effect.succeed(Option.isSome(opened) ? "sqlite" : "unavailable"),
        AttachRenderer: ({ port }) => renderers.attach(port),
        SummarizeSubset: ({ spec }) =>
          withSnapshot((snapshot, workspaceToken) =>
            readSnapshotSummary(snapshot, workspaceToken, spec),
          ).pipe(
            Effect.map((read) => ({ stamp: commitStampOf(read.stamp), summary: read.summary })),
          ),
      });
    }),
  );
