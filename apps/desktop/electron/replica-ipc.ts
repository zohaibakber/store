import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import type { DeviceLabel } from "@store/contracts";
import type { ReplicaWorkspaceBridge } from "@store/web/host/electron";
import type { WorkspaceBackupBridge } from "@store/web/host/workspace-backup";
import type { WorkspacePublishBridge } from "@store/web/host/workspace-publish";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import type { MessageChannelMain } from "electron";

import {
  BACKUP_SAVE_CHANNEL,
  PUBLISH_DISCARD_CHANNEL,
  PUBLISH_LOCAL_CATALOG_CHANNEL,
  PUBLISH_OFFER_CHANNEL,
  PUBLISH_START_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_RETRY_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
} from "./ipc-channels";
import { trustedIpcListener, type TrustedIpcSenderFrame } from "./ipc-sender";
import { makeReplicaBackup, makeStagedRestores, type ReplicaBackupDialogs } from "./replica-backup";
import { makeReplicaPublishHost } from "./replica-publish-host";
import { ReplicaOpenInput, ReplicaWorkspaceToken } from "./replica-rpc";
import {
  makeWorkspaceSessions,
  type AccessTokenSource,
  type ReplicaSender,
  type WorkspaceSessionTuning,
} from "./workspace-sessions";

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
  [REPLICA_RETRY_CHANNEL]: "retryRecovery",
} satisfies Record<string, keyof ReplicaWorkspaceBridge>;

type ChannelMethod<Channel extends keyof typeof CHANNEL_METHODS> =
  ReplicaWorkspaceBridge[(typeof CHANNEL_METHODS)[Channel]];

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
} satisfies Record<string, keyof WorkspaceBackupBridge>;

type BackupResult<Channel extends keyof typeof BACKUP_CHANNEL_METHODS> = BridgeResult<
  WorkspaceBackupBridge[(typeof BACKUP_CHANNEL_METHODS)[Channel]]
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
} satisfies Record<string, keyof WorkspacePublishBridge>;

type PublishResult<Channel extends keyof typeof PUBLISH_CHANNEL_METHODS> = BridgeResult<
  WorkspacePublishBridge[(typeof PUBLISH_CHANNEL_METHODS)[Channel]]
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
const decodeOrganizationId = Schema.decodeUnknownSync(ReplicaWorkspaceToken);

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: {
    readonly handle: (channel: string, listener: ReplicaIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
  };
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly accessTokens: AccessTokenSource;
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly backupDialogs: ReplicaBackupDialogs;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly sessions?: WorkspaceSessionTuning;
}) => {
  const runtime = ManagedRuntime.make(NodeFileSystem.layer);
  const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
    runtime.runPromise(effect);
  const stagedRestores = makeStagedRestores();
  const sessions = makeWorkspaceSessions({
    userDataPath: options.userDataPath,
    workerPath: options.workerPath,
    apiBaseUrl: options.apiBaseUrl,
    deviceLabel: options.deviceLabel,
    accessTokens: options.accessTokens,
    rendererChannel: options.rendererChannel,
    onDispose: (session) => stagedRestores.discard(session.workspaceToken),
    ...options.sessions,
  });
  const backup = makeReplicaBackup({
    sessions,
    stagedRestores,
    dialogs: options.backupDialogs,
  });
  const publish = makeReplicaPublishHost(sessions);

  const currentSession = (event: ReplicaInvokeEvent) => sessions.latestFor(event.sender.id);

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
    [REPLICA_RETRY_CHANNEL]: async (event, input) =>
      run(
        sessions.whenOwnedOpen(
          event.sender.id,
          decodeWorkspaceToken(input),
          "recovery retry",
          (session) =>
            Effect.all([session.supervisor.retry, session.reader.retry], { discard: true }),
        ),
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
      return run(sessions.disposeAll).finally(() => runtime.dispose());
    },
  };
};
