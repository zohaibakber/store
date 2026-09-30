import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ReplicaInsightsSummaryInput,
  ReplicaProductInsightsInput,
  ReplicaRestockPageInput,
} from "./analytics-rpc";
import { makeAnalyticsController, type AnalyticsController } from "./analytics-supervisor";
import { spawnNodeAnalyticsWorker } from "./analytics-worker-process";
import { assertTrustedIpcSender, type TrustedIpcSenderFrame } from "./ipc-sender";
import {
  makeReplicaAdmission,
  PROXY_CONCURRENCY,
  type ReplicaAdmission,
  type ReplicaAdmissionLimits,
} from "./replica-admission";
import {
  REPLICA_ANALYTICS_CHANNEL,
  REPLICA_CANCEL_READ_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_INSIGHTS_SUMMARY_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_PRODUCT_INSIGHTS_CHANNEL,
  REPLICA_READ_BATCH_CHANNEL,
  REPLICA_READ_INSIGHTS_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
  REPLICA_RESTOCK_PAGE_CHANNEL,
  REPLICA_RETRY_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_SUMMARIZE_SUBSET_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  type ReplicaAnalyticsEvent,
  type ReplicaCommitEvent,
  type ReplicaIpcBridge,
  type ReplicaSyncHealthEvent,
} from "./replica-channels";
import {
  ReplicaCancelReadInput,
  ReplicaCommandStatusInput,
  ReplicaEnqueueInput,
  ReplicaOpenInput,
  ReplicaReadBatchInput,
  ReplicaReadInsightsInput,
  ReplicaReadSubsetInput,
  ReplicaSummarizeSubsetInput,
  ReplicaWorkerFailure,
  ReplicaWorkspaceToken,
  type ProxyFetchRequest,
  type ProxyFetchResult,
} from "./replica-rpc";
import {
  DEFAULT_SUPERVISOR_POLICY,
  isWorkerLost,
  startReplicaSupervisor,
  type LiveReplicaWorker,
  type ReplicaReaderClient,
  type ReplicaSupervisor,
  type ReplicaSupervisorPolicy,
  type ReplicaWorkerClient,
  type SpawnReplicaReader,
  type SpawnReplicaWorker,
} from "./replica-supervisor";
import { spawnNodeReplicaReader, spawnNodeReplicaWorker } from "./replica-worker-process";

export type ReplicaSyncApiRequest = (
  pathname: string,
  init?: {
    readonly method?: "GET" | "POST";
    readonly body?: string | null;
    readonly timeoutMillis?: number;
  },
) => Promise<ProxyFetchResult>;

type ReplicaSenderListener = {
  (event: "did-navigate", listener: () => void): void;
  (event: "render-process-gone", listener: () => void): void;
  (event: "destroyed", listener: () => void): void;
};

type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (
    channel: string,
    event: ReplicaCommitEvent | ReplicaSyncHealthEvent | ReplicaAnalyticsEvent,
  ) => void;
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

export type ReplicaInvokeEvent = {
  readonly senderFrame: TrustedIpcSenderFrame | null;
  readonly sender: ReplicaSender;
};

type Session = {
  readonly senderId: number;
  readonly workspaceToken: string;
  readonly databasePath: string;
  readonly supervisor: ReplicaSupervisor;
  readonly reader: ReplicaSupervisor<ReplicaReaderClient>;
  readonly analytics: AnalyticsController;
  readonly admission: ReplicaAdmission;
  readonly scope: Scope.Closeable;
  readonly reads: Map<string, AbortController>;
};

type BridgeResult<Method> = Method extends (...args: never) => Promise<infer Result>
  ? Result
  : never;

const CHANNEL_METHODS = {
  [REPLICA_OPEN_CHANNEL]: "open",
  [REPLICA_CLOSE_CHANNEL]: "close",
  [REPLICA_STAMP_CHANNEL]: "stamp",
  [REPLICA_READ_SUBSET_CHANNEL]: "readSubset",
  [REPLICA_READ_BATCH_CHANNEL]: "readBatch",
  [REPLICA_CANCEL_READ_CHANNEL]: "cancelRead",
  [REPLICA_RETRY_CHANNEL]: "retryRecovery",
  [REPLICA_READ_INSIGHTS_CHANNEL]: "readInsights",
  [REPLICA_SUMMARIZE_SUBSET_CHANNEL]: "summarizeSubset",
  [REPLICA_INSIGHTS_SUMMARY_CHANNEL]: "readInsightsSummary",
  [REPLICA_PRODUCT_INSIGHTS_CHANNEL]: "readProductInsights",
  [REPLICA_RESTOCK_PAGE_CHANNEL]: "readRestockPage",
  [REPLICA_OUTBOX_CHANNEL]: "readOutboxStatuses",
  [REPLICA_ENQUEUE_CHANNEL]: "enqueueCommand",
  [REPLICA_COMMAND_STATUS_CHANNEL]: "readCommandStatus",
  [REPLICA_WAKE_CHANNEL]: "wakeSyncUpload",
} satisfies Record<string, keyof ReplicaIpcBridge>;

type ChannelMethod<Channel extends keyof typeof CHANNEL_METHODS> =
  ReplicaIpcBridge[(typeof CHANNEL_METHODS)[Channel]];

type ReplicaIpcInput = Parameters<ChannelMethod<keyof typeof CHANNEL_METHODS>>[0];

type ReplicaIpcHandlers = {
  readonly [Channel in keyof typeof CHANNEL_METHODS]: (
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
  ) => Promise<BridgeResult<ChannelMethod<Channel>>>;
};

type ReplicaIpcResult = BridgeResult<ChannelMethod<keyof typeof CHANNEL_METHODS>>;

export type ReplicaIpcListener = (
  event: ReplicaInvokeEvent,
  input: ReplicaIpcInput,
) => Promise<ReplicaIpcResult>;

const prepareReplicaDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true });
  const stale = (await readdir(directory)).filter(
    (name) => !name.startsWith(REPLICA_STORAGE_PREFIX),
  );
  await Promise.allSettled(
    stale.map((name) => rm(path.join(directory, name), { force: true, recursive: true })),
  );
};

const decodeWorkspaceToken = Schema.decodeUnknownSync(ReplicaWorkspaceToken);
const decodeOpenInput = Schema.decodeUnknownSync(ReplicaOpenInput);
const decodeReadSubsetInput = Schema.decodeUnknownSync(ReplicaReadSubsetInput);
const decodeReadBatchInput = Schema.decodeUnknownSync(ReplicaReadBatchInput);
const decodeCancelReadInput = Schema.decodeUnknownSync(ReplicaCancelReadInput);
const decodeReadInsightsInput = Schema.decodeUnknownSync(ReplicaReadInsightsInput);
const decodeSummarizeSubsetInput = Schema.decodeUnknownSync(ReplicaSummarizeSubsetInput);
const decodeInsightsSummaryInput = Schema.decodeUnknownSync(ReplicaInsightsSummaryInput);
const decodeProductInsightsInput = Schema.decodeUnknownSync(ReplicaProductInsightsInput);
const decodeRestockPageInput = Schema.decodeUnknownSync(ReplicaRestockPageInput);
const decodeEnqueueInput = Schema.decodeUnknownSync(ReplicaEnqueueInput);
const decodeCommandStatusInput = Schema.decodeUnknownSync(ReplicaCommandStatusInput);

const EXHAUSTED_MESSAGE =
  "The local database worker keeps stopping. Pending changes are saved on this device.";

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: {
    readonly handle: (channel: string, listener: ReplicaIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
  };
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly syncApiRequest: ReplicaSyncApiRequest;
  readonly liveAccessToken: (force: boolean) => Promise<string | null>;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly spawnWorker?: SpawnReplicaWorker;
  readonly spawnReader?: SpawnReplicaReader;
  readonly readerPath?: string;
  readonly supervisorPolicy?: Partial<ReplicaSupervisorPolicy>;
  readonly admissionLimits?: ReplicaAdmissionLimits;
  readonly closeGrace?: Duration.Input;
  readonly ownershipWait?: Duration.Input;
}) => {
  const spawnWorker = options.spawnWorker ?? spawnNodeReplicaWorker;
  const spawnReader = options.spawnReader ?? spawnNodeReplicaReader;
  const analyticsWorkerPath = path.join(path.dirname(options.workerPath), "analytics-worker.js");
  const readerPath =
    options.readerPath ?? path.join(path.dirname(options.workerPath), "replica-reader.js");
  const policy: ReplicaSupervisorPolicy = {
    ...DEFAULT_SUPERVISOR_POLICY,
    ...options.supervisorPolicy,
  };
  const closeGrace = options.closeGrace ?? Duration.seconds(8);
  const ownershipWait = options.ownershipWait ?? Duration.seconds(15);
  const sessions = new Map<string, Session>();
  const releasing = new Map<string, Set<Deferred.Deferred<void>>>();
  let foreground = true;

  const awaitRelease = (databasePath: string, own: Deferred.Deferred<void>) =>
    Effect.suspend(() =>
      Effect.forEach(
        [...(releasing.get(databasePath) ?? [])].filter((owner) => owner !== own),
        Deferred.await,
        { discard: true },
      ),
    ).pipe(
      Effect.timeoutOption(ownershipWait),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ReplicaWorkerFailure({
                message: "The previous workspace is still closing. Try again shortly.",
              }),
            ),
          onSome: () => Effect.void,
        }),
      ),
    );

  const holdOwnership = (databasePath: string) =>
    Effect.acquireRelease(
      Deferred.make<void>().pipe(
        Effect.tap((owner) =>
          Effect.sync(() => {
            const owners = releasing.get(databasePath) ?? new Set();
            owners.add(owner);
            releasing.set(databasePath, owners);
          }),
        ),
      ),
      (owner) =>
        Effect.sync(() => {
          const owners = releasing.get(databasePath);
          owners?.delete(owner);
          if (owners?.size === 0) releasing.delete(databasePath);
        }).pipe(Effect.andThen(Deferred.succeed(owner, undefined))),
    );

  const disposeSession = (session: Session) =>
    Effect.scoped(
      Effect.gen(function* () {
        sessions.delete(session.workspaceToken);
        yield* holdOwnership(session.databasePath);
        const closing = yield* Effect.forkDetach(Scope.close(session.scope, Exit.void));
        const graceful = yield* Effect.timeoutOption(Fiber.await(closing), closeGrace);
        if (Option.isNone(graceful)) {
          yield* Effect.all([session.supervisor.terminate, session.reader.terminate], {
            discard: true,
            concurrency: "unbounded",
          });
          yield* Fiber.await(closing);
        }
      }),
    );

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
    use: (session: Session) => Effect.Effect<A, E>,
  ): Promise<A> => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    return Effect.runPromise(use(sessionFor(event, decodeWorkspaceToken(input), action)));
  };

  const cancellableRead = async <A, E>(
    event: ReplicaInvokeEvent,
    workspaceToken: string,
    requestId: string,
    action: string,
    use: (session: Session) => Effect.Effect<A, E>,
  ): Promise<A> => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    const session = sessionFor(event, workspaceToken, action);
    const controller = new AbortController();
    session.reads.set(requestId, controller);
    return Effect.runPromise(use(session), { signal: controller.signal }).finally(() => {
      session.reads.delete(requestId);
    });
  };

  const applyForeground = (worker: LiveReplicaWorker, visible: boolean) =>
    worker.client.SetForeground({ visible }).pipe(Effect.ignore);

  const fulfilProxyRequest = (
    client: ReplicaWorkerClient,
    request: typeof ProxyFetchRequest.Type,
  ) =>
    Effect.tryPromise({
      try: () =>
        options.syncApiRequest(request.pathname, {
          method: request.method,
          body: request.bodyText,
          timeoutMillis: request.timeoutMillis,
        }),
      catch: (cause) => (cause instanceof Error ? cause.message : "Sync proxy failed."),
    }).pipe(
      Effect.catch((message) => Effect.succeed({ ok: false, status: 503, bodyText: message })),
      Effect.flatMap((result) => client.ProxyRespond({ requestId: request.requestId, result })),
    );

  const fulfilAccessTokenRequest = (
    client: ReplicaWorkerClient,
    request: { readonly requestId: string; readonly force: boolean },
  ) =>
    Effect.tryPromise(() => options.liveAccessToken(request.force)).pipe(
      Effect.orElseSucceed(() => null),
      Effect.flatMap((token) => client.AccessTokenRespond({ requestId: request.requestId, token })),
    );

  const releaseWithSender = (sender: ReplicaSender, release: () => void) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        sender.on("did-navigate", release);
        sender.on("render-process-gone", release);
        sender.on("destroyed", release);
      }),
      () =>
        Effect.sync(() => {
          sender.removeListener("did-navigate", release);
          sender.removeListener("render-process-gone", release);
          sender.removeListener("destroyed", release);
        }),
    );

  const forwardStream = <A, E>(
    stream: Stream.Stream<A, E>,
    forward: (value: A) => Effect.Effect<unknown>,
  ) =>
    stream.pipe(
      Stream.runForEach(forward),
      Effect.catchCause(() => Effect.void),
      Effect.forkScoped,
    );

  const attachStreams =
    (sender: ReplicaSender, workspaceToken: string, analytics: AnalyticsController) =>
    (worker: LiveReplicaWorker, recovered: boolean) =>
      Effect.gen(function* () {
        const { client } = worker;
        yield* forwardStream(client.Commits(), (notice) =>
          Effect.sync(() => {
            if (!sender.isDestroyed()) {
              sender.send(REPLICA_COMMIT_CHANNEL, { workspaceToken, ...notice });
            }
          }).pipe(Effect.andThen(analytics.notify(notice))),
        );
        yield* forwardStream(client.SyncHealth(), (health) =>
          Effect.sync(() => {
            if (!sender.isDestroyed()) {
              sender.send(REPLICA_SYNC_HEALTH_CHANNEL, { workspaceToken, health });
            }
          }),
        );
        yield* client.ProxyRequests().pipe(
          Stream.mapEffect((request) => fulfilProxyRequest(client, request), {
            concurrency: PROXY_CONCURRENCY,
            unordered: true,
          }),
          Stream.runDrain,
          Effect.catchCause(() => Effect.void),
          Effect.forkScoped,
        );
        yield* client.AccessTokenRequests().pipe(
          Stream.mapEffect((request) => fulfilAccessTokenRequest(client, request), {
            concurrency: 1,
          }),
          Stream.runDrain,
          Effect.catchCause(() => Effect.void),
          Effect.forkScoped,
        );
        if (!foreground) yield* applyForeground(worker, false);
        if (recovered) {
          const stamp = yield* client.Stamp().pipe(Effect.option);
          if (Option.isSome(stamp) && !sender.isDestroyed()) {
            const invalidation = {
              ...stamp.value,
              touchedEntities: [],
              touchedKeys: [],
              fullInvalidation: true,
            };
            sender.send(REPLICA_COMMIT_CHANNEL, { workspaceToken, ...invalidation });
            yield* analytics.notify(invalidation);
          }
        }
      });

  const openSession = (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
    workspaceToken: string,
    databasePath: string,
    scope: Scope.Closeable,
    release: () => void,
  ) =>
    Effect.gen(function* () {
      yield* releaseWithSender(sender, release);
      yield* Effect.promise(() => prepareReplicaDirectory(path.dirname(databasePath)));
      const analytics = yield* makeAnalyticsController({
        spawn: spawnNodeAnalyticsWorker,
        launch: {
          workerPath: analyticsWorkerPath,
          boot: {
            replicaDatabasePath: databasePath,
            analyticsDatabasePath: analyticsDatabasePath(databasePath),
          },
        },
        onEvent: (analyticsEvent) =>
          Effect.sync(() => {
            if (!sender.isDestroyed()) {
              sender.send(REPLICA_ANALYTICS_CHANNEL, { workspaceToken, ...analyticsEvent });
            }
          }),
      });
      const onExhausted = Effect.sync(() => {
        if (!sender.isDestroyed()) {
          sender.send(REPLICA_SYNC_HEALTH_CHANNEL, {
            workspaceToken,
            health: { _tag: "recoveryRequired", message: EXHAUSTED_MESSAGE, retryable: true },
          });
        }
      });
      const supervisor = yield* startReplicaSupervisor({
        spawn: spawnWorker,
        launch: {
          workerPath: options.workerPath,
          boot: { ...identity, databasePath, apiBaseUrl: options.apiBaseUrl },
        },
        policy,
        attach: attachStreams(sender, workspaceToken, analytics),
        onExhausted,
      });
      const reader = yield* startReplicaSupervisor({
        spawn: spawnReader,
        launch: { workerPath: readerPath, boot: { databasePath } },
        policy,
        attach: () => Effect.void,
        onExhausted,
      });
      return { supervisor, reader, analytics };
    }).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );

  const enqueue = (session: Session, input: ReturnType<typeof decodeEnqueueInput>) =>
    session.admission.write(
      session.supervisor
        .use((worker) => worker.client.EnqueueCommand({ request: input.request }))
        .pipe(
          Effect.catchIf(isWorkerLost, () =>
            session.supervisor.use((worker) =>
              worker.client.ReadCommandStatus({ operationId: input.request.operationId }).pipe(
                Effect.flatMap((status) =>
                  status === null
                    ? worker.client.EnqueueCommand({ request: input.request })
                    : worker.client.Stamp().pipe(
                        Effect.map((stamp) => ({
                          operationId: input.request.operationId,
                          status,
                          stamp,
                        })),
                      ),
                ),
              ),
            ),
          ),
        ),
    );

  const handlers: ReplicaIpcHandlers = {
    [REPLICA_OPEN_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const identity = decodeOpenInput(input);
      const workspaceToken = crypto.randomUUID();
      const databasePath = path.join(
        options.userDataPath,
        "replicas",
        sqliteReplicaFileName(`${identity.organizationId}-${identity.userId}`),
      );
      const scope = Effect.runSync(Scope.make());
      const gone = Effect.runSync(Deferred.make<void>());
      const release = () => {
        Deferred.doneUnsafe(gone, Exit.void);
        const session = sessions.get(workspaceToken);
        if (session) void Effect.runPromise(disposeSession(session));
      };
      const opened = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const own = yield* holdOwnership(databasePath);
            yield* awaitRelease(databasePath, own);
            const admission = yield* makeReplicaAdmission(options.admissionLimits);
            const started = yield* openSession(
              event.sender,
              identity,
              workspaceToken,
              databasePath,
              scope,
              release,
            );
            if (Deferred.isDoneUnsafe(gone) || event.sender.isDestroyed()) {
              yield* Scope.close(scope, Exit.void);
              return undefined;
            }
            sessions.set(workspaceToken, {
              senderId: event.sender.id,
              workspaceToken,
              databasePath,
              supervisor: started.supervisor,
              reader: started.reader,
              analytics: started.analytics,
              admission,
              scope,
              reads: new Map(),
            });
            return started;
          }),
        ),
      );
      if (opened === undefined) {
        throw new Error("The replica renderer went away while the workspace was opening.");
      }
      return { workspaceToken, engine: opened.supervisor.engine };
    },
    [REPLICA_CLOSE_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const workspaceToken = decodeWorkspaceToken(input);
      if (!sessions.has(workspaceToken)) return;
      await Effect.runPromise(disposeSession(sessionFor(event, workspaceToken, "close")));
    },
    [REPLICA_STAMP_CHANNEL]: (event, input) =>
      withSession(event, input, "stamp", (session) =>
        session.supervisor.useIdempotent((worker) => worker.client.Stamp()),
      ),
    [REPLICA_READ_SUBSET_CHANNEL]: async (event, input) => {
      const read = decodeReadSubsetInput(input);
      return cancellableRead(event, read.workspaceToken, read.requestId, "subset read", (session) =>
        session.admission.read(
          session.reader.useIdempotent((reader) => reader.client.ReadSubset({ spec: read.spec })),
        ),
      );
    },
    [REPLICA_READ_BATCH_CHANNEL]: async (event, input) => {
      const read = decodeReadBatchInput(input);
      return cancellableRead(event, read.workspaceToken, read.requestId, "batch read", (session) =>
        session.admission.read(
          session.reader.useIdempotent((reader) => reader.client.ReadBatch({ specs: read.specs })),
        ),
      );
    },
    [REPLICA_CANCEL_READ_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const cancel = decodeCancelReadInput(input);
      sessionFor(event, cancel.workspaceToken, "read cancel").reads.get(cancel.requestId)?.abort();
    },
    [REPLICA_RETRY_CHANNEL]: (event, input) =>
      withSession(event, input, "recovery retry", (session) =>
        Effect.all([session.supervisor.retry, session.reader.retry], { discard: true }),
      ),
    [REPLICA_READ_INSIGHTS_CHANNEL]: async (event, input) => {
      const read = decodeReadInsightsInput(input);
      return withSession(event, read.workspaceToken, "insights read", (session) =>
        session.admission.read(
          session.supervisor.useIdempotent((worker) =>
            worker.client.ReadInsights({ window: read.window }),
          ),
        ),
      );
    },
    [REPLICA_SUMMARIZE_SUBSET_CHANNEL]: async (event, input) => {
      const read = decodeSummarizeSubsetInput(input);
      return withSession(event, read.workspaceToken, "subset summary", (session) =>
        session.admission.read(
          session.reader.useIdempotent((reader) =>
            reader.client.SummarizeSubset({ spec: read.spec }),
          ),
        ),
      );
    },
    [REPLICA_INSIGHTS_SUMMARY_CHANNEL]: async (event, input) => {
      const read = decodeInsightsSummaryInput(input);
      return withSession(event, read.workspaceToken, "insights summary", (session) =>
        session.analytics.use((client) => client.ReadSummary({ context: read.context })),
      );
    },
    [REPLICA_PRODUCT_INSIGHTS_CHANNEL]: async (event, input) => {
      const read = decodeProductInsightsInput(input);
      return withSession(event, read.workspaceToken, "product insights", (session) =>
        session.analytics.use((client) =>
          client.ReadProducts({ context: read.context, ids: read.ids }),
        ),
      );
    },
    [REPLICA_RESTOCK_PAGE_CHANNEL]: async (event, input) => {
      const read = decodeRestockPageInput(input);
      return withSession(event, read.workspaceToken, "restock page", (session) =>
        session.analytics.use((client) =>
          client.ReadRestockPage({ context: read.context, request: read.request }),
        ),
      );
    },
    [REPLICA_OUTBOX_CHANNEL]: (event, input) =>
      withSession(event, input, "outbox read", (session) =>
        session.admission.read(
          session.supervisor.useIdempotent((worker) => worker.client.ReadOutboxStatuses()),
        ),
      ),
    [REPLICA_ENQUEUE_CHANNEL]: async (event, input) => {
      const request = decodeEnqueueInput(input);
      return withSession(event, request.workspaceToken, "enqueue", (session) =>
        enqueue(session, request),
      );
    },
    [REPLICA_COMMAND_STATUS_CHANNEL]: async (event, input) => {
      const status = decodeCommandStatusInput(input);
      return withSession(event, status.workspaceToken, "command status", (session) =>
        session.supervisor.useIdempotent((worker) =>
          worker.client.ReadCommandStatus({ operationId: status.operationId }),
        ),
      );
    },
    [REPLICA_WAKE_CHANNEL]: (event, input) =>
      withSession(event, input, "wake", (session) =>
        session.supervisor
          .use((worker) => worker.client.WakeSyncUpload())
          .pipe(Effect.orElseSucceed(() => ({ drained: false, drainCount: 0 }))),
      ),
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    options.ipcMain.handle(channel, handler);
  }

  return {
    setForeground: async (visible: boolean) => {
      if (visible === foreground) return;
      foreground = visible;
      await Effect.runPromise(
        Effect.forEach(
          [...sessions.values()],
          (session) =>
            session.supervisor
              .use((worker) => applyForeground(worker, visible))
              .pipe(Effect.ignore),
          { discard: true },
        ),
      );
    },
    dispose: async () => {
      for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel);
      await Effect.runPromise(
        Effect.forEach([...sessions.values()], disposeSession, {
          discard: true,
          concurrency: "unbounded",
        }),
      );
    },
  };
};
