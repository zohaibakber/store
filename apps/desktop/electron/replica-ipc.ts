import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import { InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import type { DeviceLabel } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { LocalCatalogReport } from "../src/lib/local-catalog-standing";
import type { RestoreChoice, RestoreOutcome } from "../src/lib/workspace-backup";
import type { PublishOffer, PublishProgress } from "../src/lib/workspace-publish";
import {
  ReplicaInsightsSummaryInput,
  ReplicaProductInsightsInput,
  ReplicaRestockPageInput,
} from "./analytics-rpc";
import { makeAnalyticsController, type AnalyticsController } from "./analytics-supervisor";
import { spawnNodeAnalyticsWorker } from "./analytics-worker-process";
import {
  BACKUP_SAVE_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
  type WorkspaceBackupIpcBridge,
} from "./backup-channels";
import { assertTrustedIpcSender, type TrustedIpcSenderFrame } from "./ipc-sender";
import {
  PUBLISH_DISCARD_CHANNEL,
  PUBLISH_LOCAL_CATALOG_CHANNEL,
  PUBLISH_OFFER_CHANNEL,
  PUBLISH_PROGRESS_CHANNEL,
  PUBLISH_START_CHANNEL,
  type WorkspacePublishIpcBridge,
} from "./publish-channels";
import {
  admitReplicaKey,
  LOCAL_REPLICA_KEY,
  makeReplicaAdmission,
  PROXY_CONCURRENCY,
  type ReplicaAdmission,
  type ReplicaAdmissionLimits,
} from "./replica-admission";
import {
  REPLICA_ACTIVITY_CHANNEL,
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
  discardPublish,
  publishLocalWorkspace,
  readLocalCatalog,
  readPublishOffer,
  type PublishPorts,
} from "./replica-publish";
import { isExpiredReplicaArchive } from "./replica-publish-files";
import {
  backupFileName,
  removeReplicaFile,
  restorePreviousReplicaFile,
  swapReplicaFile,
} from "./replica-restore-files";
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
  type ReplicaAuthority,
  type ReplicaWorkerBoot,
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
    readonly signal?: AbortSignal;
  },
) => Promise<ProxyFetchResult>;

type ReplicaSenderListener = {
  (event: "did-navigate", listener: () => void): void;
  (event: "render-process-gone", listener: () => void): void;
  (event: "destroyed", listener: () => void): void;
};

export type ReplicaSentEvent =
  | ReplicaCommitEvent
  | ReplicaSyncHealthEvent
  | ReplicaAnalyticsEvent
  | PublishProgress;

type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, event: ReplicaSentEvent) => void;
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

export type ReplicaInvokeEvent = {
  readonly senderFrame: TrustedIpcSenderFrame | null;
  readonly sender: ReplicaSender;
};

export type ReplicaBackupDialogs = {
  readonly chooseDestination: (suggestedName: string) => Promise<string | null>;
  readonly chooseSource: () => Promise<string | null>;
};

type Session = {
  readonly senderId: number;
  readonly sender: ReplicaSender;
  readonly identity: typeof ReplicaOpenInput.Type;
  readonly release: () => void;
  readonly gate: Latch.Latch;
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
  [REPLICA_ACTIVITY_CHANNEL]: "readSyncActivity",
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

const BACKUP_CHANNEL_METHODS = {
  [BACKUP_SAVE_CHANNEL]: "backUp",
  [RESTORE_CHOOSE_CHANNEL]: "chooseRestore",
  [RESTORE_APPLY_CHANNEL]: "applyRestore",
  [RESTORE_DISCARD_CHANNEL]: "discardRestore",
} satisfies Record<string, keyof WorkspaceBackupIpcBridge>;

type BackupResult<Channel extends keyof typeof BACKUP_CHANNEL_METHODS> = BridgeResult<
  WorkspaceBackupIpcBridge[(typeof BACKUP_CHANNEL_METHODS)[Channel]]
>;

type BackupIpcHandlers = {
  readonly [Channel in keyof typeof BACKUP_CHANNEL_METHODS]: (
    event: ReplicaInvokeEvent,
  ) => Promise<BackupResult<Channel>>;
};

const PUBLISH_CHANNEL_METHODS = {
  [PUBLISH_OFFER_CHANNEL]: "offer",
  [PUBLISH_START_CHANNEL]: "publish",
  [PUBLISH_DISCARD_CHANNEL]: "discard",
  [PUBLISH_LOCAL_CATALOG_CHANNEL]: "localCatalog",
} satisfies Record<string, keyof WorkspacePublishIpcBridge>;

type PublishResult<Channel extends keyof typeof PUBLISH_CHANNEL_METHODS> = BridgeResult<
  WorkspacePublishIpcBridge[(typeof PUBLISH_CHANNEL_METHODS)[Channel]]
>;

type PublishIpcHandlers = {
  readonly [Channel in keyof typeof PUBLISH_CHANNEL_METHODS]: (
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
  ) => Promise<PublishResult<Channel>>;
};

type ReplicaIpcResult =
  | BridgeResult<ChannelMethod<keyof typeof CHANNEL_METHODS>>
  | BackupResult<keyof typeof BACKUP_CHANNEL_METHODS>
  | PublishResult<keyof typeof PUBLISH_CHANNEL_METHODS>;

export type ReplicaIpcListener = (
  event: ReplicaInvokeEvent,
  input: ReplicaIpcInput,
) => Promise<ReplicaIpcResult>;

const prepareReplicaDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true });
  const now = Date.now();
  const stale = (await readdir(directory)).filter(
    (name) => !name.startsWith(REPLICA_STORAGE_PREFIX) || isExpiredReplicaArchive(name, now),
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

const RESTORE_LOCAL_ONLY = "Only the workspace on this device can be restored from a file.";

const NO_WORKSPACE = "Open a workspace before using backups.";

const PUBLISH_NEEDS_ORGANIZATION = "Open the organization that should receive this device's data.";

const PUBLISH_LOCAL_OPEN = "Close the workspace on this device before moving its data.";

const PUBLISH_UNDERWAY = "This device's data is already being moved.";

const NO_PUBLISH_OFFER: PublishOffer = { _tag: "none" };

const UNKNOWN_LOCAL_CATALOG: LocalCatalogReport = { _tag: "unknown" };

const CATALOG_SOURCES = InventorySubsetSummarySpec.fields.source.literals;

const decodeOrganizationId = Schema.decodeUnknownSync(ReplicaWorkspaceToken);

const failed = (message: string) => ({ _tag: "failed" as const, message });

const messageOf = (cause: { readonly message: string }) => cause.message;

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: {
    readonly handle: (channel: string, listener: ReplicaIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
  };
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
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
  readonly backupDialogs?: ReplicaBackupDialogs;
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
  const replicaDatabasePath = (key: string) =>
    path.join(options.userDataPath, "replicas", sqliteReplicaFileName(key));
  const localDatabasePath = replicaDatabasePath(LOCAL_REPLICA_KEY);
  const publishTurn = Semaphore.makeUnsafe(1);
  const sessions = new Map<string, Session>();
  const stagedRestores = new Map<string, string>();
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

  const closeWorkers = (workers: Pick<Session, "scope" | "supervisor" | "reader">) =>
    Effect.gen(function* () {
      const closing = yield* Effect.forkDetach(Scope.close(workers.scope, Exit.void));
      const graceful = yield* Effect.timeoutOption(Fiber.await(closing), closeGrace);
      if (Option.isNone(graceful)) {
        yield* Effect.all([workers.supervisor.terminate, workers.reader.terminate], {
          discard: true,
          concurrency: "unbounded",
        });
        yield* Fiber.await(closing);
      }
    });

  const discardStagedRestore = (workspaceToken: string) =>
    Effect.suspend(() => {
      const stagedPath = stagedRestores.get(workspaceToken);
      stagedRestores.delete(workspaceToken);
      return stagedPath === undefined ? Effect.void : removeReplicaFile(stagedPath);
    });

  const disposeSession = (session: Session) =>
    Effect.scoped(
      Effect.gen(function* () {
        sessions.delete(session.workspaceToken);
        yield* discardStagedRestore(session.workspaceToken);
        yield* holdOwnership(session.databasePath);
        yield* closeWorkers(session);
        yield* session.gate.open;
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

  const onceOpen = <A, E>(
    event: ReplicaInvokeEvent,
    workspaceToken: string,
    action: string,
    use: (session: Session) => Effect.Effect<A, E>,
  ) =>
    sessionFor(event, workspaceToken, action).gate.whenOpen(
      Effect.suspend(() => use(sessionFor(event, workspaceToken, action))),
    );

  const onceOpenSession = <A, E>(
    session: Session,
    use: (session: Session) => Effect.Effect<A, E>,
  ) =>
    session.gate.whenOpen(
      Effect.suspend(() => use(sessions.get(session.workspaceToken) ?? session)),
    );

  const withSession = async <A, E>(
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
    action: string,
    use: (session: Session) => Effect.Effect<A, E>,
  ): Promise<A> => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    return Effect.runPromise(onceOpen(event, decodeWorkspaceToken(input), action, use));
  };

  const cancellableRead = async <A, E>(
    event: ReplicaInvokeEvent,
    workspaceToken: string,
    requestId: string,
    action: string,
    use: (session: Session) => Effect.Effect<A, E>,
  ): Promise<A> => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    const { reads } = sessionFor(event, workspaceToken, action);
    const controller = new AbortController();
    reads.set(requestId, controller);
    return Effect.runPromise(onceOpen(event, workspaceToken, action, use), {
      signal: controller.signal,
    }).finally(() => {
      reads.delete(requestId);
    });
  };

  const applyForeground = (worker: LiveReplicaWorker, visible: boolean) =>
    worker.client.SetForeground({ visible }).pipe(Effect.ignore);

  const fulfilProxyRequest = (
    client: ReplicaWorkerClient,
    request: typeof ProxyFetchRequest.Type,
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        options.syncApiRequest(request.pathname, {
          method: request.method,
          body: request.bodyText,
          timeoutMillis: request.timeoutMillis,
          signal,
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

  const attachNetwork = (client: ReplicaWorkerClient) =>
    Effect.gen(function* () {
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
    });

  const attachAuthority = (client: ReplicaWorkerClient, authority: ReplicaAuthority) => {
    switch (authority) {
      case "local":
        return Effect.void;
      case "remote":
        return attachNetwork(client);
    }
  };

  const bootFor = (
    identity: typeof ReplicaOpenInput.Type,
    databasePath: string,
  ): typeof ReplicaWorkerBoot.Type => {
    switch (identity.authority) {
      case "local":
        return { ...identity, databasePath };
      case "remote":
        return {
          ...identity,
          databasePath,
          apiBaseUrl: options.apiBaseUrl,
          ...(options.deviceLabel === undefined ? undefined : { deviceLabel: options.deviceLabel }),
        };
    }
  };

  const publishInvalidation = (
    sender: ReplicaSender,
    workspaceToken: string,
    analytics: AnalyticsController,
    stamp: { readonly generationId: string; readonly localCommitVersion: number },
  ) =>
    Effect.suspend(() => {
      const invalidation = {
        ...stamp,
        touchedEntities: [],
        touchedKeys: [],
        fullInvalidation: true,
      };
      if (!sender.isDestroyed()) {
        sender.send(REPLICA_COMMIT_CHANNEL, { workspaceToken, ...invalidation });
      }
      return analytics.notify(invalidation);
    });

  const attachStreams =
    (
      sender: ReplicaSender,
      workspaceToken: string,
      analytics: AnalyticsController,
      authority: ReplicaAuthority,
    ) =>
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
        yield* attachAuthority(client, authority);
        if (!foreground) yield* applyForeground(worker, false);
        if (recovered) {
          const stamp = yield* client.Stamp().pipe(Effect.option);
          if (Option.isSome(stamp) && !sender.isDestroyed()) {
            yield* publishInvalidation(sender, workspaceToken, analytics, stamp.value);
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
          boot: bootFor(identity, databasePath),
        },
        policy,
        attach: attachStreams(sender, workspaceToken, analytics, identity.authority),
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

  const currentSession = (event: ReplicaInvokeEvent) => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    return [...sessions.values()].filter((session) => session.senderId === event.sender.id).at(-1);
  };

  const reopenWorkers = (session: Session) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const started = yield* openSession(
        session.sender,
        session.identity,
        session.workspaceToken,
        session.databasePath,
        scope,
        session.release,
      );
      const workers = { scope, supervisor: started.supervisor, reader: started.reader };
      const stamp =
        started.supervisor.engine === "sqlite" && started.reader.engine === "sqlite"
          ? yield* started.supervisor.use((worker) => worker.client.Stamp()).pipe(Effect.option)
          : Option.none();
      if (Option.isNone(stamp)) {
        yield* closeWorkers(workers);
        return yield* new ReplicaWorkerFailure({
          message: "The workspace could not be opened.",
        });
      }
      if (!sessions.has(session.workspaceToken) || session.sender.isDestroyed()) {
        yield* closeWorkers(workers);
        return yield* new ReplicaWorkerFailure({
          message: "The window closed before the workspace reopened.",
        });
      }
      const reopened: Session = { ...session, ...started, scope, reads: new Map() };
      sessions.set(session.workspaceToken, reopened);
      return { session: reopened, stamp: stamp.value };
    });

  const resumeUnchanged = (session: Session, reason: string) =>
    reopenWorkers(session).pipe(
      Effect.as(failed(`${reason} Your workspace is unchanged.`)),
      Effect.catch(() =>
        Effect.sync(() => {
          sessions.delete(session.workspaceToken);
          return failed(`${reason} Your workspace is unchanged. Restart Tabaaq to open it.`);
        }),
      ),
    );

  const backUp = (session: Session, dialogs: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const destination = yield* Effect.tryPromise(() =>
        dialogs.chooseDestination(backupFileName(now)),
      );
      if (destination === null) return { _tag: "cancelled" as const };
      const written = yield* onceOpenSession(session, (current) =>
        current.supervisor.use((worker) => worker.client.BackUp({ destinationPath: destination })),
      );
      return {
        _tag: "saved" as const,
        fileName: path.basename(destination),
        bytes: written.bytes,
      };
    }).pipe(Effect.catch((cause) => Effect.succeed(failed(messageOf(cause)))));

  const stageRestore = (session: Session, dialogs: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const source = yield* Effect.tryPromise(() => dialogs.chooseSource());
      if (source === null) return { _tag: "cancelled" as const };
      yield* discardStagedRestore(session.workspaceToken);
      const stagedPath = path.join(
        path.dirname(session.databasePath),
        `restore-${crypto.randomUUID()}.sqlite`,
      );
      const staged = yield* onceOpenSession(session, (current) =>
        current.supervisor.use((worker) =>
          worker.client.StageRestore({ sourcePath: source, stagedPath }),
        ),
      );
      stagedRestores.set(session.workspaceToken, stagedPath);
      return {
        _tag: "staged" as const,
        fileName: path.basename(source),
        current: staged.current,
        backup: staged.backup,
      };
    }).pipe(Effect.catch((cause) => Effect.succeed(failed(messageOf(cause)))));

  const applyRestore = (session: Session, stagedPath: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const previousPath = `${session.databasePath}.before-restore-${yield* Clock.currentTimeMillis}`;
        yield* Effect.acquireRelease(session.gate.close, () => session.gate.open);
        yield* holdOwnership(session.databasePath);
        const released = yield* session.admission
          .read(
            session.admission.write(
              session.supervisor
                .use((worker) => worker.client.ReleaseForRestore({ stagedPath }))
                .pipe(Effect.ensuring(closeWorkers(session))),
            ),
          )
          .pipe(Effect.result);
        if (Result.isFailure(released)) {
          yield* closeWorkers(session);
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, messageOf(released.failure));
        }
        const swapped = yield* swapReplicaFile({
          databasePath: session.databasePath,
          stagedPath,
          previousPath,
        }).pipe(Effect.result);
        if (Result.isFailure(swapped)) {
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, messageOf(swapped.failure));
        }
        const reopened = yield* reopenWorkers(session).pipe(Effect.result);
        if (Result.isFailure(reopened)) {
          const putBack = yield* restorePreviousReplicaFile({
            databasePath: session.databasePath,
            previousPath,
          }).pipe(Effect.result);
          if (Result.isSuccess(putBack)) {
            return yield* resumeUnchanged(session, "The backup could not be opened.");
          }
          sessions.delete(session.workspaceToken);
          return failed(
            `The backup could not be opened. Your previous workspace is saved as ${path.basename(previousPath)}.`,
          );
        }
        yield* removeReplicaFile(previousPath);
        yield* publishInvalidation(
          reopened.success.session.sender,
          session.workspaceToken,
          reopened.success.session.analytics,
          reopened.success.stamp,
        );
        return { _tag: "restored" as const };
      }),
    );

  const chooseRestore = (
    session: Session,
    dialogs: ReplicaBackupDialogs,
  ): Promise<RestoreChoice> => {
    switch (session.identity.authority) {
      case "local":
        return Effect.runPromise(stageRestore(session, dialogs));
      case "remote":
        return Promise.resolve(failed(RESTORE_LOCAL_ONLY));
    }
  };

  const replaceWorkspace = (session: Session, stagedPath: string): Promise<RestoreOutcome> => {
    switch (session.identity.authority) {
      case "local":
        return Effect.runPromise(applyRestore(session, stagedPath));
      case "remote":
        return Promise.resolve(failed(RESTORE_LOCAL_ONLY));
    }
  };

  const backupHandlers: BackupIpcHandlers = {
    [BACKUP_SAVE_CHANNEL]: async (event) => {
      const session = currentSession(event);
      const dialogs = options.backupDialogs;
      if (session === undefined || dialogs === undefined) return failed(NO_WORKSPACE);
      return Effect.runPromise(backUp(session, dialogs));
    },
    [RESTORE_CHOOSE_CHANNEL]: async (event) => {
      const session = currentSession(event);
      const dialogs = options.backupDialogs;
      if (session === undefined || dialogs === undefined) return failed(NO_WORKSPACE);
      return chooseRestore(session, dialogs);
    },
    [RESTORE_APPLY_CHANNEL]: async (event) => {
      const session = currentSession(event);
      if (session === undefined) return failed(NO_WORKSPACE);
      const stagedPath = stagedRestores.get(session.workspaceToken);
      if (stagedPath === undefined) return failed("Choose a backup file first.");
      stagedRestores.delete(session.workspaceToken);
      return replaceWorkspace(session, stagedPath);
    },
    [RESTORE_DISCARD_CHANNEL]: async (event) => {
      const session = currentSession(event);
      if (session !== undefined) {
        await Effect.runPromise(discardStagedRestore(session.workspaceToken));
      }
    },
  };

  const publishPortsFor = (session: Session, organizationId: string): PublishPorts => ({
    organizationId,
    databasePath: localDatabasePath,
    worker: (use) =>
      onceOpenSession(session, (current) =>
        current.supervisor.use((worker) => use(worker.client)),
      ).pipe(Effect.mapError((cause) => new ReplicaWorkerFailure({ message: messageOf(cause) }))),
    progress: (progress) =>
      Effect.try(() => {
        if (!session.sender.isDestroyed()) session.sender.send(PUBLISH_PROGRESS_CHANNEL, progress);
      }).pipe(Effect.ignore),
  });

  const readOpenCatalog = (session: Session): Effect.Effect<LocalCatalogReport> =>
    onceOpenSession(session, (current) =>
      Effect.findFirst(CATALOG_SOURCES, (source) =>
        current.admission
          .read(
            current.reader.useIdempotent((reader) =>
              reader.client.SummarizeSubset({ spec: { source, distinct: [] } }),
            ),
          )
          .pipe(Effect.map((read) => read.summary.count > 0)),
      ),
    ).pipe(
      Effect.map((stocked): LocalCatalogReport => ({
        _tag: Option.isSome(stocked) ? "stocked" : "empty",
      })),
      Effect.catch(() => Effect.succeed(UNKNOWN_LOCAL_CATALOG)),
    );

  const withLocalReplicaClosed = <A>(
    session: Session | undefined,
    organizationId: string,
    use: (ports: PublishPorts) => Effect.Effect<A>,
    otherwise: (message: string) => A,
  ): Effect.Effect<A> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (
          session === undefined ||
          session.identity.authority !== "remote" ||
          session.identity.organizationId !== organizationId
        ) {
          return otherwise(PUBLISH_NEEDS_ORGANIZATION);
        }
        const own = yield* holdOwnership(localDatabasePath);
        yield* awaitRelease(localDatabasePath, own);
        if ([...sessions.values()].some((open) => open.databasePath === localDatabasePath)) {
          return otherwise(PUBLISH_LOCAL_OPEN);
        }
        return yield* use(publishPortsFor(session, organizationId));
      }),
    ).pipe(Effect.catch((cause) => Effect.succeed(otherwise(messageOf(cause)))));

  const publishHandlers: PublishIpcHandlers = {
    [PUBLISH_OFFER_CHANNEL]: async (event, input) =>
      Effect.runPromise(
        withLocalReplicaClosed(
          currentSession(event),
          decodeOrganizationId(input),
          readPublishOffer,
          () => NO_PUBLISH_OFFER,
        ),
      ),
    [PUBLISH_START_CHANNEL]: async (event, input) =>
      Effect.runPromise(
        publishTurn
          .withPermitsIfAvailable(1)(
            withLocalReplicaClosed(
              currentSession(event),
              decodeOrganizationId(input),
              publishLocalWorkspace,
              failed,
            ),
          )
          .pipe(Effect.map(Option.getOrElse(() => failed(PUBLISH_UNDERWAY)))),
      ),
    [PUBLISH_DISCARD_CHANNEL]: async (event, input) =>
      Effect.runPromise(
        publishTurn
          .withPermitsIfAvailable(1)(
            withLocalReplicaClosed(
              currentSession(event),
              decodeOrganizationId(input),
              discardPublish,
              () => NO_PUBLISH_OFFER,
            ),
          )
          .pipe(Effect.map(Option.getOrElse(() => NO_PUBLISH_OFFER))),
      ),
    [PUBLISH_LOCAL_CATALOG_CHANNEL]: async (event) => {
      const session = currentSession(event);
      if (session === undefined) return UNKNOWN_LOCAL_CATALOG;
      switch (session.identity.authority) {
        case "local":
          return Effect.runPromise(readOpenCatalog(session));
        case "remote":
          return Effect.runPromise(
            withLocalReplicaClosed(
              session,
              session.identity.organizationId,
              readLocalCatalog,
              () => UNKNOWN_LOCAL_CATALOG,
            ),
          );
      }
    },
  };

  const handlers: ReplicaIpcHandlers = {
    [REPLICA_OPEN_CHANNEL]: async (event, input) => {
      assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
      const identity = decodeOpenInput(input);
      const workspaceToken = crypto.randomUUID();
      const databasePath = replicaDatabasePath(Result.getOrThrow(admitReplicaKey(identity)));
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
              sender: event.sender,
              identity,
              release,
              gate: yield* Latch.make(true),
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
    [REPLICA_ACTIVITY_CHANNEL]: (event, input) =>
      withSession(event, input, "activity read", (session) =>
        session.admission.read(
          session.supervisor.useIdempotent((worker) => worker.client.ReadSyncActivity()),
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

  const registered = { ...handlers, ...backupHandlers, ...publishHandlers } satisfies Record<
    string,
    ReplicaIpcListener
  >;

  for (const [channel, handler] of Object.entries(registered)) {
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
      for (const channel of Object.keys(registered)) options.ipcMain.removeHandler(channel);
      await Effect.runPromise(
        Effect.forEach([...sessions.values()], disposeSession, {
          discard: true,
          concurrency: "unbounded",
        }),
      );
    },
  };
};
