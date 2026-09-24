import path from "node:path";
import { Worker } from "node:worker_threads";

import * as NodeWorker from "@effect/platform-node/NodeWorker";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";

import { assertTrustedIpcSender, type TrustedIpcSenderFrame } from "./ipc-sender";
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
  type ReplicaIpcBridge,
  type ReplicaSyncHealthEvent,
} from "./replica-channels";
import {
  ReplicaEnqueueInput,
  ReplicaOpenInput,
  ReplicaReadSubsetInput,
  ReplicaWorkerRpcs,
  ReplicaWorkspaceToken,
  type ProxyFetchRequest,
  type ProxyFetchResult,
} from "./replica-rpc";

export type ReplicaWorkerClient = RpcClient.FromGroup<typeof ReplicaWorkerRpcs, RpcClientError>;

export type SpawnReplicaWorker = (
  workerPath: string,
) => Effect.Effect<ReplicaWorkerClient, never, Scope.Scope>;

export type ReplicaSyncApiRequest = (
  pathname: string,
  init?: {
    readonly method?: "GET" | "POST";
    readonly body?: string | null;
  },
) => Promise<ProxyFetchResult>;

type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, event: ReplicaCommitEvent | ReplicaSyncHealthEvent) => void;
};

export type ReplicaInvokeEvent = {
  readonly senderFrame: TrustedIpcSenderFrame | null;
  readonly sender: ReplicaSender;
};

type Session = {
  readonly senderId: number;
  readonly client: ReplicaWorkerClient;
  readonly scope: Scope.Closeable;
};

type BridgeResult<Method> = Method extends (...args: never) => Promise<infer Result>
  ? Result
  : never;

const CHANNEL_METHODS = {
  [REPLICA_OPEN_CHANNEL]: "open",
  [REPLICA_CLOSE_CHANNEL]: "close",
  [REPLICA_STAMP_CHANNEL]: "stamp",
  [REPLICA_READ_SUBSET_CHANNEL]: "readSubset",
  [REPLICA_OUTBOX_CHANNEL]: "readOutboxStatuses",
  [REPLICA_ALLOCATION_CHANNEL]: "readCommandAllocation",
  [REPLICA_ENQUEUE_CHANNEL]: "enqueueLocal",
  [REPLICA_WAKE_CHANNEL]: "wakeSyncUpload",
} satisfies Record<string, keyof ReplicaIpcBridge>;

type ChannelMethod<Channel extends keyof typeof CHANNEL_METHODS> =
  ReplicaIpcBridge[(typeof CHANNEL_METHODS)[Channel]];

export type ReplicaIpcInput = Parameters<ChannelMethod<keyof typeof CHANNEL_METHODS>>[0];

type ReplicaIpcHandlers = {
  readonly [Channel in keyof typeof CHANNEL_METHODS]: (
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
  ) => Promise<BridgeResult<ChannelMethod<Channel>>>;
};

export type ReplicaIpcResult = BridgeResult<ChannelMethod<keyof typeof CHANNEL_METHODS>>;

export type ReplicaIpcListener = (
  event: ReplicaInvokeEvent,
  input: ReplicaIpcInput,
) => Promise<ReplicaIpcResult>;

export const spawnNodeReplicaWorker: SpawnReplicaWorker = (workerPath) =>
  Layer.build(
    RpcClient.layerProtocolWorker({ size: 1 }).pipe(
      Layer.provide(NodeWorker.layer(() => new Worker(workerPath))),
    ),
  ).pipe(
    Effect.flatMap((protocol) =>
      RpcClient.make(ReplicaWorkerRpcs).pipe(Effect.provideContext(protocol)),
    ),
    Effect.orDie,
  );

const decodeWorkspaceToken = Schema.decodeUnknownSync(ReplicaWorkspaceToken);
const decodeOpenInput = Schema.decodeUnknownSync(ReplicaOpenInput);
const decodeReadSubsetInput = Schema.decodeUnknownSync(ReplicaReadSubsetInput);
const decodeEnqueueInput = Schema.decodeUnknownSync(ReplicaEnqueueInput);

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: {
    readonly handle: (channel: string, listener: ReplicaIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
  };
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly syncApiRequest: ReplicaSyncApiRequest;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly spawnWorker?: SpawnReplicaWorker;
}) => {
  const spawnWorker = options.spawnWorker ?? spawnNodeReplicaWorker;
  const sessions = new Map<string, Session>();

  const disposeSession = (workspaceToken: string, session: Session) => {
    sessions.delete(workspaceToken);
    return Effect.runPromise(Scope.close(session.scope, Exit.void));
  };

  const sessionFor = (event: ReplicaInvokeEvent, workspaceToken: string, action: string) => {
    const session = sessions.get(workspaceToken);
    if (!session) throw new Error("Unknown replica workspace.");
    if (session.senderId !== event.sender.id) {
      throw new Error(`Rejected replica ${action} from a different renderer.`);
    }
    return session;
  };

  const withSession = async <A, E>(
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
    action: string,
    use: (client: ReplicaWorkerClient) => Effect.Effect<A, E>,
  ): Promise<A> => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    const { client } = sessionFor(event, decodeWorkspaceToken(input), action);
    return Effect.runPromise(use(client));
  };

  const fulfilProxyRequest = (
    client: ReplicaWorkerClient,
    request: typeof ProxyFetchRequest.Type,
  ) =>
    Effect.tryPromise({
      try: () =>
        options.syncApiRequest(request.pathname, {
          method: request.method,
          body: request.bodyText,
        }),
      catch: (cause) => (cause instanceof Error ? cause.message : "Sync proxy failed."),
    }).pipe(
      Effect.catch((message) => Effect.succeed({ ok: false, status: 503, bodyText: message })),
      Effect.flatMap((result) => client.ProxyRespond({ requestId: request.requestId, result })),
    );

  const openSession = (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
    workspaceToken: string,
    scope: Scope.Closeable,
  ) =>
    Effect.gen(function* () {
      const client = yield* spawnWorker(options.workerPath);
      yield* client.Commits().pipe(
        Stream.runForEach((notice) =>
          Effect.sync(() => {
            if (!sender.isDestroyed()) {
              sender.send(REPLICA_COMMIT_CHANNEL, { workspaceToken, ...notice });
            }
          }),
        ),
        Effect.forkScoped,
      );
      yield* client.SyncHealth().pipe(
        Stream.runForEach((health) =>
          Effect.sync(() => {
            if (!sender.isDestroyed()) {
              sender.send(REPLICA_SYNC_HEALTH_CHANNEL, { workspaceToken, health });
            }
          }),
        ),
        Effect.forkScoped,
      );
      yield* client.ProxyRequests().pipe(
        Stream.mapEffect((request) => fulfilProxyRequest(client, request), {
          concurrency: "unbounded",
        }),
        Stream.runDrain,
        Effect.forkScoped,
      );
      const engine = yield* client.Open({
        ...identity,
        databasePath: path.join(
          options.userDataPath,
          "replicas",
          `${identity.organizationId}-${identity.userId}.sqlite`,
        ),
        apiBaseUrl: options.apiBaseUrl,
      });
      return { client, engine };
    }).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );

  const handlers: ReplicaIpcHandlers = {
    [REPLICA_OPEN_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const identity = decodeOpenInput(input);
      const workspaceToken = crypto.randomUUID();
      const scope = Effect.runSync(Scope.make());
      const opened = await Effect.runPromise(
        openSession(event.sender, identity, workspaceToken, scope),
      );
      sessions.set(workspaceToken, { senderId: event.sender.id, client: opened.client, scope });
      return { workspaceToken, engine: opened.engine };
    },
    [REPLICA_CLOSE_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const workspaceToken = decodeWorkspaceToken(input);
      if (!sessions.has(workspaceToken)) return;
      await disposeSession(workspaceToken, sessionFor(event, workspaceToken, "close"));
    },
    [REPLICA_STAMP_CHANNEL]: (event, input) =>
      withSession(event, input, "stamp", (client) => client.Stamp()),
    [REPLICA_READ_SUBSET_CHANNEL]: async (event, input) => {
      const read = decodeReadSubsetInput(input);
      return withSession(event, read.workspaceToken, "subset read", (client) =>
        client.ReadSubset({ spec: read.spec }),
      );
    },
    [REPLICA_OUTBOX_CHANNEL]: (event, input) =>
      withSession(event, input, "outbox read", (client) => client.ReadOutboxStatuses()),
    [REPLICA_ALLOCATION_CHANNEL]: (event, input) =>
      withSession(event, input, "command allocation", (client) => client.ReadCommandAllocation()),
    [REPLICA_ENQUEUE_CHANNEL]: async (event, input) => {
      const enqueue = decodeEnqueueInput(input);
      return withSession(event, enqueue.workspaceToken, "enqueue", (client) =>
        client.EnqueueLocal({ envelope: enqueue.envelope, createdAt: enqueue.createdAt }),
      );
    },
    [REPLICA_WAKE_CHANNEL]: (event, input) =>
      withSession(event, input, "wake", (client) => client.WakeSyncUpload()),
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    options.ipcMain.handle(channel, handler);
  }

  return {
    dispose: async () => {
      for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel);
      await Promise.all(
        [...sessions].map(([workspaceToken, session]) => disposeSession(workspaceToken, session)),
      );
    },
  };
};
