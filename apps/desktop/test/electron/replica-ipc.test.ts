import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { describe, expect, it, vi } from "vitest";

import { assertTrustedIpcSender, isTrustedIpcSenderFrame } from "../../electron/ipc-sender";
import {
  REPLICA_ALLOCATION_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  type ReplicaCommitEvent,
  type ReplicaSyncHealthEvent,
} from "../../electron/replica-channels";
import {
  registerReplicaWorkerIpc,
  type ReplicaInvokeEvent,
  type ReplicaIpcListener,
  type SpawnReplicaWorker,
} from "../../electron/replica-ipc";
import {
  ReplicaWorkerRpcs,
  type ProxyFetchResult,
  type ReplicaWorkerBoot,
} from "../../electron/replica-rpc";

const allowed = ["https://app.tabaaq.local"];

const envelope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  epoch: "1",
  replicaId: "device-1",
  clientSequence: "1",
  operationId: "op-1",
  payloadHash: "a".repeat(64),
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

const openInput = { organizationId: "org-1", userId: "user-1", replicaId: "device-1" };

const decodeOpened = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaceToken: Schema.String,
    engine: Schema.Literals(["sqlite", "unavailable"]),
  }),
);

const setupIpc = () => {
  const boots: Array<typeof ReplicaWorkerBoot.Type> = [];
  const proxyReplies: Array<{ readonly requestId: string; readonly result: ProxyFetchResult }> = [];
  const syncRequests: Array<string> = [];
  let drainCount = 0;
  const handlers = ReplicaWorkerRpcs.toLayer({
    Open: (boot) =>
      Effect.sync(() => {
        boots.push(boot);
        return "sqlite" as const;
      }),
    Stamp: () => Effect.succeed({ generationId: "1", localCommitVersion: 0 }),
    ReadSubset: ({ spec }) =>
      Effect.succeed({
        stamp: { generationId: "1", localCommitVersion: 0 },
        rows: [{ id: spec.source }],
      }),
    ReadOutboxStatuses: () => Effect.succeed(["pending" as const]),
    ReadCommandAllocation: () => Effect.succeed({ epoch: "1", nextClientSequence: "4" }),
    EnqueueLocal: ({ envelope: received }) =>
      Effect.succeed({ changed: received.operationId === "op-1", status: "pending" }),
    WakeSyncUpload: () => Effect.sync(() => ({ drained: true, drainCount: ++drainCount })),
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
      }),
    ProxyRespond: (reply) =>
      Effect.sync(() => {
        proxyReplies.push(reply);
      }),
  });
  const spawnWorker: SpawnReplicaWorker = () =>
    RpcTest.makeClient(ReplicaWorkerRpcs).pipe(Effect.provide(handlers));
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
    userDataPath: "/tmp/store-replica-test",
    workerPath: "/tmp/replica-worker.js",
    apiBaseUrl: "https://api.tabaaq.local",
    syncApiRequest: async (pathname) => {
      syncRequests.push(pathname);
      return { ok: true, status: 200, bodyText: "{}" };
    },
    allowedOrigins: () => allowed,
    spawnWorker,
  });
  const sent: Array<{
    readonly channel: string;
    readonly event: ReplicaCommitEvent | ReplicaSyncHealthEvent;
  }> = [];
  const senderEvent = (id: number): ReplicaInvokeEvent => ({
    senderFrame: { url: allowed[0]! },
    sender: {
      id,
      isDestroyed: () => false,
      send: (channel, event) => {
        sent.push({ channel, event });
      },
    },
  });
  const invoke = <Input>(channel: string, event: ReplicaInvokeEvent, input: Input) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    // SAFETY: the test sends raw renderer payloads, including malformed ones, to the IPC decoder.
    return listener(event, input as never);
  };
  const open = async (event: ReplicaInvokeEvent) =>
    decodeOpened(await invoke(REPLICA_OPEN_CHANNEL, event, openInput));
  return { boots, proxyReplies, syncRequests, registration, senderEvent, invoke, open, sent };
};

describe("replica worker IPC contract", () => {
  it("rejects untrusted renderer frames", () => {
    expect(
      isTrustedIpcSenderFrame({ url: "https://evil.example" }, ["https://app.tabaaq.local"]),
    ).toBe(false);
    expect(() =>
      assertTrustedIpcSender({ url: "https://evil.example" }, ["https://app.tabaaq.local"]),
    ).toThrow("Rejected IPC from an untrusted renderer.");
  });

  it("opens a worker, forwards commits and proxy requests, and reads through typed RPCs", async () => {
    const { boots, proxyReplies, syncRequests, registration, senderEvent, invoke, open, sent } =
      setupIpc();
    const event = senderEvent(7);

    const opened = await open(event);
    expect(opened.engine).toBe("sqlite");
    const token = opened.workspaceToken;
    expect(boots).toEqual([
      {
        ...openInput,
        databasePath: "/tmp/store-replica-test/replicas/org-1-user-1.sqlite",
        apiBaseUrl: "https://api.tabaaq.local",
      },
    ]);

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
        spec: { source: "categories", orderBy: [], limit: 10, offset: 0 },
      }),
    ).resolves.toEqual({
      stamp: { generationId: "1", localCommitVersion: 0 },
      rows: [{ id: "categories" }],
    });
    await expect(invoke(REPLICA_OUTBOX_CHANNEL, event, token)).resolves.toEqual(["pending"]);
    await expect(invoke(REPLICA_ALLOCATION_CHANNEL, event, token)).resolves.toEqual({
      epoch: "1",
      nextClientSequence: "4",
    });
    await expect(
      invoke(REPLICA_ENQUEUE_CHANNEL, event, { workspaceToken: token, envelope, createdAt: 5 }),
    ).resolves.toEqual({ changed: true, status: "pending" });
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
    await expect(invoke(REPLICA_ALLOCATION_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica command allocation from a different renderer.",
    );
    await expect(
      invoke(REPLICA_ENQUEUE_CHANNEL, intruder, { workspaceToken, envelope, createdAt: 1 }),
    ).rejects.toThrow("Rejected replica enqueue from a different renderer.");
    await expect(invoke(REPLICA_CLOSE_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica close from a different renderer.",
    );
    await expect(
      invoke(REPLICA_OUTBOX_CHANNEL, senderEvent(7), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("Unknown replica workspace.");
    await registration.dispose();
  });
});
