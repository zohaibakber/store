import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import type { ReplicaWorkspaceBridge } from "@store/web/host/electron";
import type { WorkspaceBackupBridge } from "@store/web/host/workspace-backup";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import type { MessageChannelMain } from "electron";

import {
  BACKUP_SAVE_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_RETRY_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
} from "./ipc-channels";
import { trustedIpcListener, type TrustedIpcSenderFrame } from "./ipc-sender";
import { makeReplicaBackup, makeStagedRestores, type ReplicaBackupDialogs } from "./replica-backup";
import { ReplicaWorkspaceToken } from "./replica-rpc";
import {
  makeWorkspaceSessions,
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

type ReplicaIpcResult =
  | BridgeResult<ChannelMethod<keyof typeof CHANNEL_METHODS>>
  | BackupResult<keyof typeof BACKUP_CHANNEL_METHODS>;

export type ReplicaIpcListener = (
  event: ReplicaInvokeEvent,
  input: ReplicaIpcInput,
) => Promise<ReplicaIpcResult>;

const decodeWorkspaceToken = Schema.decodeUnknownSync(ReplicaWorkspaceToken);

export const registerReplicaWorkerIpc = (options: {
  readonly ipcMain: {
    readonly handle: (channel: string, listener: ReplicaIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
  };
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly replicaId: string;
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
    replicaId: options.replicaId,
    rendererChannel: options.rendererChannel,
    onDispose: (session) => stagedRestores.discard(session.workspaceToken),
    ...options.sessions,
  });
  const backup = makeReplicaBackup({
    sessions,
    stagedRestores,
    dialogs: options.backupDialogs,
  });

  const currentSession = (event: ReplicaInvokeEvent) => sessions.latestFor(event.sender.id);

  const backupHandlers: BackupIpcHandlers = {
    [BACKUP_SAVE_CHANNEL]: async (event) => run(backup.backUp(currentSession(event))),
    [RESTORE_CHOOSE_CHANNEL]: async (event) => run(backup.chooseRestore(currentSession(event))),
    [RESTORE_APPLY_CHANNEL]: async (event) => run(backup.applyRestore(currentSession(event))),
    [RESTORE_DISCARD_CHANNEL]: async (event) => run(backup.discardRestore(currentSession(event))),
  };

  const handlers: ReplicaIpcHandlers = {
    [REPLICA_OPEN_CHANNEL]: async (event) => run(sessions.open(event.sender)),
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

  const registered = { ...handlers, ...backupHandlers } satisfies Record<
    string,
    ReplicaIpcListener
  >;

  for (const [channel, handler] of Object.entries<ReplicaIpcListener>(registered)) {
    options.ipcMain.handle(channel, trustedIpcListener(options.allowedOrigins, handler));
  }

  return {
    dispose: () => {
      for (const channel of Object.keys(registered)) options.ipcMain.removeHandler(channel);
      return run(sessions.disposeAll).finally(() => runtime.dispose());
    },
  };
};
