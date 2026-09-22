import path from "node:path";
import { Worker } from "node:worker_threads";

import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";

import { assertTrustedIpcSender } from "./ipc-sender";
import {
  REPLICA_CANCEL_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_QUERY_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  ReplicaCommitEvent,
  ReplicaQueryInput,
  ReplicaWorkerBootInput,
  type ReplicaWakeResult,
  type ReplicaWorkerRequest,
  type ReplicaWorkerResponse,
  type ReplicaWorkspaceToken,
} from "./replica-channels";

export type ReplicaWorkerLike = {
  readonly postMessage: (message: ReplicaWorkerRequest) => void;
  readonly onMessage: (listener: (message: ReplicaWorkerResponse) => void) => void;
  readonly onError: (listener: (cause: Error) => void) => void;
  readonly terminate: () => Promise<number>;
};

export type CreateReplicaWorker = (workerPath: string) => ReplicaWorkerLike;

export type ReplicaSyncApiRequest = (
  pathname: string,
  init?: {
    readonly method?: "GET" | "POST";
    readonly body?: string | null;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly bodyText: string }>;

const defaultCreateWorker: CreateReplicaWorker = (workerPath) => {
  const worker = new Worker(workerPath);
  return {
    postMessage: (message) => {
      worker.postMessage(message);
    },
    onMessage: (listener) => {
      worker.on("message", (message: ReplicaWorkerResponse) => {
        listener(message);
      });
    },
    onError: (listener) => {
      worker.on("error", listener);
    },
    terminate: () => worker.terminate(),
  };
};

type PendingReply = {
  readonly resolve: (value: ReplicaWorkerResponse) => void;
  readonly reject: (cause: Error) => void;
};

type Session = {
  readonly workspaceToken: string;
  readonly worker: ReplicaWorkerLike;
  readonly senderId: number;
  readonly contents: WebContents;
  pending: Map<string, PendingReply>;
  cancelled: Set<string>;
};

const requestId = () => crypto.randomUUID();

const waitForResponse = (
  session: Session,
  id: string,
  send: ReplicaWorkerRequest,
): Promise<ReplicaWorkerResponse> =>
  new Promise((resolve, reject) => {
    if (session.cancelled.has(id)) {
      reject(new Error("Replica request was cancelled."));
      return;
    }
    session.pending.set(id, { resolve, reject });
    session.worker.postMessage(send);
  });

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: IpcMain;
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly syncApiRequest: ReplicaSyncApiRequest;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly createWorker?: CreateReplicaWorker;
}) => {
  const createWorker = options.createWorker ?? defaultCreateWorker;
  const sessions = new Map<string, Session>();

  const assertSender = (event: IpcMainInvokeEvent | IpcMainEvent) =>
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());

  const disposeSession = async (session: Session) => {
    const id = requestId();
    try {
      await waitForResponse(session, id, { _tag: "dispose", requestId: id });
    } catch {
      // Worker may already be gone.
    }
    await session.worker.terminate();
    for (const pending of session.pending.values()) {
      pending.reject(new Error("Replica workspace closed."));
    }
    session.pending.clear();
    sessions.delete(session.workspaceToken);
  };

  const fulfillProxyFetch = async (
    session: Session,
    message: Extract<ReplicaWorkerResponse, { readonly _tag: "proxyFetch" }>,
  ) => {
    try {
      const response = await options.syncApiRequest(message.pathname, {
        method: message.method,
        body: message.bodyText,
      });
      session.worker.postMessage({
        _tag: "proxyFetchResult",
        requestId: message.requestId,
        ok: response.ok,
        status: response.status,
        bodyText: response.bodyText,
      });
    } catch (cause) {
      session.worker.postMessage({
        _tag: "proxyFetchResult",
        requestId: message.requestId,
        ok: false,
        status: 503,
        bodyText: cause instanceof Error ? cause.message : "Sync proxy failed.",
      });
    }
  };

  const attachWorker = (session: Session) => {
    session.worker.onMessage((message) => {
      if (message._tag === "commit") {
        if (!session.contents.isDestroyed()) {
          session.contents.send(REPLICA_COMMIT_CHANNEL, {
            workspaceToken: session.workspaceToken,
            generationId: message.generationId,
            localCommitVersion: message.localCommitVersion,
            touchedEntities: message.touchedEntities,
            touchedKeys: message.touchedKeys,
          } satisfies ReplicaCommitEvent);
        }
        return;
      }
      if (message._tag === "proxyFetch") {
        void fulfillProxyFetch(session, message);
        return;
      }
      if (message._tag === "error") {
        const pending = message.requestId ? session.pending.get(message.requestId) : undefined;
        if (pending && message.requestId) {
          session.pending.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
        return;
      }
      const pending = session.pending.get(message.requestId);
      if (!pending) return;
      session.pending.delete(message.requestId);
      pending.resolve(message);
    });
    session.worker.onError((cause) => {
      for (const pending of session.pending.values()) {
        pending.reject(cause);
      }
      session.pending.clear();
    });
  };

  const handleOpen = async (
    event: IpcMainInvokeEvent,
    input: ReplicaWorkerBootInput,
  ): Promise<ReplicaWorkspaceToken> => {
    assertSender(event);
    const boot = Schema.decodeUnknownSync(ReplicaWorkerBootInput)(input);
    if ([...sessions.values()].some((session) => session.cancelled.has(boot.requestId))) {
      throw new Error("Replica open request was cancelled.");
    }
    const workspaceToken = crypto.randomUUID();
    const databasePath = path.join(
      options.userDataPath,
      "replicas",
      `${boot.organizationId}-${boot.userId}.sqlite`,
    );
    const worker = createWorker(options.workerPath);
    const session: Session = {
      workspaceToken,
      worker,
      senderId: event.sender.id,
      contents: event.sender,
      pending: new Map(),
      cancelled: new Set(),
    };
    attachWorker(session);
    sessions.set(workspaceToken, session);
    try {
      const ready = await waitForResponse(session, boot.requestId, {
        _tag: "boot",
        requestId: boot.requestId,
        databasePath,
        organizationId: boot.organizationId,
        userId: boot.userId,
        replicaId: boot.replicaId,
        apiBaseUrl: options.apiBaseUrl,
      });
      if (ready._tag !== "ready") {
        throw new Error("Replica worker did not become ready.");
      }
      if (session.cancelled.has(boot.requestId)) {
        await disposeSession(session);
        throw new Error("Replica open was cancelled.");
      }
      return { workspaceToken, engine: ready.engine };
    } catch (cause) {
      await disposeSession(session);
      throw cause;
    }
  };

  const handleClose = async (event: IpcMainInvokeEvent, input: string) => {
    assertSender(event);
    const workspaceToken = Schema.decodeUnknownSync(Schema.String)(input);
    const session = sessions.get(workspaceToken);
    if (!session) return;
    if (session.senderId !== event.sender.id) {
      throw new Error("Rejected replica close from a different renderer.");
    }
    await disposeSession(session);
  };

  const handleStamp = async (event: IpcMainInvokeEvent, input: string) => {
    assertSender(event);
    const workspaceToken = Schema.decodeUnknownSync(Schema.String)(input);
    const session = sessions.get(workspaceToken);
    if (!session) throw new Error("Unknown replica workspace.");
    if (session.senderId !== event.sender.id) {
      throw new Error("Rejected replica stamp from a different renderer.");
    }
    const id = requestId();
    const response = await waitForResponse(session, id, { _tag: "stamp", requestId: id });
    if (response._tag !== "stamp") throw new Error("Replica stamp failed.");
    return {
      workspaceToken,
      generationId: response.generationId,
      localCommitVersion: response.localCommitVersion,
    };
  };

  const handleQuery = async (event: IpcMainInvokeEvent, input: ReplicaQueryInput) => {
    assertSender(event);
    const query = Schema.decodeUnknownSync(ReplicaQueryInput)(input);
    const session = sessions.get(query.workspaceToken);
    if (!session) throw new Error("Unknown replica workspace.");
    if (session.senderId !== event.sender.id) {
      throw new Error("Rejected replica query from a different renderer.");
    }
    const id = requestId();
    const response = await waitForResponse(session, id, {
      _tag: "query",
      requestId: id,
      sql: query.sql,
      parameters: query.parameters,
      stamped: query.stamped === true,
    });
    if (response._tag !== "query") throw new Error("Replica query failed.");
    return {
      rows: response.rows,
      stamp: response.stamp,
    };
  };

  const handleWake = async (
    event: IpcMainInvokeEvent,
    input: string,
  ): Promise<ReplicaWakeResult> => {
    assertSender(event);
    const workspaceToken = Schema.decodeUnknownSync(Schema.String)(input);
    const session = sessions.get(workspaceToken);
    if (!session) throw new Error("Unknown replica workspace.");
    if (session.senderId !== event.sender.id) {
      throw new Error("Rejected replica wake from a different renderer.");
    }
    const id = requestId();
    const response = await waitForResponse(session, id, { _tag: "wake", requestId: id });
    if (response._tag !== "woke") throw new Error("Replica wake failed.");
    return {
      workspaceToken,
      drained: response.drained,
      drainCount: response.drainCount,
    };
  };

  const handleCancel = (event: IpcMainEvent, input: string) => {
    assertSender(event);
    const id = Schema.decodeUnknownSync(Schema.String)(input);
    for (const session of sessions.values()) {
      if (session.senderId !== event.sender.id) continue;
      session.cancelled.add(id);
      const pending = session.pending.get(id);
      if (pending) {
        session.pending.delete(id);
        pending.reject(new Error("Replica request was cancelled."));
      }
    }
  };

  options.ipcMain.handle(REPLICA_OPEN_CHANNEL, handleOpen);
  options.ipcMain.handle(REPLICA_CLOSE_CHANNEL, handleClose);
  options.ipcMain.handle(REPLICA_STAMP_CHANNEL, handleStamp);
  options.ipcMain.handle(REPLICA_QUERY_CHANNEL, handleQuery);
  options.ipcMain.handle(REPLICA_WAKE_CHANNEL, handleWake);
  options.ipcMain.on(REPLICA_CANCEL_CHANNEL, handleCancel);

  return {
    dispose: async () => {
      options.ipcMain.removeHandler(REPLICA_OPEN_CHANNEL);
      options.ipcMain.removeHandler(REPLICA_CLOSE_CHANNEL);
      options.ipcMain.removeHandler(REPLICA_STAMP_CHANNEL);
      options.ipcMain.removeHandler(REPLICA_QUERY_CHANNEL);
      options.ipcMain.removeHandler(REPLICA_WAKE_CHANNEL);
      options.ipcMain.off(REPLICA_CANCEL_CHANNEL, handleCancel);
      await Promise.all([...sessions.values()].map((session) => disposeSession(session)));
    },
    publishCommit: (workspaceToken: string, event: ReplicaCommitEvent) => {
      const session = sessions.get(workspaceToken);
      if (!session || session.contents.isDestroyed()) return;
      session.contents.send(REPLICA_COMMIT_CHANNEL, event);
    },
  };
};
