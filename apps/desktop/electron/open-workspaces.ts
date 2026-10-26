import path from "node:path";

import { REPLICA_STORAGE_PREFIX, sqliteReplicaFileName } from "@store/client-db";
import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import type { DeviceLabel } from "@store/contracts";
import { ReplicaStorageError, ReplicaUnavailable, WorkspaceToken } from "@store/contracts/replica";
import type { RequestError } from "@store/workspace";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
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
  readonly postMessage?: RendererPortsTarget["postMessage"];
  readonly on: ReplicaSenderListener;
  readonly removeListener: ReplicaSenderListener;
};

const REFUSAL_REASONS = ["unknown", "otherRenderer", "rendererGone"] as const;

export class ReplicaWorkspaceRefused extends Schema.TaggedError<ReplicaWorkspaceRefused>()(
  "ReplicaWorkspaceRefused",
  { reason: Schema.Literals(REFUSAL_REASONS), action: Schema.String },
) {
  override get message(): string {
    switch (this.reason) {
      case "unknown":
        return "Unknown replica workspace.";
      case "otherRenderer":
        return `Rejected replica ${this.action} from a different renderer.`;
      case "rendererGone":
        return "The replica renderer went away while the workspace was opening.";
    }
  }
}

export type OpenWorkspace = {
  readonly senderId: number;
  readonly sender: ReplicaSender;
  readonly identity: typeof ReplicaOpenInput.Type;
  readonly release: () => void;
  readonly gate: Latch.Latch;
  readonly workspaceToken: WorkspaceToken;
  readonly databasePath: string;
  readonly supervisor: ReplicaSupervisor;
  readonly reader: ReplicaSupervisor<ReplicaReaderClient>;
  readonly analytics: AnalyticsController;
  readonly scope: Scope.Closeable;
};

type ReplicaWorkers = Pick<OpenWorkspace, "scope" | "supervisor" | "reader">;

export type OpenWorkspacesTuning = {
  readonly spawnWorker?: SpawnReplicaWorker;
  readonly spawnReader?: SpawnReplicaReader;
  readonly supervisorPolicy?: Partial<ReplicaSupervisorPolicy>;
  readonly closeGrace?: Duration.Input;
  readonly ownershipWait?: Duration.Input;
  readonly licence?: LicenceService["Service"];
};

export type AccessTokenSource = {
  readonly liveAccessToken: (
    force: boolean,
  ) => Effect.Effect<Redacted.Redacted<string> | null, RequestError>;
  readonly accessTokens: Stream.Stream<Redacted.Redacted<string> | null>;
};

type OpenWorkspacesOptions = OpenWorkspacesTuning & {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly accessTokens: AccessTokenSource;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly onDispose: (session: OpenWorkspace) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

export type OpenWorkspaces = {
  readonly localDatabasePath: string;
  readonly ownership: ReplicaOwnership;
  readonly open: (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) => Effect.Effect<
    { readonly workspaceToken: WorkspaceToken; readonly engine: ReplicaSupervisor["engine"] },
    ReplicaWorkerFailure | ReplicaWorkspaceRefused,
    FileSystem.FileSystem
  >;
  readonly latestFor: (senderId: number) => Effect.Effect<OpenWorkspace | undefined>;
  readonly holdsDatabase: (databasePath: string) => Effect.Effect<boolean>;
  readonly whenOwnedOpen: <A, E>(
    senderId: number,
    workspaceToken: string,
    action: string,
    use: (session: OpenWorkspace) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ReplicaWorkspaceRefused>;
  readonly whenOpen: <A, E>(
    session: OpenWorkspace,
    use: (session: OpenWorkspace) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  readonly closeWorkers: (workers: ReplicaWorkers) => Effect.Effect<void>;
  readonly reopen: (
    session: OpenWorkspace,
  ) => Effect.Effect<OpenWorkspace, ReplicaWorkerFailure, FileSystem.FileSystem>;
  readonly forget: (session: OpenWorkspace) => Effect.Effect<void>;
  readonly close: (
    senderId: number,
    workspaceToken: string,
  ) => Effect.Effect<void, ReplicaWorkspaceRefused, FileSystem.FileSystem>;
  readonly disposeAll: Effect.Effect<void, never, FileSystem.FileSystem>;
  readonly setForeground: (visible: boolean) => Effect.Effect<void>;
};

const prepareReplicaDirectory = Effect.fn("OpenWorkspaces.prepareDirectory")(function* (
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
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), (cause) =>
      Effect.logWarning("OpenWorkspaces.forward_failed", cause),
    ),
    Effect.forkScoped,
  );

const TOKEN_RETRY = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]);

const pushAccessTokens = (source: AccessTokenSource, client: ReplicaWorkerClient) => {
  const mint = (force: boolean) => source.liveAccessToken(force).pipe(Effect.retry(TOKEN_RETRY));
  const requested = client.SyncHealth().pipe(
    Stream.map((health) => health.auth === "refreshing"),
    Stream.changes,
    Stream.switchMap((refreshing) => (refreshing ? Stream.fromEffect(mint(true)) : Stream.empty)),
  );
  return Stream.mergeAll([Stream.fromEffect(mint(false)), source.accessTokens, requested], {
    concurrency: "unbounded",
  }).pipe(Stream.runForEach((token) => client.SetAccessToken({ token })));
};

const bootFor = (
  options: Pick<OpenWorkspacesOptions, "apiBaseUrl" | "deviceLabel">,
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
            Effect.catchTags({
              ReplicaWorkerLost: () =>
                Effect.fail(new ReplicaUnavailable({ reason: "restarting" })),
              RpcClientError: () => Effect.fail(new ReplicaUnavailable({ reason: "restarting" })),
              ReplicaWorkerFailure: ({ message }) =>
                Effect.fail(new ReplicaStorageError({ message })),
            }),
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

export const makeOpenWorkspaces = Effect.fn("OpenWorkspaces.make")(function* (
  options: OpenWorkspacesOptions,
) {
  const crypto = yield* Crypto.Crypto;
  const spawnWorker = options.spawnWorker ?? spawnNodeReplicaWorker;
  const spawnReader = options.spawnReader ?? spawnNodeReplicaReader;
  const analyticsWorkerPath = path.join(path.dirname(options.workerPath), "analytics-worker.js");
  const readerPath = path.join(path.dirname(options.workerPath), "replica-reader.js");
  const policy: ReplicaSupervisorPolicy = {
    ...DEFAULT_SUPERVISOR_POLICY,
    ...options.supervisorPolicy,
  };
  const closeGrace = options.closeGrace ?? Duration.seconds(8);
  const ownership = yield* makeReplicaOwnership(options.ownershipWait ?? Duration.seconds(15));
  const replicaDatabasePath = (key: string) =>
    path.join(options.userDataPath, "replicas", sqliteReplicaFileName(key));
  const workspaces = yield* Ref.make<ReadonlyArray<OpenWorkspace>>([]);
  const foreground = yield* Ref.make(true);
  const disposals = yield* FiberSet.make();
  const runDisposal = yield* FiberSet.runtime(disposals)<FileSystem.FileSystem>();

  const find = (workspaceToken: string) =>
    Effect.map(
      Ref.get(workspaces),
      Arr.findFirst((workspace) => workspace.workspaceToken === workspaceToken),
    );

  const forget = (session: OpenWorkspace) =>
    Ref.update(
      workspaces,
      Arr.filter((workspace) => workspace.workspaceToken !== session.workspaceToken),
    );

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

  const dispose = (session: OpenWorkspace) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* forget(session);
        yield* options.onDispose(session);
        yield* ownership.hold(session.databasePath);
        yield* closeWorkers(session);
        yield* session.gate.open;
      }),
    );

  const owned = Effect.fn("OpenWorkspaces.owned")(function* (
    senderId: number,
    workspaceToken: string,
    action: string,
  ) {
    const found = yield* find(workspaceToken);
    if (Option.isNone(found)) {
      return yield* new ReplicaWorkspaceRefused({ reason: "unknown", action });
    }
    if (found.value.senderId !== senderId) {
      return yield* new ReplicaWorkspaceRefused({ reason: "otherRenderer", action });
    }
    return found.value;
  });

  const rendererPorts = (
    sender: ReplicaSender,
    workspaceToken: WorkspaceToken,
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
    (analytics: AnalyticsController, authority: ReplicaAuthority, ports: RendererPorts) =>
    (worker: LiveReplicaWorker, recovered: boolean) =>
      Effect.gen(function* () {
        const { client } = worker;
        yield* forwardStream(client.Commits(), analytics.notify);
        if (authority === "remote") {
          yield* pushAccessTokens(options.accessTokens, client).pipe(
            Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), (cause) =>
              Effect.logWarning("OpenWorkspaces.access_tokens_failed", cause),
            ),
            Effect.forkScoped,
          );
        }
        if (!(yield* Ref.get(foreground))) yield* applyForeground(worker, false);
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
    identity: typeof ReplicaOpenInput.Type,
    workspaceToken: WorkspaceToken,
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

  const open = Effect.fn("OpenWorkspaces.open")(function* (
    sender: ReplicaSender,
    identity: typeof ReplicaOpenInput.Type,
  ) {
    const workspaceToken = WorkspaceToken.make(yield* Effect.orDie(crypto.randomUUIDv4()));
    const databasePath = replicaDatabasePath(yield* Effect.fromResult(admitReplicaKey(identity)));
    const scope = yield* Scope.make();
    const gone = yield* Deferred.make<void>();
    const release = () => {
      Deferred.doneUnsafe(gone, Exit.void);
      runDisposal(
        Effect.flatMap(
          find(workspaceToken),
          Option.match({ onNone: () => Effect.void, onSome: dispose }),
        ),
      );
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
      return yield* new ReplicaWorkspaceRefused({ reason: "rendererGone", action: "open" });
    }
    const gate = yield* Latch.make(true);
    yield* Ref.update(
      workspaces,
      Arr.append<OpenWorkspace>({
        senderId: sender.id,
        sender,
        identity,
        release,
        gate,
        workspaceToken,
        databasePath,
        supervisor: started.supervisor,
        reader: started.reader,
        analytics: started.analytics,
        scope,
      }),
    );
    return { workspaceToken, engine: started.supervisor.engine };
  }, Effect.scoped);

  const reopen = Effect.fn("OpenWorkspaces.reopen")(function* (session: OpenWorkspace) {
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
    const reopened: OpenWorkspace = { ...session, ...started, scope };
    const replaced =
      !session.sender.isDestroyed() &&
      (yield* Ref.modify(workspaces, (all) =>
        all.some((workspace) => workspace.workspaceToken === session.workspaceToken)
          ? [
              true,
              all.map((workspace) =>
                workspace.workspaceToken === session.workspaceToken ? reopened : workspace,
              ),
            ]
          : [false, all],
      ));
    if (!replaced) {
      yield* closeWorkers(workers);
      return yield* new ReplicaWorkerFailure({
        message: "The window closed before the workspace reopened.",
      });
    }
    return reopened;
  });

  return {
    localDatabasePath: replicaDatabasePath(LOCAL_REPLICA_KEY),
    ownership,
    open,
    latestFor: (senderId) =>
      Effect.map(Ref.get(workspaces), (all) =>
        Arr.findLast(all, (workspace) => workspace.senderId === senderId).pipe(
          Option.getOrUndefined,
        ),
      ),
    holdsDatabase: (databasePath) =>
      Effect.map(
        Ref.get(workspaces),
        Arr.some((workspace) => workspace.databasePath === databasePath),
      ),
    whenOwnedOpen: (senderId, workspaceToken, action, use) =>
      Effect.flatMap(owned(senderId, workspaceToken, action), (session) =>
        session.gate.whenOpen(Effect.flatMap(owned(senderId, workspaceToken, action), use)),
      ),
    whenOpen: (session, use) =>
      session.gate.whenOpen(
        Effect.flatMap(find(session.workspaceToken), (found) =>
          use(Option.getOrElse(found, () => session)),
        ),
      ),
    closeWorkers,
    reopen,
    forget,
    close: Effect.fn("OpenWorkspaces.close")(function* (senderId, workspaceToken) {
      if (Option.isNone(yield* find(workspaceToken))) return;
      yield* dispose(yield* owned(senderId, workspaceToken, "close"));
    }),
    disposeAll: Effect.gen(function* () {
      yield* Effect.forEach(yield* Ref.get(workspaces), dispose, {
        discard: true,
        concurrency: "unbounded",
      });
      yield* FiberSet.awaitEmpty(disposals);
    }),
    setForeground: Effect.fn("OpenWorkspaces.setForeground")(function* (visible: boolean) {
      if ((yield* Ref.getAndSet(foreground, visible)) === visible) return;
      yield* Effect.forEach(
        yield* Ref.get(workspaces),
        (session) =>
          session.supervisor.use((worker) => applyForeground(worker, visible)).pipe(Effect.ignore),
        { discard: true },
      );
    }),
  } satisfies OpenWorkspaces;
});
