import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
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

const makeWorld = (
  plan: {
    readonly closeFinalizer?: (
      index: number,
      terminated: Deferred.Deferred<void>,
    ) => Effect.Effect<void>;
    readonly terminateEffect?: (index: number) => Effect.Effect<void>;
  } = {},
) => {
  const workers: Array<number> = [];
  const owners = { live: 0, overlaps: 0 };

  const spawnReader: SpawnReplicaReader = () =>
    Effect.gen(function* () {
      const lost = yield* Deferred.make<void>();
      const handlers = ReplicaReaderRpcs.toLayer({
        Engine: () => Effect.succeed("sqlite" as const),
        AttachRenderer: () => Effect.void,
        SummarizeSubset: () => Effect.die("unused"),
      });
      const client = yield* RpcTest.makeClient(ReplicaReaderRpcs).pipe(Effect.provide(handlers));
      return {
        client,
        lost: Deferred.await(lost),
        terminate: Deferred.succeed(lost, undefined).pipe(Effect.asVoid),
      };
    });

  const spawnWorker: SpawnReplicaWorker = () =>
    Effect.gen(function* () {
      const index = workers.length;
      const lost = yield* Deferred.make<void>();
      const terminated = yield* Deferred.make<void>();
      const handlers = ReplicaWorkerRpcs.toLayer({
        Engine: () => Effect.succeed("sqlite" as const),
        AttachRenderer: () => Effect.void,
        Stamp: () => Effect.succeed({ generationId: "1", localCommitVersion: 0 }),
        SetForeground: () => Effect.void,
        BackUp: () => Effect.die("unused"),
        StageRestore: () => Effect.die("unused"),
        ReleaseForRestore: () => Effect.die("unused"),
        PublishSummary: () => Effect.die("unused"),
        PublishStage: () => Stream.die("unused"),
        PublishCommit: () => Effect.die("unused"),
        PublishStatus: () => Effect.die("unused"),
        Commits: () => Stream.never,
        SyncHealth: () => Stream.make({ _tag: "running" as const }),
        SetAccessToken: () => Effect.void,
        SetLicence: () => Effect.void,
        DatabaseShop: () => Effect.succeed({ shopId: null }),
      });
      const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(Effect.provide(handlers));
      if (owners.live > 0) owners.overlaps += 1;
      owners.live += 1;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          owners.live -= 1;
        }),
      );
      yield* Effect.addFinalizer(() => plan.closeFinalizer?.(index, terminated) ?? Effect.void);
      workers.push(index);
      return {
        client,
        lost: Deferred.await(lost),
        terminate:
          plan.terminateEffect?.(index) ??
          Deferred.succeed(terminated, undefined).pipe(
            Effect.andThen(Deferred.succeed(lost, undefined)),
            Effect.asVoid,
          ),
      };
    });

  const runtime = ManagedRuntime.make(
    Layer.effect(
      ReplicaHost,
      makeReplicaHost({
        userDataPath: mkdtempSync(path.join(tmpdir(), "store-replica-world-")),
        workerPath: "/tmp/replica-worker.js",
        apiBaseUrl: "https://api.tabaaq.local",
        accessTokens: {
          liveAccessToken: () => Effect.succeed(Redacted.make("access-1")),
          accessTokens: Stream.never,
        },
        backupDialogs: { chooseDestination: async () => null, chooseSource: async () => null },
        publishProgress: () => Effect.void,
        sessions: {
          spawnWorker,
          spawnReader,
          supervisorPolicy: {
            retryDelay: Duration.millis(10),
            stableAfter: Duration.millis(60),
            bootTimeout: Duration.millis(500),
            requestWait: Duration.millis(1_000),
          },
          closeGrace: Duration.millis(50),
          ownershipWait: Duration.millis(150),
        },
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer)),
  );

  const sender = (id: number) => ({
    id,
    isDestroyed: () => false,
    on: () => undefined,
    removeListener: () => undefined,
  });
  const open = (id: number) =>
    runtime.runPromise(
      ReplicaHost.use((replicas) =>
        replicas.open(sender(id), {
          authority: "remote",
          organizationId: "org-1",
          userId: "user-1",
          replicaId: "device-1",
        }),
      ),
    );
  const close = (id: number, workspaceToken: string) =>
    runtime.runPromise(ReplicaHost.use((replicas) => replicas.close(id, workspaceToken)));

  return { workers, owners, dispose: () => runtime.dispose(), open, close };
};

describe("ownership", () => {
  it("never spawns a second owner while a disposal hangs, then terminates and confirms", async () => {
    const world = makeWorld({
      closeFinalizer: (index, terminated) =>
        index === 0 ? Deferred.await(terminated) : Effect.void,
    });
    const { workspaceToken } = await world.open(7);
    const closing = world.close(7, workspaceToken);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reopening = world.open(8);
    await closing;
    await expect(reopening).resolves.toMatchObject({ engine: "sqlite" });
    expect(world.workers).toHaveLength(2);
    expect(world.owners.overlaps).toBe(0);
    await world.dispose();
  });

  it("answers busy instead of overlapping when termination cannot be confirmed", async () => {
    const world = makeWorld({
      closeFinalizer: (index) => (index === 0 ? Effect.never : Effect.void),
      terminateEffect: () => Effect.never,
    });
    const { workspaceToken } = await world.open(7);
    void world.close(7, workspaceToken);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(world.open(8)).rejects.toThrow("still closing");
    expect(world.workers).toHaveLength(1);
  });
});
