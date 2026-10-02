import type { DeviceLabel } from "@store/contracts";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberMap from "effect/FiberMap";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import {
  ReplicaInsightsSummaryInput,
  ReplicaProductInsightsInput,
  ReplicaRestockPageInput,
} from "./analytics-rpc";
import {
  BACKUP_SAVE_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
  type WorkspaceBackupIpcBridge,
} from "./backup-channels";
import { trustedIpcListener, type TrustedIpcSenderFrame } from "./ipc-sender";
import {
  PUBLISH_DISCARD_CHANNEL,
  PUBLISH_LOCAL_CATALOG_CHANNEL,
  PUBLISH_OFFER_CHANNEL,
  PUBLISH_START_CHANNEL,
  type WorkspacePublishIpcBridge,
} from "./publish-channels";
import type { ReplicaAdmissionLimits } from "./replica-admission";
import { makeReplicaAuthorityHost, type ReplicaSyncApiRequest } from "./replica-authority-host";
import { makeReplicaBackup, makeStagedRestores, type ReplicaBackupDialogs } from "./replica-backup";
import {
  REPLICA_ACTIVITY_CHANNEL,
  REPLICA_CANCEL_READ_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
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
  REPLICA_WAKE_CHANNEL,
  type ReplicaIpcBridge,
} from "./replica-channels";
import { makeReplicaPublishHost } from "./replica-publish-host";
import {
  ReplicaCancelReadInput,
  ReplicaCommandStatusInput,
  ReplicaEnqueueInput,
  ReplicaOpenInput,
  ReplicaReadBatchInput,
  ReplicaReadInsightsInput,
  ReplicaReadSubsetInput,
  ReplicaSummarizeSubsetInput,
  ReplicaWorkspaceToken,
} from "./replica-rpc";
import { makeReplicaSessions, type ReplicaSender, type ReplicaSession } from "./replica-sessions";
import {
  isWorkerLost,
  type ReplicaSupervisorPolicy,
  type SpawnReplicaReader,
  type SpawnReplicaWorker,
} from "./replica-supervisor";

export type { ReplicaSentEvent } from "./replica-sessions";

export type ReplicaInvokeEvent = {
  readonly senderFrame: TrustedIpcSenderFrame | null;
  readonly sender: ReplicaSender;
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
const decodeOrganizationId = Schema.decodeUnknownSync(ReplicaWorkspaceToken);

const run = Effect.runPromise;

const readKey = (workspaceToken: string, requestId: string) => `${workspaceToken}:${requestId}`;

const makeReadFibers = (scope: Scope.Scope) =>
  Effect.runSync(
    Effect.gen(function* () {
      const fibers = yield* FiberMap.make<string>();
      return { fibers, run: yield* FiberMap.runtimePromise(fibers)() };
    }).pipe(Scope.provide(scope)),
  );

const enqueue = (session: ReplicaSession, input: ReturnType<typeof decodeEnqueueInput>) =>
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
  const stagedRestores = makeStagedRestores();
  const sessions = makeReplicaSessions({
    userDataPath: options.userDataPath,
    workerPath: options.workerPath,
    authority: makeReplicaAuthorityHost(options),
    onDispose: (session) => stagedRestores.discard(session.workspaceToken),
    spawnWorker: options.spawnWorker,
    spawnReader: options.spawnReader,
    readerPath: options.readerPath,
    supervisorPolicy: options.supervisorPolicy,
    admissionLimits: options.admissionLimits,
    closeGrace: options.closeGrace,
    ownershipWait: options.ownershipWait,
  });
  const backup = makeReplicaBackup({
    sessions,
    stagedRestores,
    dialogs: options.backupDialogs,
  });
  const publish = makeReplicaPublishHost(sessions);

  const currentSession = (event: ReplicaInvokeEvent) => sessions.latestFor(event.sender.id);

  const scope = Scope.makeUnsafe();
  let reads: ReturnType<typeof makeReadFibers> | undefined;

  const withSession = async <A, E>(
    event: ReplicaInvokeEvent,
    input: ReplicaIpcInput,
    action: string,
    use: (session: ReplicaSession) => Effect.Effect<A, E>,
  ): Promise<A> =>
    run(sessions.whenOwnedOpen(event.sender.id, decodeWorkspaceToken(input), action, use));

  const cancellableRead = async <A, E>(
    event: ReplicaInvokeEvent,
    workspaceToken: string,
    requestId: string,
    action: string,
    use: (session: ReplicaSession) => Effect.Effect<A, E>,
  ): Promise<A> =>
    (reads ??= makeReadFibers(scope)).run(
      readKey(workspaceToken, requestId),
      sessions.whenOwnedOpen(event.sender.id, workspaceToken, action, use),
    );

  const backupHandlers: BackupIpcHandlers = {
    [BACKUP_SAVE_CHANNEL]: async (event) => run(backup.backUp(currentSession(event))),
    [RESTORE_CHOOSE_CHANNEL]: async (event) => run(backup.chooseRestore(currentSession(event))),
    [RESTORE_APPLY_CHANNEL]: async (event) => run(backup.applyRestore(currentSession(event))),
    [RESTORE_DISCARD_CHANNEL]: async (event) => run(backup.discardRestore(currentSession(event))),
  };

  const publishHandlers: PublishIpcHandlers = {
    [PUBLISH_OFFER_CHANNEL]: async (event, input) =>
      run(publish.offer(currentSession(event), decodeOrganizationId(input))),
    [PUBLISH_START_CHANNEL]: async (event, input) =>
      run(publish.publish(currentSession(event), decodeOrganizationId(input))),
    [PUBLISH_DISCARD_CHANNEL]: async (event, input) =>
      run(publish.discard(currentSession(event), decodeOrganizationId(input))),
    [PUBLISH_LOCAL_CATALOG_CHANNEL]: async (event) =>
      run(publish.localCatalog(currentSession(event))),
  };

  const handlers: ReplicaIpcHandlers = {
    [REPLICA_OPEN_CHANNEL]: async (event, input) =>
      run(sessions.open(event.sender, decodeOpenInput(input))),
    [REPLICA_CLOSE_CHANNEL]: async (event, input) =>
      run(sessions.close(event.sender.id, decodeWorkspaceToken(input))),
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
      const cancel = decodeCancelReadInput(input);
      sessions.owned(event.sender.id, cancel.workspaceToken, "read cancel");
      if (reads === undefined) return;
      return run(FiberMap.remove(reads.fibers, readKey(cancel.workspaceToken, cancel.requestId)));
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

  for (const [channel, handler] of Object.entries<ReplicaIpcListener>(registered)) {
    options.ipcMain.handle(channel, trustedIpcListener(options.allowedOrigins, handler));
  }

  return {
    setForeground: (visible: boolean) => run(sessions.setForeground(visible)),
    dispose: () => {
      for (const channel of Object.keys(registered)) options.ipcMain.removeHandler(channel);
      return run(Effect.ensuring(sessions.disposeAll, Scope.close(scope, Exit.void)));
    },
  };
};
