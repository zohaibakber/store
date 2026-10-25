import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import { makeReplicaHost, ReplicaHost } from "../../electron/replica-host";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const setupHost = () => {
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
  const runtime = ManagedRuntime.make(
    Layer.effect(
      ReplicaHost,
      makeReplicaHost({
        userDataPath: mkdtempSync(path.join(tmpdir(), "store-replica-test-")),
        workerPath: "/tmp/replica-worker.js",
        apiBaseUrl: "https://api.tabaaq.local",
        accessTokens: {
          liveAccessToken: () => Effect.succeed(Redacted.make("access-1")),
          accessTokens: Stream.never,
        },
        backupDialogs: { chooseDestination: async () => null, chooseSource: async () => null },
        publishProgress: () => Effect.void,
        sessions: { spawnWorker, spawnReader },
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer)),
  );
  const sender = (id: number) => ({
    id,
    isDestroyed: () => false,
    on: () => undefined,
    removeListener: () => undefined,
  });
  const use = <A>(use: (replicas: ReplicaHost["Service"]) => Effect.Effect<A, unknown>) =>
    runtime.runPromise(ReplicaHost.use(use));
  const open = (id: number) =>
    use((replicas) =>
      replicas.open(sender(id), {
        authority: "remote",
        organizationId: "org-1",
        userId: "user-1",
        replicaId: "device-1",
      }),
    );
  return { dispose: () => runtime.dispose(), use, open };
};

describe("replica host", () => {
  it("rejects replica commands from a different renderer", async () => {
    const { dispose, use, open } = setupHost();
    const { workspaceToken } = await open(7);
    await expect(use((replicas) => replicas.retryRecovery(9, workspaceToken))).rejects.toThrow(
      "Rejected replica recovery retry from a different renderer.",
    );
    await expect(use((replicas) => replicas.close(9, workspaceToken))).rejects.toThrow(
      "Rejected replica close from a different renderer.",
    );
    await expect(
      use((replicas) => replicas.retryRecovery(7, "00000000-0000-4000-8000-000000000000")),
    ).rejects.toThrow("Unknown replica workspace.");
    await dispose();
  });
});
