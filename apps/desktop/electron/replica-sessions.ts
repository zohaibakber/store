import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import type { PublishProgress } from "@store/web/host/workspace-publish";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { makeAnalyticsController, type AnalyticsController } from "./analytics-supervisor";
import {
  REPLICA_ANALYTICS_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  type ReplicaAnalyticsEvent,
  type ReplicaCommitEvent,
  type ReplicaSyncHealthEvent,
} from "./ipc-channels";
import {
  admitReplicaKey,
  LOCAL_REPLICA_KEY,
  makeReplicaAdmission,
  type ReplicaAdmission,
  type ReplicaAdmissionLimits,
} from "./replica-admission";
import type { ReplicaAuthorityHost } from "./replica-authority-host";
import { makeReplicaOwnership, type ReplicaOwnership } from "./replica-ownership";
import { isExpiredReplicaArchive } from "./replica-publish-files";
import {
  ReplicaWorkerFailure,
  type ReplicaAuthority,
  type ReplicaCommitStamp,
  type ReplicaOpenInput,
} from "./replica-rpc";
import {
  DEFAULT_SUPERVISOR_POLICY,
  startReplicaSupervisor,
  type LiveReplicaWorker,
  type ReplicaReaderClient,
  type ReplicaSupervisor,
  type ReplicaSupervisorPolicy,
  type SpawnReplicaReader,
  type SpawnReplicaWorker,
} from "./replica-supervisor";
import { spawnNodeReplicaReader, spawnNodeReplicaWorker } from "./worker-process";

type ReplicaSenderListener = {
  (event: "did-navigate", listener: () => void): void;
  (event: "render-process-gone", listener: () => void): void;
  (event: "destroyed", listener: () => void): void;
};

type ReplicaSentEvent =
  | ReplicaCommitEvent
  | ReplicaSyncHealthEvent
  | ReplicaAnalyticsEvent
  | PublishProgress;

export type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, event: ReplicaSentEvent) => void;
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

export type ReplicaSession = {
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
};

type ReplicaStamp = typeof ReplicaCommitStamp.Type;

type ReplicaWorkers = Pick<ReplicaSession, "scope" | "supervisor" | "reader">;

export type ReplicaSessionTuning = {
  readonly spawnWorker?: SpawnReplicaWorker;
  readonly spawnReader?: SpawnReplicaReader;
  readonly supervisorPolicy?: Partial<ReplicaSupervisorPolicy>;
  readonly admissionLimits?: ReplicaAdmissionLimits;
  readonly closeGrace?: Duration.Input;
  readonly ownershipWait?: Duration.Input;
};

type ReplicaSessionsOptions = ReplicaSessionTuning & {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly authority: ReplicaAuthorityHost;
  readonly onDispose: (session: ReplicaSession) => Effect.Effect<void>;
};

export type ReplicaSessions = {
  readonly localDatabasePath: string;
  readonly ownership: ReplicaOwnership;
  readonly open: (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) => Effect.Effect<
    { readonly workspaceToken: string; readonly engine: ReplicaSupervisor["engine"] },
    ReplicaWorkerFailure | Error
  >;
  readonly owned: (senderId: number, workspaceToken: string, action: string) => ReplicaSession;
  readonly latestFor: (senderId: number) => ReplicaSession | undefined;
  readonly holdsDatabase: (databasePath: string) => boolean;
  readonly whenOwnedOpen: <A, E>(
    senderId: number,
    workspaceToken: string,
    action: string,
    use: (session: ReplicaSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  readonly whenOpen: <A, E>(
    session: ReplicaSession,
    use: (session: ReplicaSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  readonly closeWorkers: (workers: ReplicaWorkers) => Effect.Effect<void>;
  readonly reopen: (
    session: ReplicaSession,
  ) => Effect.Effect<
    { readonly session: ReplicaSession; readonly stamp: ReplicaStamp },
    ReplicaWorkerFailure
  >;
  readonly invalidate: (session: ReplicaSession, stamp: ReplicaStamp) => Effect.Effect<void>;
  readonly forget: (session: ReplicaSession) => void;
  readonly close: (senderId: number, workspaceToken: string) => Effect.Effect<void>;
  readonly disposeAll: Effect.Effect<void>;
  readonly setForeground: (visible: boolean) => Effect.Effect<void>;
};

const EXHAUSTED_MESSAGE =
  "The local database worker keeps stopping. Pending changes are saved on this device.";

const prepareReplicaDirectory = Effect.fn("ReplicaSessions.prepareDirectory")(function* (
  directory: string,
) {
  yield* Effect.promise(() => mkdir(directory, { recursive: true }));
  const now = yield* Clock.currentTimeMillis;
  const names = yield* Effect.promise(() => readdir(directory));
  yield* Effect.forEach(
    names.filter(
      (name) => !name.startsWith(REPLICA_STORAGE_PREFIX) || isExpiredReplicaArchive(name, now),
    ),
    (name) =>
      Effect.tryPromise(() =>
        rm(path.join(directory, name), { force: true, recursive: true }),
      ).pipe(Effect.ignore),
    { discard: true, concurrency: "unbounded" },
  );
});

export const sendToRenderer = (sender: ReplicaSender, channel: string, event: ReplicaSentEvent) => {
  if (!sender.isDestroyed()) sender.send(channel, event);
};

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

const applyForeground = (worker: LiveReplicaWorker, visible: boolean) =>
  worker.client.SetForeground({ visible }).pipe(Effect.ignore);

export const makeReplicaSessions = (options: ReplicaSessionsOptions): ReplicaSessions => {
  const spawnWorker = options.spawnWorker ?? spawnNodeReplicaWorker;
  const spawnReader = options.spawnReader ?? spawnNodeReplicaReader;
  const analyticsWorkerPath = path.join(path.dirname(options.workerPath), "analytics-worker.js");
  const readerPath = path.join(path.dirname(options.workerPath), "replica-reader.js");
  const policy: ReplicaSupervisorPolicy = {
    ...DEFAULT_SUPERVISOR_POLICY,
    ...options.supervisorPolicy,
  };
  const closeGrace = options.closeGrace ?? Duration.seconds(8);
  const ownership = makeReplicaOwnership(options.ownershipWait ?? Duration.seconds(15));
  const replicaDatabasePath = (key: string) =>
    path.join(options.userDataPath, "replicas", sqliteReplicaFileName(key));
  const sessions = new Map<string, ReplicaSession>();
  let foreground = true;

  const closeWorkers = (workers: ReplicaWorkers) =>
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

  const dispose = (session: ReplicaSession) =>
    Effect.scoped(
      Effect.gen(function* () {
        sessions.delete(session.workspaceToken);
        yield* options.onDispose(session);
        yield* ownership.hold(session.databasePath);
        yield* closeWorkers(session);
        yield* session.gate.open;
      }),
    );

  const owned = (senderId: number, workspaceToken: string, action: string) => {
    const session = sessions.get(workspaceToken);
    if (!session) throw new Error("Unknown replica workspace.");
    if (session.senderId !== senderId) {
      throw new Error(`Rejected replica ${action} from a different renderer.`);
    }
    return session;
  };

  const invalidateRenderer = (
    sender: ReplicaSender,
    workspaceToken: string,
    analytics: AnalyticsController,
    stamp: ReplicaStamp,
  ) =>
    Effect.suspend(() => {
      const invalidation = {
        ...stamp,
        touchedEntities: [],
        touchedKeys: [],
        fullInvalidation: true,
      };
      sendToRenderer(sender, REPLICA_COMMIT_CHANNEL, { workspaceToken, ...invalidation });
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
          Effect.sync(() =>
            sendToRenderer(sender, REPLICA_COMMIT_CHANNEL, { workspaceToken, ...notice }),
          ).pipe(Effect.andThen(analytics.notify(notice))),
        );
        yield* forwardStream(client.SyncHealth(), (health) =>
          Effect.sync(() =>
            sendToRenderer(sender, REPLICA_SYNC_HEALTH_CHANNEL, { workspaceToken, health }),
          ),
        );
        yield* options.authority.attach(client, authority);
        if (!foreground) yield* applyForeground(worker, false);
        if (recovered) {
          const stamp = yield* client.Stamp().pipe(Effect.option);
          if (Option.isSome(stamp) && !sender.isDestroyed()) {
            yield* invalidateRenderer(sender, workspaceToken, analytics, stamp.value);
          }
        }
      });

  const startWorkers = (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
    workspaceToken: string,
    databasePath: string,
    scope: Scope.Closeable,
    release: () => void,
  ) =>
    Effect.gen(function* () {
      yield* releaseWithSender(sender, release);
      yield* prepareReplicaDirectory(path.dirname(databasePath));
      const analytics = yield* makeAnalyticsController({
        launch: {
          workerPath: analyticsWorkerPath,
          boot: {
            replicaDatabasePath: databasePath,
            analyticsDatabasePath: analyticsDatabasePath(databasePath),
          },
        },
        onEvent: (analyticsEvent) =>
          Effect.sync(() =>
            sendToRenderer(sender, REPLICA_ANALYTICS_CHANNEL, {
              workspaceToken,
              ...analyticsEvent,
            }),
          ),
      });
      const onExhausted = Effect.sync(() =>
        sendToRenderer(sender, REPLICA_SYNC_HEALTH_CHANNEL, {
          workspaceToken,
          health: { _tag: "recoveryRequired", message: EXHAUSTED_MESSAGE, retryable: true },
        }),
      );
      const supervisor = yield* startReplicaSupervisor({
        spawn: spawnWorker,
        launch: {
          workerPath: options.workerPath,
          boot: options.authority.bootFor(identity, databasePath),
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

  const open = Effect.fn("ReplicaSessions.open")(function* (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) {
    const workspaceToken = crypto.randomUUID();
    const databasePath = replicaDatabasePath(yield* Effect.fromResult(admitReplicaKey(identity)));
    const scope = yield* Scope.make();
    const gone = yield* Deferred.make<void>();
    const release = () => {
      Deferred.doneUnsafe(gone, Exit.void);
      const session = sessions.get(workspaceToken);
      if (session) void Effect.runPromise(dispose(session));
    };
    yield* ownership.claim(databasePath);
    const admission = yield* makeReplicaAdmission(options.admissionLimits);
    const started = yield* startWorkers(
      sender,
      identity,
      workspaceToken,
      databasePath,
      scope,
      release,
    );
    if (Deferred.isDoneUnsafe(gone) || sender.isDestroyed()) {
      yield* Scope.close(scope, Exit.void);
      return yield* Effect.fail(
        new Error("The replica renderer went away while the workspace was opening."),
      );
    }
    sessions.set(workspaceToken, {
      senderId: sender.id,
      sender,
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
    });
    return { workspaceToken, engine: started.supervisor.engine };
  }, Effect.scoped);

  const reopen = (session: ReplicaSession) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const started = yield* startWorkers(
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
      const reopened: ReplicaSession = { ...session, ...started, scope };
      sessions.set(session.workspaceToken, reopened);
      return { session: reopened, stamp: stamp.value };
    });

  return {
    localDatabasePath: replicaDatabasePath(LOCAL_REPLICA_KEY),
    ownership,
    open,
    owned,
    latestFor: (senderId) =>
      [...sessions.values()].filter((session) => session.senderId === senderId).at(-1),
    holdsDatabase: (databasePath) =>
      [...sessions.values()].some((session) => session.databasePath === databasePath),
    whenOwnedOpen: (senderId, workspaceToken, action, use) =>
      owned(senderId, workspaceToken, action).gate.whenOpen(
        Effect.suspend(() => use(owned(senderId, workspaceToken, action))),
      ),
    whenOpen: (session, use) =>
      session.gate.whenOpen(
        Effect.suspend(() => use(sessions.get(session.workspaceToken) ?? session)),
      ),
    closeWorkers,
    reopen,
    invalidate: (session, stamp) =>
      invalidateRenderer(session.sender, session.workspaceToken, session.analytics, stamp),
    forget: (session) => {
      sessions.delete(session.workspaceToken);
    },
    close: (senderId, workspaceToken) =>
      Effect.suspend(() =>
        sessions.has(workspaceToken)
          ? dispose(owned(senderId, workspaceToken, "close"))
          : Effect.void,
      ),
    disposeAll: Effect.suspend(() =>
      Effect.forEach([...sessions.values()], dispose, {
        discard: true,
        concurrency: "unbounded",
      }),
    ),
    setForeground: (visible) =>
      Effect.suspend(() => {
        if (visible === foreground) return Effect.void;
        foreground = visible;
        return Effect.forEach(
          [...sessions.values()],
          (session) =>
            session.supervisor
              .use((worker) => applyForeground(worker, visible))
              .pipe(Effect.ignore),
          { discard: true },
        );
      }),
  };
};
