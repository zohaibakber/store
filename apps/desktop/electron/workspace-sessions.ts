import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import type { DeviceLabel } from "@store/contracts";
import type { PublishProgress } from "@store/web/host/workspace-publish";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { MessageChannelMain } from "electron";

import { makeAnalyticsController, type AnalyticsController } from "./analytics-supervisor";
import {
  makeRendererPorts,
  noRendererPorts,
  type RendererPorts,
  type RendererPortsTarget,
} from "./renderer-ports";
import { admitReplicaKey, LOCAL_REPLICA_KEY } from "./replica-admission";
import { makeReplicaOwnership, type ReplicaOwnership } from "./replica-ownership";
import { isExpiredReplicaArchive } from "./replica-publish-files";
import {
  ReplicaWorkerFailure,
  type ReplicaAuthority,
  type ReplicaOpenInput,
  type ReplicaWorkerBoot,
} from "./replica-rpc";
import {
  DEFAULT_SUPERVISOR_POLICY,
  startReplicaSupervisor,
  type LiveReplicaWorker,
  type ReplicaReaderClient,
  type ReplicaSupervisor,
  type ReplicaSupervisorPolicy,
  type ReplicaWorkerClient,
  type SpawnReplicaReader,
  type SpawnReplicaWorker,
} from "./replica-supervisor";
import { spawnNodeReplicaReader, spawnNodeReplicaWorker } from "./worker-process";

type ReplicaSenderListener = {
  (event: "did-navigate", listener: () => void): void;
  (event: "render-process-gone", listener: () => void): void;
  (event: "destroyed", listener: () => void): void;
};

export type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, event: PublishProgress) => void;
  readonly postMessage?: RendererPortsTarget["postMessage"];
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

export type WorkspaceSession = {
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
  readonly scope: Scope.Closeable;
};

type ReplicaWorkers = Pick<WorkspaceSession, "scope" | "supervisor" | "reader">;

export type WorkspaceSessionTuning = {
  readonly spawnWorker?: SpawnReplicaWorker;
  readonly spawnReader?: SpawnReplicaReader;
  readonly supervisorPolicy?: Partial<ReplicaSupervisorPolicy>;
  readonly closeGrace?: Duration.Input;
  readonly ownershipWait?: Duration.Input;
};

export type AccessTokenSource = {
  readonly current: (force: boolean) => Promise<Redacted.Redacted<string> | null>;
  readonly subscribe: (listen: (token: Redacted.Redacted<string> | null) => void) => () => void;
};

type WorkspaceSessionsOptions = WorkspaceSessionTuning & {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly accessTokens: AccessTokenSource;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly onDispose: (
    session: WorkspaceSession,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

export type WorkspaceSessions = {
  readonly localDatabasePath: string;
  readonly ownership: ReplicaOwnership;
  readonly open: (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) => Effect.Effect<
    { readonly workspaceToken: string; readonly engine: ReplicaSupervisor["engine"] },
    ReplicaWorkerFailure | Error,
    FileSystem.FileSystem
  >;
  readonly owned: (senderId: number, workspaceToken: string, action: string) => WorkspaceSession;
  readonly latestFor: (senderId: number) => WorkspaceSession | undefined;
  readonly holdsDatabase: (databasePath: string) => boolean;
  readonly whenOwnedOpen: <A, E>(
    senderId: number,
    workspaceToken: string,
    action: string,
    use: (session: WorkspaceSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  readonly whenOpen: <A, E>(
    session: WorkspaceSession,
    use: (session: WorkspaceSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  readonly closeWorkers: (workers: ReplicaWorkers) => Effect.Effect<void>;
  readonly reopen: (
    session: WorkspaceSession,
  ) => Effect.Effect<WorkspaceSession, ReplicaWorkerFailure, FileSystem.FileSystem>;
  readonly forget: (session: WorkspaceSession) => void;
  readonly close: (
    senderId: number,
    workspaceToken: string,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
  readonly disposeAll: Effect.Effect<void, never, FileSystem.FileSystem>;
  readonly setForeground: (visible: boolean) => Effect.Effect<void>;
};

const prepareReplicaDirectory = Effect.fn("WorkspaceSessions.prepareDirectory")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie);
  const now = yield* Clock.currentTimeMillis;
  const names = yield* fs.readDirectory(directory).pipe(Effect.orDie);
  yield* Effect.forEach(
    names.filter(
      (name) => !name.startsWith(REPLICA_STORAGE_PREFIX) || isExpiredReplicaArchive(name, now),
    ),
    (name) =>
      fs.remove(path.join(directory, name), { force: true, recursive: true }).pipe(Effect.ignore),
    { discard: true, concurrency: "unbounded" },
  );
});

export const sendToRenderer = (sender: ReplicaSender, channel: string, event: PublishProgress) => {
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

const TOKEN_RETRY = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]);

const pushAccessTokens = (source: AccessTokenSource, client: ReplicaWorkerClient) => {
  const mint = (force: boolean) =>
    Effect.tryPromise(() => source.current(force)).pipe(Effect.retry(TOKEN_RETRY));
  const refreshed = Stream.callback<Redacted.Redacted<string> | null>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => source.subscribe((token) => Queue.offerUnsafe(queue, token))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );
  const requested = client.SyncHealth().pipe(
    Stream.map((health) => health.auth === "refreshing"),
    Stream.changes,
    Stream.switchMap((refreshing) => (refreshing ? Stream.fromEffect(mint(true)) : Stream.empty)),
  );
  return Stream.mergeAll([Stream.fromEffect(mint(false)), refreshed, requested], {
    concurrency: "unbounded",
  }).pipe(Stream.runForEach((token) => client.SetAccessToken({ token })));
};

const bootFor = (
  options: Pick<WorkspaceSessionsOptions, "apiBaseUrl" | "deviceLabel">,
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

const applyForeground = (worker: LiveReplicaWorker, visible: boolean) =>
  worker.client.SetForeground({ visible }).pipe(Effect.ignore);

export const makeWorkspaceSessions = (options: WorkspaceSessionsOptions): WorkspaceSessions => {
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
  const sessions = new Map<string, WorkspaceSession>();
  let foreground = true;

  const closeWorkers = (workers: ReplicaWorkers) =>
    Effect.gen(function* () {
      const closing = yield* Effect.forkDetach(Scope.close(workers.scope, Exit.void));
      yield* Fiber.await(closing).pipe(
        Effect.timeoutOrElse({
          duration: closeGrace,
          orElse: () =>
            Effect.all([workers.supervisor.terminate, workers.reader.terminate], {
              discard: true,
              concurrency: "unbounded",
            }).pipe(Effect.andThen(Fiber.await(closing))),
        }),
        Effect.asVoid,
      );
    });

  const dispose = (session: WorkspaceSession) =>
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

  const rendererPorts = (
    sender: ReplicaSender,
    workspaceToken: string,
    analytics: AnalyticsController,
  ) => {
    const { rendererChannel } = options;
    if (rendererChannel === undefined || sender.postMessage === undefined) {
      return Effect.succeed(noRendererPorts);
    }
    return makeRendererPorts({
      target: {
        isDestroyed: () => sender.isDestroyed(),
        postMessage: (channel, message, transfer) =>
          sender.postMessage?.(channel, message, transfer),
      },
      workspaceToken,
      channel: rendererChannel,
      attachInsights: (port) => analytics.use((client) => client.AttachRenderer({ port })),
    });
  };

  const attachWriter =
    (analytics: AnalyticsController, authority: ReplicaAuthority, ports: RendererPorts) =>
    (worker: LiveReplicaWorker, recovered: boolean) =>
      Effect.gen(function* () {
        const { client } = worker;
        yield* forwardStream(client.Commits(), analytics.notify);
        if (authority === "remote") {
          yield* pushAccessTokens(options.accessTokens, client).pipe(
            Effect.catchCause(() => Effect.void),
            Effect.forkScoped,
          );
        }
        if (!foreground) yield* applyForeground(worker, false);
        if (recovered) {
          const stamp = yield* client.Stamp().pipe(Effect.option);
          if (Option.isSome(stamp)) {
            yield* analytics.notify({
              ...stamp.value,
              touchedEntities: [],
              touchedKeys: [],
              fullInvalidation: true,
            });
          }
        }
        yield* ports.workerUp("writer", (port) => client.AttachRenderer({ port }));
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
        onLost: Effect.suspend(() => ports.reattach),
      });
      const ports: RendererPorts = yield* rendererPorts(sender, workspaceToken, analytics);
      const supervisor = yield* startReplicaSupervisor({
        spawn: spawnWorker,
        launch: {
          workerPath: options.workerPath,
          boot: bootFor(options, identity, databasePath),
        },
        policy,
        attach: attachWriter(analytics, identity.authority, ports),
      });
      const reader = yield* startReplicaSupervisor({
        spawn: spawnReader,
        launch: { workerPath: readerPath, boot: { databasePath } },
        policy,
        attach: (worker) =>
          ports.workerUp("reader", (port) => worker.client.AttachRenderer({ port })),
      });
      yield* ports.track("writer", supervisor.phases);
      yield* ports.track("reader", reader.phases);
      return { supervisor, reader, analytics };
    }).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );

  const open = Effect.fn("WorkspaceSessions.open")(function* (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) {
    const workspaceToken = crypto.randomUUID();
    const runDispose = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem>());
    const databasePath = replicaDatabasePath(yield* Effect.fromResult(admitReplicaKey(identity)));
    const scope = yield* Scope.make();
    const gone = yield* Deferred.make<void>();
    const release = () => {
      Deferred.doneUnsafe(gone, Exit.void);
      const session = sessions.get(workspaceToken);
      if (session) void runDispose(dispose(session));
    };
    yield* ownership.claim(databasePath);
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
      scope,
    });
    return { workspaceToken, engine: started.supervisor.engine };
  }, Effect.scoped);

  const reopen = (session: WorkspaceSession) =>
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
      const reopened: WorkspaceSession = { ...session, ...started, scope };
      sessions.set(session.workspaceToken, reopened);
      return reopened;
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
