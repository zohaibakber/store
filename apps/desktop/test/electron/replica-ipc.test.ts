import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import {
  REPLICA_CLOSE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_RETRY_CHANNEL,
} from "../../electron/ipc-channels";
import { isTrustedIpcSenderFrame } from "../../electron/ipc-sender";
import {
  registerReplicaWorkerIpc,
  type ReplicaInvokeEvent,
  type ReplicaIpcListener,
} from "../../electron/replica-ipc";
import { ReplicaReaderRpcs, ReplicaWorkerRpcs } from "../../electron/replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "../../electron/replica-supervisor";

const allowed = ["https://app.tabaaq.local"];

const untrusted = "Rejected IPC from an untrusted renderer.";

const openInput = {
  authority: "remote",
  organizationId: "org-1",
  userId: "user-1",
  replicaId: "device-1",
};

const MAIN_CHANNELS = [
  "backup:apply-restore",
  "backup:choose-restore",
  "backup:discard-restore",
  "backup:save",
  "publish:discard",
  "publish:local-catalog",
  "publish:offer",
  "publish:start",
  "replica:close",
  "replica:open",
  "replica:retry",
];

const decodeOpened = Schema.decodeUnknownSync(Schema.Struct({ workspaceToken: Schema.String }));

const setupIpc = () => {
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
    accessTokens: {
      current: async () => Redacted.make("access-1"),
      subscribe: () => () => undefined,
    },
    allowedOrigins: () => allowed,
    backupDialogs: { chooseDestination: async () => null, chooseSource: async () => null },
    sessions: { spawnWorker, spawnReader },
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
  return { listeners, registration, senderEvent, invoke, open };
};

describe("replica worker IPC contract", () => {
  it("rejects missing and untrusted renderer frames on every channel", async () => {
    expect(isTrustedIpcSenderFrame(null, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://evil.example" }, allowed)).toBe(false);
    expect(isTrustedIpcSenderFrame({ url: "https://app.tabaaq.local/inventory" }, allowed)).toBe(
      true,
    );

    const { listeners, registration, senderEvent, invoke, open } = setupIpc();
    const { workspaceToken } = await open(senderEvent(7));
    expect(Array.from(listeners.keys()).sort()).toEqual(MAIN_CHANNELS);
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

  it("rejects replica channels from a different renderer", async () => {
    const { registration, senderEvent, invoke, open } = setupIpc();
    const { workspaceToken } = await open(senderEvent(7));
    const intruder = senderEvent(9);
    await expect(invoke(REPLICA_RETRY_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica recovery retry from a different renderer.",
    );
    await expect(invoke(REPLICA_CLOSE_CHANNEL, intruder, workspaceToken)).rejects.toThrow(
      "Rejected replica close from a different renderer.",
    );
    await expect(
      invoke(REPLICA_RETRY_CHANNEL, senderEvent(7), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("Unknown replica workspace.");
    await registration.dispose();
  });
});
