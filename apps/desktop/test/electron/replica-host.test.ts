import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import { decodeOrganizationId, decodeReplicaId, decodeUserId } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Stream from "effect/Stream";

import { makeReplicaHost } from "../../electron/replica-host";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const setupHost = Effect.gen(function* () {
  const handlers = ReplicaWorkerRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    AttachRenderer: () => Effect.void,
    Stamp: () => Effect.die("unused"),
    SetForeground: () => Effect.void,
    BackUp: () => Effect.die("unused"),
    StageRestore: () => Effect.die("unused"),
    ReleaseForRestore: () => Effect.die("unused"),
    PublishSummary: () => Effect.die("unused"),
    PublishStage: () => Stream.die("unused"),
    PublishCommit: () => Effect.die("unused"),
    PublishStatus: () => Effect.die("unused"),
    Commits: () => Stream.never,
    SyncHealth: () => Stream.never,
    SetAccessToken: () => Effect.void,
    SetLicence: () => Effect.void,
    DatabaseShop: () => Effect.succeed({ shopId: null }),
  });
  const readerHandlers = ReplicaReaderRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    AttachRenderer: () => Effect.void,
    SummarizeSubset: () => Effect.die("unused"),
  });
  const spawnReader: SpawnReplicaReader = () =>
    Effect.gen(function* () {
      const lost = yield* Deferred.make<void>();
      const client = yield* RpcTest.makeClient(ReplicaReaderRpcs).pipe(
        Effect.provide(readerHandlers),
      );
      return {
        client,
        lost: Deferred.await(lost),
        terminate: Deferred.succeed(lost, undefined).pipe(Effect.asVoid),
      };
    });
  const spawnWorker: SpawnReplicaWorker = () =>
    Effect.gen(function* () {
      const lost = yield* Deferred.make<void>();
      const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(Effect.provide(handlers));
      return {
        client,
        lost: Deferred.await(lost),
        terminate: Deferred.succeed(lost, undefined).pipe(Effect.asVoid),
      };
    });
  const userDataPath = yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "store-replica-test-" })),
    Effect.provide(NodeFileSystem.layer),
  );
  const host = yield* makeReplicaHost({
    userDataPath,
    workerPath: "/tmp/replica-worker.js",
    apiBaseUrl: "https://api.tabaaq.local",
    accessTokens: {
      liveAccessToken: () => Effect.succeed(Redacted.make("access-1")),
      accessTokens: Stream.never,
    },
    dialogs: {
      chooseBackupDestination: () => Effect.succeed(Option.none()),
      chooseBackupSource: Effect.succeed(Option.none()),
    },
    publishProgress: () => Effect.void,
    sessions: { spawnWorker, spawnReader },
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodeCrypto.layer)));
  const sender = (id: number) => ({
    id,
    isDestroyed: () => false,
    on: () => undefined,
    removeListener: () => undefined,
  });
  const open = (id: number) =>
    host.open(sender(id), {
      authority: "remote",
      organizationId: decodeOrganizationId("org-1"),
      userId: decodeUserId("user-1"),
      replicaId: decodeReplicaId("device-1"),
    });
  return { host, open };
});

describe("replica host", () => {
  it.effect("rejects replica commands from a different renderer", () =>
    Effect.gen(function* () {
      const { host, open } = yield* setupHost;
      const { workspaceToken } = yield* open(7);
      expect(yield* Effect.flip(host.retryRecovery(9, workspaceToken))).toMatchObject({
        message: "Rejected replica recovery retry from a different renderer.",
      });
      expect(yield* Effect.flip(host.close(9, workspaceToken))).toMatchObject({
        message: "Rejected replica close from a different renderer.",
      });
      expect(
        yield* Effect.flip(host.retryRecovery(7, "00000000-0000-4000-8000-000000000000")),
      ).toMatchObject({ message: "Unknown replica workspace." });
    }),
  );
});
