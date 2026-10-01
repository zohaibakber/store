import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { describe, expect, it, vi } from "vitest";

import { assertTrustedIpcSender, isTrustedIpcSenderFrame } from "../../electron/ipc-sender";
import {
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_READ_BATCH_CHANNEL,
  REPLICA_READ_INSIGHTS_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_SUMMARIZE_SUBSET_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  type ReplicaCommitEvent,
  type ReplicaAnalyticsEvent,
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
  type ProxyFetchResult,
  type ReplicaReaderBoot,
  type ReplicaWorkerBoot,
} from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const allowed = ["https://app.tabaaq.local"];

const enqueueRequest = {
  operationId: "op-1",
  occurredAt: 1,
  command: {
    _tag: "catalogWrite",
    payload: {
      commandId: "op-1",
      deviceId: "device-1",
      occurredAt: 1,
      writes: [
        {
          entity: "category",
          action: "upsert",
          id: "22222222-2222-4222-8222-222222222222",
          expectedRowVersion: null,
          row: { name: "Tea", tracksPacks: true },
        },
      ],
    },
  },
};

const openInput = {
  authority: "remote",
  organizationId: "org-1",
  userId: "user-1",
  replicaId: "device-1",
};

const decodeOpened = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaceToken: Schema.String,
    engine: Schema.Literals(["sqlite", "unavailable"]),
  }),
);

const setupIpc = () => {
  const boots: Array<typeof ReplicaWorkerBoot.Type> = [];
  const proxyReplies: Array<{ readonly requestId: string; readonly result: ProxyFetchResult }> = [];
  const tokenReplies: Array<{ readonly requestId: string; readonly token: string | null }> = [];
  const tokenForces: Array<boolean> = [];
  const syncRequests: Array<string> = [];
  const syncTimeouts: Array<number | undefined> = [];
  const foregrounds: Array<boolean> = [];
  let drainCount = 0;
  const handlers = ReplicaWorkerRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    Stamp: () => Effect.succeed({ generationId: "1", localCommitVersion: 0 }),
    ReadInsights: ({ window }) =>
      Effect.succeed({
        stamp: { generationId: "1", localCommitVersion: 0 },
        facts: {
          window,
          products: [],
          batches: [],
          sales: [{ productId: "p-1", day: 20_000, units: 3, revenue: 300 }],
          onOrder: [],
          days: [{ day: 20_000, invoices: 1, revenue: 300 }],
          hours: [{ hour: 9, invoices: 1, revenue: 300 }],
          truncated: false,
        },
      }),
    ReadOutboxStatuses: () => Effect.succeed(["pending" as const]),
    EnqueueCommand: ({ request }) =>
      Effect.succeed({
        operationId: request.operationId,
        status: "pending" as const,
        stamp: { generationId: "1", localCommitVersion: 1 },
      }),
    ReadCommandStatus: ({ operationId }) =>
      Effect.succeed(operationId === "op-1" ? ("pending" as const) : null),
    SetForeground: ({ visible }) =>
      Effect.sync(() => {
        foregrounds.push(visible);
      }),
    WakeSyncUpload: () => Effect.sync(() => ({ drained: true, drainCount: ++drainCount })),
    BackUp: () => Effect.die("unused"),
    StageRestore: () => Effect.die("unused"),
    ReleaseForRestore: () => Effect.die("unused"),
    Commits: () =>
      Stream.make({
        generationId: "1",
        localCommitVersion: 1,
        touchedEntities: ["category"],
        touchedKeys: ["c-1"],
      }),
    SyncHealth: () =>
      Stream.make({ _tag: "recoveryRequired" as const, message: "Sync needs recovery." }),
    ProxyRequests: () =>
      Stream.make({
        requestId: "proxy-1",
        method: "POST" as const,
        pathname: "/api/sync/pull",
        bodyText: "{}",
        timeoutMillis: 30_000,
      }),
    ProxyRespond: (reply) =>
      Effect.sync(() => {
        proxyReplies.push(reply);
      }),
    AccessTokenRequests: () => Stream.make({ requestId: "token-1", force: true }),
    AccessTokenRespond: (reply) =>
      Effect.sync(() => {
        tokenReplies.push(reply);
      }),
  });
  const readerHandlers = ReplicaReaderRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    ReadSubset: ({ spec }) =>
      Effect.succeed({
        stamp: { generationId: "1", localCommitVersion: 0 },
        rows: [{ id: spec.source }],
      }),
    ReadBatch: ({ specs }) =>
      Effect.succeed({
        stamp: { generationId: "1", localCommitVersion: 0 },
        reads: specs.map((spec) => [{ id: spec.source }]),
      }),
    SummarizeSubset: ({ spec }) =>
      Effect.succeed({
        stamp: { generationId: "1", localCommitVersion: 0 },
        summary: {
          count: 42,
          distinct: spec.distinct.map((column) => ({ column, values: ["A"] })),
        },
      }),
  });
  const readerBoots: Array<typeof ReplicaReaderBoot.Type> = [];
  const spawnReader: SpawnReplicaReader = ({ boot }) =>
    Effect.gen(function* () {
      readerBoots.push(boot);
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
  const spawnWorker: SpawnReplicaWorker = ({ boot }) =>
    Effect.gen(function* () {
      boots.push(boot);
      const lost = yield* Deferred.make<void>();
      const client = yield* RpcTest.makeClient(ReplicaWorkerRpcs).pipe(Effect.provide(handlers));
      return {
        client,
        lost: Deferred.await(lost),
        terminate: Deferred.succeed(lost, undefined).pipe(Effect.asVoid),
      };
    });
  const listeners = new Map<string, ReplicaIpcListener>();
  const userDataPath = mkdtempSync(path.join(tmpdir(), "store-replica-test-"));
  const registration = registerReplicaWorkerIpc({
    ipcMain: {
      handle: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeHandler: (channel) => {
        listeners.delete(channel);
      },
    },
    userDataPath,
    workerPath: "/tmp/replica-worker.js",
    apiBaseUrl: "https://api.tabaaq.local",
    syncApiRequest: async (pathname, init) => {
      syncRequests.push(pathname);
      syncTimeouts.push(init?.timeoutMillis);
      return { ok: true, status: 200, bodyText: "{}" };
    },
    liveAccessToken: async (force) => {
      tokenForces.push(force);
      return "access-1";
    },
    allowedOrigins: () => allowed,
    spawnWorker,
    spawnReader,
  });
  const sent: Array<{
    readonly channel: string;
    readonly event: ReplicaCommitEvent | ReplicaSyncHealthEvent | ReplicaAnalyticsEvent;
  }> = [];
  const emitters = new Map<number, EventEmitter>();
  const emitterFor = (id: number) => {
    const existing = emitters.get(id);
    if (existing) return existing;
    const created = new EventEmitter();
    emitters.set(id, created);
    return created;
  };
  const senderEvent = (id: number): ReplicaInvokeEvent => {
    const emitter = emitterFor(id);
    return {
      senderFrame: { url: allowed[0]! },
      sender: {
        id,
        isDestroyed: () => false,
        send: (channel, event) => {
          sent.push({ channel, event });
        },
        on: (teardown, listener) => emitter.on(teardown, listener),
        removeListener: (teardown, listener) => emitter.removeListener(teardown, listener),
      },
    };
  };
  const invoke = <Input>(channel: string, event: ReplicaInvokeEvent, input: Input) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    // SAFETY: the test sends raw renderer payloads, including malformed ones, to the IPC decoder.
    return listener(event, input as never);
  };
  const open = async (event: ReplicaInvokeEvent) =>
    decodeOpened(await invoke(REPLICA_OPEN_CHANNEL, event, openInput));
  return {
    userDataPath,
    boots,
    readerBoots,
    proxyReplies,
    tokenReplies,
    tokenForces,
    syncRequests,
    syncTimeouts,
    foregrounds,
    registration,
    senderEvent,
    emitterFor,
    invoke,
    open,
    sent,
  };
};

describe("replica worker IPC contract", () => {
  it("rejects missing and untrusted renderer frames", () => {
    expect(isTrustedIpcSenderFrame(null, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://evil.example" }, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://app.tabaaq.local/inventory" }, allowed)).toBe(
      true,
    );
    expect(() =>
      assertTrustedIpcSender({ url: "https://evil.example" }, ["https://app.tabaaq.local"]),
    ).toThrow("Rejected IPC from an untrusted renderer.");
  });

  it("hands the replica worker a fresh access token for its live socket", async () => {
    const { tokenReplies, tokenForces, registration, senderEvent, open } = setupIpc();
    await open(senderEvent(9));
    await vi.waitFor(() => {
      expect(tokenReplies).toEqual([{ requestId: "token-1", token: "access-1" }]);
    });
    expect(tokenForces).toEqual([true]);
    await registration.dispose();
  });

  it("opens a worker, forwards commits and proxy requests, and reads through typed RPCs", async () => {
    const {
      userDataPath,
      boots,
      readerBoots,
      proxyReplies,
      syncRequests,
      syncTimeouts,
      registration,
      senderEvent,
      invoke,
      open,
      sent,
    } = setupIpc();
    const event = senderEvent(7);
    mkdirSync(path.join(userDataPath, "replicas"));
    writeFileSync(path.join(userDataPath, "replicas", "org-1-user-1.sqlite-wal"), "");

    const opened = await open(event);
    expect(opened.engine).toBe("sqlite");
    const token = opened.workspaceToken;
    expect(boots).toEqual([
      {
        ...openInput,
        databasePath: path.join(userDataPath, "replicas", "tabaaq-replica-v2-org-1-user-1.sqlite"),
        apiBaseUrl: "https://api.tabaaq.local",
      },
    ]);
    expect(readerBoots).toEqual([{ databasePath: boots[0]?.databasePath }]);
    expect(readdirSync(path.join(userDataPath, "replicas"))).toEqual([]);

    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
      expect(sent).toContainEqual({
        channel: REPLICA_COMMIT_CHANNEL,
        event: {
          workspaceToken: token,
          generationId: "1",
          localCommitVersion: 1,
          touchedEntities: ["category"],
          touchedKeys: ["c-1"],
        },
      });
      expect(sent).toContainEqual({
        channel: REPLICA_SYNC_HEALTH_CHANNEL,
        event: {
          workspaceToken: token,
          health: { _tag: "recoveryRequired", message: "Sync needs recovery." },
        },
      });
      expect(syncRequests).toEqual(["/api/sync/pull"]);
      expect(syncTimeouts).toEqual([30_000]);
      expect(proxyReplies).toEqual([
        { requestId: "proxy-1", result: { ok: true, status: 200, bodyText: "{}" } },
      ]);
    });

    await expect(invoke(REPLICA_STAMP_CHANNEL, event, token)).resolves.toEqual({
      generationId: "1",
      localCommitVersion: 0,
    });
    await expect(
      invoke(REPLICA_READ_SUBSET_CHANNEL, event, {
        workspaceToken: token,
        requestId: "read-1",
        spec: { source: "categories", orderBy: [], limit: 10, offset: 0 },
      }),
    ).resolves.toEqual({
      stamp: { generationId: "1", localCommitVersion: 0 },
      rows: [{ id: "categories" }],
    });
    await expect(
      invoke(REPLICA_READ_BATCH_CHANNEL, event, {
        workspaceToken: token,
        requestId: "read-2",
        specs: [
          { source: "invoices", orderBy: [], limit: 10, offset: 0 },
          { source: "invoiceItems", orderBy: [], limit: 10, offset: 0 },
        ],
      }),
    ).resolves.toEqual({
      stamp: { generationId: "1", localCommitVersion: 0 },
      reads: [[{ id: "invoices" }], [{ id: "invoiceItems" }]],
    });
    await expect(
      invoke(REPLICA_READ_BATCH_CHANNEL, event, {
        workspaceToken: token,
        requestId: "read-3",
        specs: Array.from({ length: 7 }, () => ({
          source: "invoices",
          orderBy: [],
          limit: 10,
          offset: 0,
        })),
      }),
    ).rejects.toThrow();
    await expect(
      invoke(REPLICA_READ_BATCH_CHANNEL, event, {
        workspaceToken: token,
        requestId: "read-4",
        specs: [{ source: "invoices", orderBy: [], limit: 501, offset: 0 }],
      }),
    ).rejects.toThrow();
    const window = { since: 1_000, until: 2_000, utcOffsetMinutes: 300 };
    await expect(
      invoke(REPLICA_READ_INSIGHTS_CHANNEL, event, { workspaceToken: token, window }),
    ).resolves.toMatchObject({
      stamp: { generationId: "1", localCommitVersion: 0 },
      facts: { window, sales: [{ productId: "p-1", units: 3 }], truncated: false },
    });
    await expect(
      invoke(REPLICA_READ_INSIGHTS_CHANNEL, event, {
        workspaceToken: token,
        window: { since: 2_000, until: 1_000, utcOffsetMinutes: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      invoke(REPLICA_SUMMARIZE_SUBSET_CHANNEL, event, {
        workspaceToken: token,
        spec: { source: "products", distinct: ["aisle"] },
      }),
    ).resolves.toEqual({
      stamp: { generationId: "1", localCommitVersion: 0 },
      summary: { count: 42, distinct: [{ column: "aisle", values: ["A"] }] },
    });
    await expect(
      invoke(REPLICA_SUMMARIZE_SUBSET_CHANNEL, event, {
        workspaceToken: token,
        spec: { source: "products", distinct: ["a", "b", "c", "d", "e", "f"] },
      }),
    ).rejects.toThrow();
    await expect(invoke(REPLICA_OUTBOX_CHANNEL, event, token)).resolves.toEqual(["pending"]);
    await expect(
      invoke(REPLICA_ENQUEUE_CHANNEL, event, { workspaceToken: token, request: enqueueRequest }),
    ).resolves.toEqual({
      operationId: "op-1",
      status: "pending",
      stamp: { generationId: "1", localCommitVersion: 1 },
    });
    await expect(
      invoke(REPLICA_COMMAND_STATUS_CHANNEL, event, { workspaceToken: token, operationId: "op-1" }),
    ).resolves.toBe("pending");
    await expect(
      invoke(REPLICA_COMMAND_STATUS_CHANNEL, event, {
        workspaceToken: token,
        operationId: "op-unknown",
      }),
    ).resolves.toBeNull();
    await expect(invoke(REPLICA_WAKE_CHANNEL, event, token)).resolves.toEqual({
      drained: true,
      drainCount: 1,
    });
    await expect(invoke(REPLICA_WAKE_CHANNEL, event, token)).resolves.toMatchObject({
      drainCount: 2,
    });

    await invoke(REPLICA_CLOSE_CHANNEL, event, token);
    await expect(invoke(REPLICA_STAMP_CHANNEL, event, token)).rejects.toThrow(
      "Unknown replica workspace.",
    );
    await registration.dispose();
  });

  it("rejects malformed subset specs before they reach the worker", async () => {
    const { registration, senderEvent, invoke, open } = setupIpc();
    const event = senderEvent(7);
    const { workspaceToken } = await open(event);
    await expect(
      invoke(REPLICA_READ_SUBSET_CHANNEL, event, {
        workspaceToken,
        requestId: "read-5",
        spec: {
          source: "categories",
          where: { _tag: "compare", column: 'id" OR 1=1 --', op: "eq", value: "x" },
          orderBy: [],
          limit: 10,
          offset: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      invoke(REPLICA_READ_SUBSET_CHANNEL, event, {
        workspaceToken,
        sql: "delete from categories",
        parameters: [],
      }),
    ).rejects.toThrow();
    await registration.dispose();
  });

  it("rejects replica channels from a different renderer", async () => {
    const { registration, senderEvent, invoke, open } = setupIpc();
    const { workspaceToken } = await open(senderEvent(7));
    const intruder = senderEvent(9);
    await expect(invoke(REPLICA_OUTBOX_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica outbox read from a different renderer.",
    );
    await expect(
      invoke(REPLICA_COMMAND_STATUS_CHANNEL, intruder, { workspaceToken, operationId: "op-1" }),
    ).rejects.toThrow("Rejected replica command status from a different renderer.");
    await expect(
      invoke(REPLICA_ENQUEUE_CHANNEL, intruder, { workspaceToken, request: enqueueRequest }),
    ).rejects.toThrow("Rejected replica enqueue from a different renderer.");
    await expect(invoke(REPLICA_CLOSE_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica close from a different renderer.",
    );
    await expect(
      invoke(REPLICA_OUTBOX_CHANNEL, senderEvent(7), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("Unknown replica workspace.");
    await registration.dispose();
  });

  it("forwards window foreground changes to open workers and to workers opened while hidden", async () => {
    const { foregrounds, registration, senderEvent, open } = setupIpc();
    await open(senderEvent(7));
    await registration.setForeground(true);
    expect(foregrounds).toEqual([]);
    await registration.setForeground(false);
    await registration.setForeground(false);
    expect(foregrounds).toEqual([false]);
    await open(senderEvent(8));
    expect(foregrounds).toEqual([false, false]);
    await registration.setForeground(true);
    expect(foregrounds).toEqual([false, false, true, true]);
    await registration.dispose();
  });

  it.each(["did-navigate", "render-process-gone", "destroyed"] as const)(
    "closes the worker session when the renderer fires %s",
    async (teardown) => {
      const { registration, senderEvent, emitterFor, invoke, open } = setupIpc();
      const event = senderEvent(7);
      const first = await open(event);
      const second = await open(event);
      const emitter = emitterFor(7);
      expect(emitter.listenerCount(teardown)).toBe(2);
      emitter.emit(teardown);
      await expect(invoke(REPLICA_STAMP_CHANNEL, event, first.workspaceToken)).rejects.toThrow(
        "Unknown replica workspace.",
      );
      await expect(invoke(REPLICA_STAMP_CHANNEL, event, second.workspaceToken)).rejects.toThrow(
        "Unknown replica workspace.",
      );
      await vi.waitFor(() => {
        expect(emitter.listenerCount(teardown)).toBe(0);
      });
      await registration.dispose();
    },
  );

  it("releases renderer listeners when a session closes explicitly", async () => {
    const { registration, senderEvent, emitterFor, invoke, open } = setupIpc();
    const event = senderEvent(7);
    const { workspaceToken } = await open(event);
    expect(emitterFor(7).listenerCount("did-navigate")).toBe(1);
    await invoke(REPLICA_CLOSE_CHANNEL, event, workspaceToken);
    expect(emitterFor(7).listenerCount("did-navigate")).toBe(0);
    await registration.dispose();
  });

  it("discards a session whose renderer navigated away while it was opening", async () => {
    const { registration, senderEvent, emitterFor, invoke } = setupIpc();
    const event = senderEvent(7);
    const opening = invoke(REPLICA_OPEN_CHANNEL, event, openInput);
    await vi.waitFor(() => {
      expect(emitterFor(7).listenerCount("did-navigate")).toBe(1);
    });
    emitterFor(7).emit("did-navigate");
    await expect(opening).rejects.toThrow(
      "The replica renderer went away while the workspace was opening.",
    );
    expect(emitterFor(7).listenerCount("did-navigate")).toBe(0);
    await registration.dispose();
  });
});
