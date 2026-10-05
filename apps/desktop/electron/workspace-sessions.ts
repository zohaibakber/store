import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { MessageChannelMain } from "electron";

import { makeAnalyticsController, type AnalyticsController } from "./analytics-supervisor";
import type { DesktopLicence } from "./desktop-rpcs";
import type { LicenceService } from "./licence/service";
import {
  makeRendererPorts,
  noRendererPorts,
  type RendererPorts,
  type RendererPortsTarget,
} from "./renderer-ports";
import { makeReplicaOwnership, type ReplicaOwnership } from "./replica-ownership";
import { ReplicaWorkerFailure } from "./replica-rpc";
import {
  DEFAULT_SUPERVISOR_POLICY,
  startReplicaSupervisor,
  type LiveReplicaWorker,
  type ReplicaReaderClient,
  type ReplicaSupervisor,
  type ReplicaSupervisorPolicy,
  type SpawnReplicaReader,
  type SpawnReplicaWorker,
  type ReplicaWorkerClient,
} from "./replica-supervisor";
import { spawnNodeReplicaReader, spawnNodeReplicaWorker } from "./worker-process";

const LOCAL_REPLICA_KEY = `${LOCAL_ORGANIZATION_ID}-${LOCAL_USER_ID}`;

type ReplicaSenderListener = {
  (event: "did-navigate", listener: () => void): void;
  (event: "render-process-gone", listener: () => void): void;
  (event: "destroyed", listener: () => void): void;
};

export type ReplicaSender = {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly postMessage?: RendererPortsTarget["postMessage"];
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

export type WorkspaceSession = {
  readonly senderId: number;
  readonly sender: ReplicaSender;
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
  readonly licence?: LicenceService["Service"];
};

type WorkspaceSessionsOptions = WorkspaceSessionTuning & {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly replicaId: string;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly onDispose: (
    session: WorkspaceSession,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

export type WorkspaceSessions = {
  readonly ownership: ReplicaOwnership;
  readonly open: (
    sender: ReplicaSender,
  ) => Effect.Effect<
    { readonly workspaceToken: string; readonly engine: ReplicaSupervisor["engine"] },
    ReplicaWorkerFailure | Error,
    FileSystem.FileSystem
  >;
  readonly owned: (senderId: number, workspaceToken: string, action: string) => WorkspaceSession;
  readonly latestFor: (senderId: number) => WorkspaceSession | undefined;
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
};

const prepareReplicaDirectory = Effect.fn("WorkspaceSessions.prepareDirectory")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie);
  const names = yield* fs.readDirectory(directory).pipe(Effect.orDie);
  yield* Effect.forEach(
    names.filter((name) => !name.startsWith(REPLICA_STORAGE_PREFIX)),
    (name) =>
      fs.remove(path.join(directory, name), { force: true, recursive: true }).pipe(Effect.ignore),
    { discard: true, concurrency: "unbounded" },
  );
});

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

const tellLicence = (licence: LicenceService["Service"], client: ReplicaWorkerClient) =>
  Effect.flatMap(licence.current, (state) => client.SetLicence({ state })).pipe(Effect.ignore);

const sessionLicence = (
  licence: LicenceService["Service"],
  writer: () => ReplicaSupervisor,
): DesktopLicence => ({
  states: licence.states,
  enter: (text) =>
    licence
      .enter(
        text,
        writer()
          .use((worker) => worker.client.DatabaseShop())
          .pipe(
            Effect.map((database) => Option.fromNullishOr(database.shopId)),
            Effect.orDie,
          ),
      )
      .pipe(
        Effect.tap(() =>
          writer()
            .use((worker) => tellLicence(licence, worker.client))
            .pipe(Effect.ignore),
        ),
      ),
});

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
  const databasePath = path.join(
    options.userDataPath,
    "replicas",
    sqliteReplicaFileName(LOCAL_REPLICA_KEY),
  );
  const sessions = new Map<string, WorkspaceSession>();

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
    licence: DesktopLicence | undefined,
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
      licence,
    });
  };

  const attachWriter =
    (analytics: AnalyticsController, ports: RendererPorts) =>
    (worker: LiveReplicaWorker, recovered: boolean) =>
      Effect.gen(function* () {
        const { client } = worker;
        yield* forwardStream(client.Commits(), analytics.notify);
        const { licence } = options;
        if (licence !== undefined) {
          yield* tellLicence(licence, client);
          yield* forwardStream(licence.states, (state) =>
            client.SetLicence({ state }).pipe(Effect.ignore),
          );
        }
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
    workspaceToken: string,
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
      const ports: RendererPorts = yield* rendererPorts(
        sender,
        workspaceToken,
        analytics,
        options.licence === undefined
          ? undefined
          : sessionLicence(options.licence, () => supervisor),
      );
      const supervisor: ReplicaSupervisor = yield* startReplicaSupervisor({
        spawn: spawnWorker,
        launch: {
          workerPath: options.workerPath,
          boot: { replicaId: options.replicaId, databasePath },
        },
        policy,
        attach: attachWriter(analytics, ports),
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

  const open = Effect.fn("WorkspaceSessions.open")(function* (sender: ReplicaSender) {
    const workspaceToken = crypto.randomUUID();
    const runDispose = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem>());
    const scope = yield* Scope.make();
    const gone = yield* Deferred.make<void>();
    const release = () => {
      Deferred.doneUnsafe(gone, Exit.void);
      const session = sessions.get(workspaceToken);
      if (session) void runDispose(dispose(session));
    };
    yield* ownership.claim(databasePath);
    const started = yield* startWorkers(sender, workspaceToken, scope, release);
    if (Deferred.isDoneUnsafe(gone) || sender.isDestroyed()) {
      yield* Scope.close(scope, Exit.void);
      return yield* Effect.fail(
        new Error("The replica renderer went away while the workspace was opening."),
      );
    }
    sessions.set(workspaceToken, {
      senderId: sender.id,
      sender,
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
        session.workspaceToken,
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
    ownership,
    open,
    owned,
    latestFor: (senderId) =>
      [...sessions.values()].filter((session) => session.senderId === senderId).at(-1),
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
  };
};
