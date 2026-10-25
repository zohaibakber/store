import type { DeviceLabel, OrganizationId } from "@store/contracts";
import type { WorkspaceToken } from "@store/contracts/replica";
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
import {
  makeOpenWorkspaces,
  type AccessTokenSource,
  type OpenWorkspacesTuning,
  type ReplicaSender,
  type ReplicaWorkspaceRefused,
} from "./open-workspaces";
import { makeReplicaBackup, makeStagedRestores, type ReplicaBackupDialogs } from "./replica-backup";
import { makeReplicaPublishHost } from "./replica-publish-host";
import type { ReplicaOpenInput, ReplicaWorkerFailure } from "./replica-rpc";

export type ReplicaHostOptions = {
  readonly userDataPath: string;
  readonly workerPath: string;
  readonly apiBaseUrl: string;
  readonly deviceLabel?: DeviceLabel | undefined;
  readonly accessTokens: AccessTokenSource;
  readonly dialogs: ReplicaBackupDialogs;
  readonly publishProgress: (progress: PublishProgress) => Effect.Effect<void>;
  readonly rendererChannel?: (() => MessageChannelMain) | undefined;
  readonly sessions?: OpenWorkspacesTuning;
};

export class ReplicaHost extends Context.Service<
  ReplicaHost,
  {
    readonly open: (
      sender: ReplicaSender,
      identity: typeof ReplicaOpenInput.Type,
    ) => Effect.Effect<
      { readonly workspaceToken: WorkspaceToken; readonly engine: "sqlite" | "unavailable" },
      ReplicaWorkerFailure | ReplicaWorkspaceRefused
    >;
    readonly close: (
      senderId: number,
      workspaceToken: string,
    ) => Effect.Effect<void, ReplicaWorkspaceRefused>;
    readonly retryRecovery: (
      senderId: number,
      workspaceToken: string,
    ) => Effect.Effect<void, ReplicaWorkspaceRefused>;
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
    readonly offer: (
      senderId: number,
      organizationId: OrganizationId,
    ) => Effect.Effect<PublishOffer>;
    readonly publish: (
      senderId: number,
      organizationId: OrganizationId,
    ) => Effect.Effect<typeof Published.Type, ReplicaFileRefused>;
    readonly discard: (
      senderId: number,
      organizationId: OrganizationId,
    ) => Effect.Effect<PublishOffer>;
    readonly localCatalog: (senderId: number) => Effect.Effect<LocalCatalogReport>;
    readonly setForeground: (visible: boolean) => Effect.Effect<void>;
  }
>()("@store/desktop/ReplicaHost") {}

export const makeReplicaHost = Effect.fn("ReplicaHost.make")(function* (
  options: ReplicaHostOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const provide = Effect.provideService(FileSystem.FileSystem, fileSystem);
  const stagedRestores = yield* makeStagedRestores();
  const sessions = yield* makeOpenWorkspaces({
    userDataPath: options.userDataPath,
    workerPath: options.workerPath,
    apiBaseUrl: options.apiBaseUrl,
    deviceLabel: options.deviceLabel,
    accessTokens: options.accessTokens,
    rendererChannel: options.rendererChannel,
    onDispose: (session) => stagedRestores.discard(session.workspaceToken),
    ...options.sessions,
  });
  const backup = yield* makeReplicaBackup({
    sessions,
    stagedRestores,
    dialogs: options.dialogs,
  });
  const publish = makeReplicaPublishHost(sessions, options.publishProgress);
  yield* Effect.addFinalizer(() => provide(sessions.disposeAll));

  const current = (senderId: number) => sessions.latestFor(senderId);

  return ReplicaHost.of({
    open: (sender, identity) => provide(sessions.open(sender, identity)),
    close: (senderId, workspaceToken) => provide(sessions.close(senderId, workspaceToken)),
    retryRecovery: (senderId, workspaceToken) =>
      sessions.whenOwnedOpen(senderId, workspaceToken, "recovery retry", (session) =>
        Effect.all([session.supervisor.retry, session.reader.retry], { discard: true }),
      ),
    backUp: (senderId) => provide(Effect.flatMap(current(senderId), backup.backUp)),
    chooseRestore: (senderId) => provide(Effect.flatMap(current(senderId), backup.chooseRestore)),
    applyRestore: (senderId) => provide(Effect.flatMap(current(senderId), backup.applyRestore)),
    discardRestore: (senderId) => provide(Effect.flatMap(current(senderId), backup.discardRestore)),
    offer: (senderId, organizationId) =>
      provide(
        Effect.flatMap(current(senderId), (session) => publish.offer(session, organizationId)),
      ),
    publish: (senderId, organizationId) =>
      provide(
        Effect.flatMap(current(senderId), (session) => publish.publish(session, organizationId)),
      ),
    discard: (senderId, organizationId) =>
      provide(
        Effect.flatMap(current(senderId), (session) => publish.discard(session, organizationId)),
      ),
    localCatalog: (senderId) => provide(Effect.flatMap(current(senderId), publish.localCatalog)),
    setForeground: sessions.setForeground,
  });
});
