import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import { decodeOrganizationId, decodeReplicaId, decodeUserId } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { makeReplicaHost } from "../../electron/replica-host";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const makeWorld = Effect.fnUntraced(function* (
  plan: {
    readonly closeFinalizer?: (
      index: number,
      terminated: Deferred.Deferred<void>,
    ) => Effect.Effect<void>;
    readonly terminateEffect?: (index: number) => Effect.Effect<void>;
  } = {},
) {
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

  const userDataPath = yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "store-replica-world-" })),
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
  const close = (id: number, workspaceToken: string) => host.close(id, workspaceToken);

  return { workers, owners, open, close };
});

describe("ownership", () => {
  it.effect(
    "never spawns a second owner while a disposal hangs, then terminates and confirms",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld({
          closeFinalizer: (index, terminated) =>
            index === 0 ? Deferred.await(terminated) : Effect.void,
        });
        const { workspaceToken } = yield* world.open(7);
        const closing = yield* Effect.forkChild(world.close(7, workspaceToken));
        yield* TestClock.adjust("20 millis");
        const reopening = yield* Effect.forkChild(world.open(8));
        yield* TestClock.adjust("100 millis");
        yield* Fiber.join(closing);
        expect(yield* Fiber.join(reopening)).toMatchObject({ engine: "sqlite" });
        expect(world.workers).toHaveLength(2);
        expect(world.owners.overlaps).toBe(0);
      }),
  );

  it.effect("answers busy instead of overlapping when termination cannot be confirmed", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld({
        closeFinalizer: (index) => (index === 0 ? Effect.never : Effect.void),
        terminateEffect: () => Effect.never,
      });
      const { workspaceToken } = yield* world.open(7);
      yield* Effect.forkChild(world.close(7, workspaceToken));
      yield* TestClock.adjust("80 millis");
      const reopening = yield* Effect.forkChild(Effect.flip(world.open(8)));
      yield* TestClock.adjust("150 millis");
      expect(yield* Fiber.join(reopening)).toMatchObject({
        message: expect.stringContaining("still closing"),
      });
      expect(world.workers).toHaveLength(1);
    }),
  );
});
