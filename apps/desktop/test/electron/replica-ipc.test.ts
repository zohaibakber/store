import { describe, expect, it } from "vitest";

import { assertTrustedIpcSender, isTrustedIpcSenderFrame } from "../../electron/ipc-sender";
import {
  REPLICA_CANCEL_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_QUERY_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  ReplicaWorkerBootInput,
  type ReplicaWakeResult,
  type ReplicaWorkerRequest,
  type ReplicaWorkerResponse,
  type ReplicaWorkspaceToken,
} from "../../electron/replica-channels";
import {
  registerReplicaWorkerIpc,
  type CreateReplicaWorker,
  type ReplicaWorkerLike,
} from "../../electron/replica-ipc";

class FakeWorker implements ReplicaWorkerLike {
  readonly messages: Array<ReplicaWorkerRequest> = [];
  drainCount = 0;
  private messageListener: ((message: ReplicaWorkerResponse) => void) | undefined;

  postMessage(message: ReplicaWorkerRequest) {
    this.messages.push(message);
    if (message._tag === "proxyFetchResult") return;
    const respond = () => {
      const response: ReplicaWorkerResponse =
        message._tag === "boot"
          ? { _tag: "ready", requestId: message.requestId, engine: "sqlite" }
          : message._tag === "stamp"
            ? {
                _tag: "stamp",
                requestId: message.requestId,
                generationId: "1",
                localCommitVersion: 0,
              }
            : message._tag === "query"
              ? {
                  _tag: "query",
                  requestId: message.requestId,
                  rows: [{ id: "1" }],
                  stamp: message.stamped ? { generationId: "1", localCommitVersion: 0 } : undefined,
                }
              : message._tag === "wake"
                ? (() => {
                    this.drainCount += 1;
                    return {
                      _tag: "woke" as const,
                      requestId: message.requestId,
                      drained: true,
                      drainCount: this.drainCount,
                    };
                  })()
                : { _tag: "disposed", requestId: message.requestId };
      this.messageListener?.(response);
    };
    setTimeout(respond, 0);
  }

  onMessage(listener: (message: ReplicaWorkerResponse) => void) {
    this.messageListener = listener;
  }

  onError(_listener: (cause: Error) => void) {}

  terminate() {
    return Promise.resolve(0);
  }
}

type Handler = {
  open?: (
    event: { senderFrame: { url: string }; sender: { id: number } },
    input: typeof ReplicaWorkerBootInput.Type,
  ) => Promise<ReplicaWorkspaceToken>;
  close?: (
    event: { senderFrame: { url: string }; sender: { id: number } },
    input: string,
  ) => Promise<void>;
  stamp?: (
    event: { senderFrame: { url: string }; sender: { id: number } },
    input: string,
  ) => Promise<{ generationId: string }>;
  query?: (
    event: { senderFrame: { url: string }; sender: { id: number } },
    input: {
      workspaceToken: string;
      sql: string;
      parameters: ReadonlyArray<string | number | null>;
      stamped?: boolean;
    },
  ) => Promise<{ rows: ReadonlyArray<Record<string, string | number | null>> }>;
  wake?: (
    event: { senderFrame: { url: string }; sender: { id: number } },
    input: string,
  ) => Promise<ReplicaWakeResult>;
  cancel?: (event: { senderFrame: { url: string }; sender: { id: number } }, input: string) => void;
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

  it("opens, stamps, cancels, and disposes through the typed channels", async () => {
    const workers: Array<FakeWorker> = [];
    const createWorker: CreateReplicaWorker = () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    };
    const handler: Handler = {};
    const ipcMain = {
      handle: (channel: string, next: Handler[keyof Handler]) => {
        if (channel === REPLICA_OPEN_CHANNEL) {
          // SAFETY: open channel registers the open handler shape.
          handler.open = next as Handler["open"];
        }
        if (channel === REPLICA_CLOSE_CHANNEL) {
          // SAFETY: close channel registers the close handler shape.
          handler.close = next as Handler["close"];
        }
        if (channel === REPLICA_STAMP_CHANNEL) {
          // SAFETY: stamp channel registers the stamp handler shape.
          handler.stamp = next as Handler["stamp"];
        }
        if (channel === REPLICA_QUERY_CHANNEL) {
          // SAFETY: query channel registers the query handler shape.
          handler.query = next as Handler["query"];
        }
        if (channel === REPLICA_WAKE_CHANNEL) {
          // SAFETY: wake channel registers the wake handler shape.
          handler.wake = next as Handler["wake"];
        }
      },
      removeHandler: (_channel: string) => undefined,
      on: (channel: string, next: Handler["cancel"]) => {
        if (channel === REPLICA_CANCEL_CHANNEL) handler.cancel = next;
      },
      off: (_channel: string) => undefined,
    };
    const allowed = ["https://app.tabaaq.local"];
    // SAFETY: test double only implements the IpcMain methods registerReplicaWorkerIpc uses.
    const registration = registerReplicaWorkerIpc({
      ipcMain: ipcMain as never,
      userDataPath: "/tmp/store-replica-test",
      workerPath: "/tmp/replica-worker.js",
      apiBaseUrl: "https://api.tabaaq.local",
      syncApiRequest: async () => ({ ok: true, status: 200, bodyText: "{}" }),
      allowedOrigins: () => allowed,
      createWorker,
    });

    const event = {
      senderFrame: { url: allowed[0]! },
      sender: { id: 7, isDestroyed: () => false, send: () => undefined },
    };

    const opened = await handler.open!(event, {
      organizationId: "org-1",
      userId: "user-1",
      replicaId: "device-1",
      requestId: "req-open-1",
    });
    expect(opened.engine).toBe("sqlite");
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages[0]?._tag).toBe("boot");
    expect(workers[0]?.messages[0]).toMatchObject({ apiBaseUrl: "https://api.tabaaq.local" });

    const stamp = await handler.stamp!(event, opened.workspaceToken);
    expect(stamp.generationId).toBe("1");

    const queried = await handler.query!(event, {
      workspaceToken: opened.workspaceToken,
      sql: "select 1 as id",
      parameters: [],
    });
    expect(queried.rows).toEqual([{ id: "1" }]);

    const woke = await handler.wake!(event, opened.workspaceToken);
    expect(woke.drained).toBe(true);
    expect(woke.drainCount).toBe(1);
    expect(workers[0]?.drainCount).toBe(1);
    expect(workers[0]?.messages.some((message) => message._tag === "wake")).toBe(true);

    const wokeAgain = await handler.wake!(event, opened.workspaceToken);
    expect(wokeAgain.drainCount).toBe(2);

    handler.cancel?.(event, "req-open-1");
    await handler.close!(event, opened.workspaceToken);
    await registration.dispose();
  });
});
