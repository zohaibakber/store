import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { describe, expect, it } from "vitest";

import { assertTrustedIpcSender, isTrustedIpcSenderFrame } from "../../electron/ipc-sender";
import {
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
} from "../../electron/replica-channels";
import {
  registerReplicaWorkerIpc,
  type ReplicaInvokeEvent,
  type ReplicaIpcListener,
} from "../../electron/replica-ipc";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const allowed = ["https://app.tabaaq.local"];

const untrusted = "Rejected IPC from an untrusted renderer.";

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

const decodeOpened = Schema.decodeUnknownSync(Schema.Struct({ workspaceToken: Schema.String }));

const setupIpc = () => {
  const workerReads: Array<string> = [];
  const handlers = ReplicaWorkerRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    Stamp: () => Effect.die("unused"),
    ReadInsights: () => Effect.die("unused"),
    ReadOutboxStatuses: () => Effect.die("unused"),
    ReadSyncActivity: () => Effect.die("unused"),
    EnqueueCommand: () => Effect.die("unused"),
    ReadCommandStatus: () => Effect.die("unused"),
    SetForeground: () => Effect.void,
    WakeSyncUpload: () => Effect.die("unused"),
    BackUp: () => Effect.die("unused"),
    StageRestore: () => Effect.die("unused"),
    ReleaseForRestore: () => Effect.die("unused"),
    PublishSummary: () => Effect.die("unused"),
    PublishStage: () => Stream.die("unused"),
    PublishCommit: () => Effect.die("unused"),
    Commits: () => Stream.never,
    SyncHealth: () => Stream.never,
    ProxyRequests: () => Stream.never,
    ProxyRespond: () => Effect.void,
    AccessTokenRequests: () => Stream.never,
    AccessTokenRespond: () => Effect.void,
  });
  const readerHandlers = ReplicaReaderRpcs.toLayer({
    Engine: () => Effect.succeed("sqlite" as const),
    ReadSubset: ({ spec }) =>
      Effect.sync(() => {
        workerReads.push(spec.source);
        return { stamp: { generationId: "1", localCommitVersion: 0 }, rows: [] };
      }),
    ReadBatch: () => Effect.die("unused"),
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
    userDataPath: mkdtempSync(path.join(tmpdir(), "store-replica-test-")),
    workerPath: "/tmp/replica-worker.js",
    apiBaseUrl: "https://api.tabaaq.local",
    syncApiRequest: () => Effect.succeed({ ok: true, status: 200, bodyText: "{}" }),
    liveAccessToken: async () => "access-1",
    allowedOrigins: () => allowed,
    spawnWorker,
    spawnReader,
  });
  const senderEvent = (id: number, url = allowed[0]!): ReplicaInvokeEvent => ({
    senderFrame: { url },
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
    // SAFETY: the test sends raw renderer payloads, including malformed ones, to the IPC decoder.
    return listener(event, input as never);
  };
  const open = async (event: ReplicaInvokeEvent) =>
    decodeOpened(await invoke(REPLICA_OPEN_CHANNEL, event, openInput));
  return { workerReads, listeners, registration, senderEvent, invoke, open };
};

describe("replica worker IPC contract", () => {
  it("rejects missing and untrusted renderer frames on every channel", async () => {
    expect(isTrustedIpcSenderFrame(null, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://evil.example" }, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://app.tabaaq.local/inventory" }, allowed)).toBe(
      true,
    );
    expect(() =>
      assertTrustedIpcSender({ url: "https://evil.example" }, ["https://app.tabaaq.local"]),
    ).toThrow(untrusted);

    const { listeners, registration, senderEvent, invoke, open } = setupIpc();
    const { workspaceToken } = await open(senderEvent(7));
    expect(listeners.size).toBeGreaterThan(20);
    for (const channel of listeners.keys()) {
      expect(() => invoke(channel, senderEvent(7, "https://evil.example"), workspaceToken)).toThrow(
        untrusted,
      );
      expect(() =>
        invoke(channel, { ...senderEvent(7), senderFrame: null }, workspaceToken),
      ).toThrow(untrusted);
    }
    await registration.dispose();
  });

  it("rejects malformed subset specs before they reach the worker", async () => {
    const { workerReads, registration, senderEvent, invoke, open } = setupIpc();
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
    expect(workerReads).toEqual([]);
    await invoke(REPLICA_READ_SUBSET_CHANNEL, event, {
      workspaceToken,
      requestId: "read-6",
      spec: { source: "categories", orderBy: [], limit: 10, offset: 0 },
    });
    expect(workerReads).toEqual(["categories"]);
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
});
