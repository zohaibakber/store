import type { DeviceLabel } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { MessageChannelMain } from "electron";

import type { ReplicaFileRefused } from "../src/host/file-refusal";
import type { BackupSaved, RestoreApplied, RestoreStaged } from "../src/host/workspace-backup";
import type {
  LocalCatalogReport,
  PublishOffer,
  PublishProgress,
  Published,
} from "../src/host/workspace-publish";
import { makeReplicaBackup, makeStagedRestores, type ReplicaBackupDialogs } from "./replica-backup";
import { makeReplicaPublishHost } from "./replica-publish-host";
import type { ReplicaOpenInput, ReplicaWorkerFailure } from "./replica-rpc";
import {
  makeWorkspaceSessions,
  type AccessTokenSource,
  type ReplicaSender,
  type WorkspaceSessionTuning,
} from "./workspace-sessions";

export type ReplicaHostOptions = {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly accessTokens: AccessTokenSource;
  readonly backupDialogs: ReplicaBackupDialogs;
  readonly publishProgress: (progress: PublishProgress) => Effect.Effect<void>;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly sessions?: WorkspaceSessionTuning;
};

export class ReplicaHost extends Context.Service<
  ReplicaHost,
  {
    readonly open: (
      sender: ReplicaSender,
      identity: typeof ReplicaOpenInput.Type,
    ) => Effect.Effect<
      { readonly workspaceToken: string; readonly engine: "sqlite" | "unavailable" },
      ReplicaWorkerFailure | Error
    >;
    readonly close: (senderId: number, workspaceToken: string) => Effect.Effect<void>;
    readonly retryRecovery: (senderId: number, workspaceToken: string) => Effect.Effect<void>;
    readonly backUp: (
      senderId: number,
    ) => Effect.Effect<typeof BackupSaved.Type, ReplicaFileRefused>;
    readonly chooseRestore: (
      senderId: number,
    ) => Effect.Effect<typeof RestoreStaged.Type, ReplicaFileRefused>;
    readonly applyRestore: (
      senderId: number,
    ) => Effect.Effect<typeof RestoreApplied.Type, ReplicaFileRefused>;
    readonly discardRestore: (senderId: number) => Effect.Effect<void>;
    readonly offer: (senderId: number, organizationId: string) => Effect.Effect<PublishOffer>;
    readonly publish: (
      senderId: number,
      organizationId: string,
    ) => Effect.Effect<typeof Published.Type, ReplicaFileRefused>;
    readonly discard: (senderId: number, organizationId: string) => Effect.Effect<PublishOffer>;
    readonly localCatalog: (senderId: number) => Effect.Effect<LocalCatalogReport>;
    readonly setForeground: (visible: boolean) => Effect.Effect<void>;
  }
>()("@store/desktop/ReplicaHost") {}

export const makeReplicaHost = Effect.fn("ReplicaHost.make")(function* (
  options: ReplicaHostOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const provide = Effect.provideService(FileSystem.FileSystem, fileSystem);
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
  const publish = makeReplicaPublishHost(sessions, options.publishProgress);
  yield* Effect.addFinalizer(() => provide(sessions.disposeAll));

  const current = (senderId: number) => sessions.latestFor(senderId);

  return ReplicaHost.of({
    open: (sender, identity) => provide(sessions.open(sender, identity)),
    close: (senderId, workspaceToken) => provide(sessions.close(senderId, workspaceToken)),
    retryRecovery: (senderId, workspaceToken) =>
      Effect.suspend(() =>
        sessions.whenOwnedOpen(senderId, workspaceToken, "recovery retry", (session) =>
          Effect.all([session.supervisor.retry, session.reader.retry], { discard: true }),
        ),
      ),
    backUp: (senderId) => provide(backup.backUp(current(senderId))),
    chooseRestore: (senderId) => provide(backup.chooseRestore(current(senderId))),
    applyRestore: (senderId) => provide(backup.applyRestore(current(senderId))),
    discardRestore: (senderId) => provide(backup.discardRestore(current(senderId))),
    offer: (senderId, organizationId) => provide(publish.offer(current(senderId), organizationId)),
    publish: (senderId, organizationId) =>
      provide(publish.publish(current(senderId), organizationId)),
    discard: (senderId, organizationId) =>
      provide(publish.discard(current(senderId), organizationId)),
    localCatalog: (senderId) => provide(publish.localCatalog(current(senderId))),
    setForeground: sessions.setForeground,
  });
});
