import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { describe, expect, it, vi } from "vitest";

import {
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  type ReplicaAnalyticsEvent,
  type ReplicaCommitEvent,
  type ReplicaSyncHealthEvent,
} from "../../electron/replica-channels";
import {
  registerReplicaWorkerIpc,
  type ReplicaInvokeEvent,
  type ReplicaIpcListener,
} from "../../electron/replica-ipc";
import {
  ReplicaReaderRpcs,
  ReplicaWorkerRpcs,
  type ReplicaReaderBoot,
  type ReplicaWorkerBoot,
} from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const allowed = ["https://app.tabaaq.local"];

const decodeOpened = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaceToken: Schema.String,
    engine: Schema.Literals(["sqlite", "unavailable"]),
  }),
);

type Commit = {
  readonly generationId: string;
  readonly localCommitVersion: number;
  readonly touchedEntities: ReadonlyArray<string>;
  readonly touchedKeys: ReadonlyArray<string>;
};

type FakeWorker = {
  readonly boot: typeof ReplicaWorkerBoot.Type;
  readonly commits: Queue.Queue<Commit>;
  readonly kill: Effect.Effect<void>;
};

const makeWorld = (
  plan: {
    readonly closeFinalizer?: (
      index: number,
      terminated: Deferred.Deferred<void>,
    ) => Effect.Effect<void>;
    readonly terminateEffect?: (index: number) => Effect.Effect<void>;
    readonly readerCloseFinalizer?: (
      index: number,
      terminated: Deferred.Deferred<void>,
    ) => Effect.Effect<void>;
  } = {},
) => {
  const workers: Array<FakeWorker> = [];
  const readers: Array<typeof ReplicaReaderBoot.Type> = [];

  const spawnReader: SpawnReplicaReader = ({ boot }) =>
    Effect.gen(function* () {
      const index = readers.length;
      const lost = yield* Deferred.make<void>();
      const terminated = yield* Deferred.make<void>();
      const handlers = ReplicaReaderRpcs.toLayer({
        Engine: () => Effect.succeed("sqlite" as const),
        ReadSubset: () => Effect.die("unused"),
        ReadBatch: () => Effect.die("unused"),
        SummarizeSubset: () => Effect.die("unused"),
      });
      const client = yield* RpcTest.makeClient(ReplicaReaderRpcs).pipe(Effect.provide(handlers));
      yield* Effect.addFinalizer(
        () => plan.readerCloseFinalizer?.(index, terminated) ?? Effect.void,
      );
      readers.push(boot);
      return {
        client,
        lost: Deferred.await(lost),
        terminate: Deferred.succeed(terminated, undefined).pipe(
          Effect.andThen(Deferred.succeed(lost, undefined)),
          Effect.asVoid,
        ),
      };
    });
  const stamp = { generationId: "1", localCommitVersion: 0 };

  const spawnWorker: SpawnReplicaWorker = ({ boot }) =>
    Effect.gen(function* () {
      const index = workers.length;
      const lost = yield* Deferred.make<void>();
      const terminated = yield* Deferred.make<void>();
      const commits = yield* Queue.unbounded<Commit>();
      const handlers = ReplicaWorkerRpcs.toLayer({
        Engine: () => Effect.succeed("sqlite" as const),
        Stamp: () =>
          Effect.raceFirst(
            Effect.succeed(stamp),
            Deferred.await(lost).pipe(Effect.andThen(Effect.never)),
          ),
        ReadInsights: () => Effect.die("unused"),
        ReadOutboxStatuses: () => Effect.die("unused"),
        EnqueueCommand: () => Effect.die("unused"),
        ReadCommandStatus: () => Effect.die("unused"),
        SetForeground: () => Effect.void,
        WakeSyncUpload: () => Effect.die("unused"),
        Commits: () => Stream.fromQueue(commits),
        SyncHealth: () => Stream.make({ _tag: "running" as const }),
        ProxyRequests: () => Stream.never,
        ProxyRespond: () => Effect.void,
        AccessTokenRequests: () => Stream.never,
        AccessTokenRespond: () => Effect.void,
      });
      const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(Effect.provide(handlers));
      yield* Effect.addFinalizer(() => plan.closeFinalizer?.(index, terminated) ?? Effect.void);
      workers.push({ boot, commits, kill: Deferred.succeed(lost, undefined).pipe(Effect.asVoid) });
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
    syncApiRequest: async () => ({ ok: true, status: 200, bodyText: "{}" }),
    liveAccessToken: async () => "access-1",
    allowedOrigins: () => allowed,
    spawnWorker,
    spawnReader,
    supervisorPolicy: {
      retryDelay: Duration.millis(10),
      stableAfter: Duration.millis(60),
      bootTimeout: Duration.millis(500),
      requestWait: Duration.millis(1_000),
    },
    admissionLimits: { turnWait: Duration.millis(2_000), turnRun: Duration.millis(2_000) },
    closeGrace: Duration.millis(50),
    ownershipWait: Duration.millis(150),
  });

  const sent: Array<{
    readonly channel: string;
    readonly event: ReplicaCommitEvent | ReplicaSyncHealthEvent | ReplicaAnalyticsEvent;
  }> = [];
  const senderEvent = (id: number): ReplicaInvokeEvent => ({
    senderFrame: { url: allowed[0]! },
    sender: {
      id,
      isDestroyed: () => false,
      send: (channel, event) => {
        sent.push({ channel, event });
      },
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
        organizationId: "org-1",
        userId: "user-1",
        replicaId: "device-1",
      }),
    );

  return { workers, readers, registration, sent, senderEvent, invoke, open };
};

describe("worker incarnation fencing", () => {
  it("respawns a killed worker with the same boot, reattaches streams and invalidates the renderer", async () => {
    const world = makeWorld();
    const event = world.senderEvent(7);
    const { workspaceToken } = await world.open(event);
    expect(world.workers).toHaveLength(1);
    await Effect.runPromise(world.workers[0]!.kill);
    await vi.waitFor(() => expect(world.workers).toHaveLength(2));
    expect(world.workers[1]!.boot).toEqual(world.workers[0]!.boot);
    await vi.waitFor(() =>
      expect(
        world.sent.some(
          (message) =>
            message.channel === REPLICA_COMMIT_CHANNEL &&
            "fullInvalidation" in message.event &&
            message.event.fullInvalidation === true,
        ),
      ).toBe(true),
    );
    const commit = (version: number) => ({
      generationId: "1",
      localCommitVersion: version,
      touchedEntities: ["category"],
      touchedKeys: ["category:c-1"],
    });
    await Effect.runPromise(Queue.offer(world.workers[0]!.commits, commit(9)));
    await Effect.runPromise(Queue.offer(world.workers[1]!.commits, commit(5)));
    const versions = () =>
      world.sent.flatMap((message) =>
        message.channel === REPLICA_COMMIT_CHANNEL && "localCommitVersion" in message.event
          ? [message.event.localCommitVersion]
          : [],
      );
    await vi.waitFor(() => expect(versions()).toContain(5));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(versions()).not.toContain(9);
    await expect(world.invoke(REPLICA_STAMP_CHANNEL, event, workspaceToken)).resolves.toEqual({
      generationId: "1",
      localCommitVersion: 0,
    });
    await world.registration.dispose();
  });
});

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
    expect(world.workers).toHaveLength(1);
    const reopening = world.open(world.senderEvent(8));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.workers).toHaveLength(1);
    await closing;
    await expect(reopening).resolves.toMatchObject({ engine: "sqlite" });
    expect(world.workers).toHaveLength(2);
    await world.registration.dispose();
  });

  it("never opens a second reader while the previous reader's disposal hangs", async () => {
    const world = makeWorld({
      readerCloseFinalizer: (index, terminated) =>
        index === 0 ? Deferred.await(terminated) : Effect.void,
    });
    const first = world.senderEvent(7);
    const { workspaceToken } = await world.open(first);
    expect(world.readers).toHaveLength(1);
    const closing = world.invoke(REPLICA_CLOSE_CHANNEL, first, workspaceToken);
    const reopening = world.open(world.senderEvent(8));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.workers).toHaveLength(1);
    expect(world.readers).toHaveLength(1);
    await closing;
    await expect(reopening).resolves.toMatchObject({ engine: "sqlite" });
    expect(world.readers).toHaveLength(2);
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
