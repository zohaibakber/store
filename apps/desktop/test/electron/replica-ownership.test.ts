import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { REPLICA_CLOSE_CHANNEL, REPLICA_OPEN_CHANNEL } from "../../electron/ipc-channels";
import {
  registerReplicaWorkerIpc,
  type ReplicaInvokeEvent,
  type ReplicaIpcListener,
} from "../../electron/replica-ipc";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const allowed = ["https://app.tabaaq.local"];

const decodeOpened = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaceToken: Schema.String,
    engine: Schema.Literals(["sqlite", "unavailable"]),
  }),
);

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

  const listeners = new Map<string, ReplicaIpcListener>();
  const registration = registerReplicaWorkerIpc({
    ipcMain: {
      handle: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeHandler: (channel) => {
        listeners.delete(channel);
      },
    },
    userDataPath: mkdtempSync(path.join(tmpdir(), "store-replica-world-")),
    workerPath: "/tmp/replica-worker.js",
    apiBaseUrl: "https://api.tabaaq.local",
    accessTokens: {
      current: async () => Redacted.make("access-1"),
      subscribe: () => () => undefined,
    },
    allowedOrigins: () => allowed,
    backupDialogs: { chooseDestination: async () => null, chooseSource: async () => null },
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
  });

  const senderEvent = (id: number): ReplicaInvokeEvent => ({
    senderFrame: { url: allowed[0]! },
    sender: {
      id,
      isDestroyed: () => false,
      send: () => undefined,
      on: () => undefined,
      removeListener: () => undefined,
    },
  });
  const invoke = <Input>(channel: string, event: ReplicaInvokeEvent, input: Input) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    // SAFETY: the tests send raw renderer payloads to the IPC decoder.
    return listener(event, input as never);
  };
  const open = async (event: ReplicaInvokeEvent) =>
    decodeOpened(
      await invoke(REPLICA_OPEN_CHANNEL, event, {
        authority: "remote",
        organizationId: "org-1",
        userId: "user-1",
        replicaId: "device-1",
      }),
    );

  return { workers, owners, registration, senderEvent, invoke, open };
};

describe("ownership", () => {
  it("never spawns a second owner while a disposal hangs, then terminates and confirms", async () => {
    const world = makeWorld({
      closeFinalizer: (index, terminated) =>
        index === 0 ? Deferred.await(terminated) : Effect.void,
    });
    const first = world.senderEvent(7);
    const { workspaceToken } = await world.open(first);
    const closing = world.invoke(REPLICA_CLOSE_CHANNEL, first, workspaceToken);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reopening = world.open(world.senderEvent(8));
    await closing;
    await expect(reopening).resolves.toMatchObject({ engine: "sqlite" });
    expect(world.workers).toHaveLength(2);
    expect(world.owners.overlaps).toBe(0);
    await world.registration.dispose();
  });

  it("answers busy instead of overlapping when termination cannot be confirmed", async () => {
    const world = makeWorld({
      closeFinalizer: (index) => (index === 0 ? Effect.never : Effect.void),
      terminateEffect: () => Effect.never,
    });
    const first = world.senderEvent(7);
    const { workspaceToken } = await world.open(first);
    void world.invoke(REPLICA_CLOSE_CHANNEL, first, workspaceToken);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(world.open(world.senderEvent(8))).rejects.toThrow("still closing");
    expect(world.workers).toHaveLength(1);
  });
});
