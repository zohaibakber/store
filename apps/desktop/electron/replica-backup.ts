import path from "node:path";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";

import { ReplicaFileRefused } from "../src/host/file-refusal";
import type { BackupSaved, RestoreApplied, RestoreStaged } from "../src/host/workspace-backup";
import { asFileRefusal } from "./replica-refusal";
import {
  backupFileName,
  removeReplicaFile,
  restorePreviousReplicaFile,
  swapReplicaFile,
} from "./replica-restore-files";
import type { WorkspaceSession, WorkspaceSessions } from "./workspace-sessions";

export type ReplicaBackupDialogs = {
  readonly chooseDestination: (suggestedName: string) => Promise<string | null>;
  readonly chooseSource: () => Promise<string | null>;
};

type StagedRestores = {
  readonly stage: (workspaceToken: string, stagedPath: string) => void;
  readonly take: (workspaceToken: string) => string | undefined;
  readonly discard: (workspaceToken: string) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

export type ReplicaBackup = {
  readonly backUp: (
    session: WorkspaceSession | undefined,
  ) => Effect.Effect<typeof BackupSaved.Type, ReplicaFileRefused>;
  readonly chooseRestore: (
    session: WorkspaceSession | undefined,
  ) => Effect.Effect<typeof RestoreStaged.Type, ReplicaFileRefused, FileSystem.FileSystem>;
  readonly applyRestore: (
    session: WorkspaceSession | undefined,
  ) => Effect.Effect<typeof RestoreApplied.Type, ReplicaFileRefused, FileSystem.FileSystem>;
  readonly discardRestore: (
    session: WorkspaceSession | undefined,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

const RELEASE_LIMIT = "50 seconds";

export const makeStagedRestores = (): StagedRestores => {
  const staged = new Map<string, string>();

  const take = (workspaceToken: string) => {
    const stagedPath = staged.get(workspaceToken);
    staged.delete(workspaceToken);
    return stagedPath;
  };

  return {
    stage: (workspaceToken, stagedPath) => {
      staged.set(workspaceToken, stagedPath);
    },
    take,
    discard: (workspaceToken) =>
      Effect.suspend(() => {
        const stagedPath = take(workspaceToken);
        return stagedPath === undefined ? Effect.void : removeReplicaFile(stagedPath);
      }),
  };
};

export const makeReplicaBackup = (deps: {
  readonly sessions: WorkspaceSessions;
  readonly stagedRestores: StagedRestores;
  readonly dialogs: ReplicaBackupDialogs;
}): ReplicaBackup => {
  const { sessions, stagedRestores, dialogs } = deps;

  const resumeUnchanged = (session: WorkspaceSession, refusal: ReplicaFileRefused) =>
    sessions.reopen(session).pipe(
      Effect.matchEffect({
        onSuccess: () =>
          Effect.fail(
            new ReplicaFileRefused({
              reason: refusal.reason,
              detail: refusal.detail,
              standing: "unchanged",
            }),
          ),
        onFailure: () =>
          Effect.sync(() => sessions.forget(session)).pipe(
            Effect.andThen(
              Effect.fail(
                new ReplicaFileRefused({
                  reason: refusal.reason,
                  detail: refusal.detail,
                  standing: "unchanged-closed",
                }),
              ),
            ),
          ),
      }),
    );

  const backUp = (session: WorkspaceSession, chooser: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const destination = yield* Effect.tryPromise(() =>
        chooser.chooseDestination(backupFileName(now)),
      );
      if (destination === null) return { _tag: "cancelled" as const };
      const written = yield* sessions.whenOpen(session, (current) =>
        current.supervisor.use((worker) => worker.client.BackUp({ destinationPath: destination })),
      );
      return {
        _tag: "saved" as const,
        fileName: path.basename(destination),
        bytes: written.bytes,
      };
    }).pipe(Effect.mapError(asFileRefusal));

  const stageRestore = (session: WorkspaceSession, chooser: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const source = yield* Effect.tryPromise(() => chooser.chooseSource());
      if (source === null) return { _tag: "cancelled" as const };
      yield* stagedRestores.discard(session.workspaceToken);
      const stagedPath = path.join(
        path.dirname(session.databasePath),
        `restore-${crypto.randomUUID()}.sqlite`,
      );
      const staged = yield* sessions.whenOpen(session, (current) =>
        current.supervisor.use((worker) =>
          worker.client.StageRestore({ sourcePath: source, stagedPath }),
        ),
      );
      stagedRestores.stage(session.workspaceToken, stagedPath);
      return {
        _tag: "staged" as const,
        fileName: path.basename(source),
        current: staged.current,
        backup: staged.backup,
      };
    }).pipe(Effect.mapError(asFileRefusal));

  const replaceWorkspace = (session: WorkspaceSession, stagedPath: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const previousPath = `${session.databasePath}.before-restore-${yield* Clock.currentTimeMillis}`;
        yield* Effect.acquireRelease(session.gate.close, () => session.gate.open);
        yield* sessions.ownership.hold(session.databasePath);
        const released = yield* session.supervisor
          .use((worker) => worker.client.ReleaseForRestore({ stagedPath }))
          .pipe(
            Effect.timeoutOrElse({
              duration: RELEASE_LIMIT,
              orElse: () => Effect.fail(new ReplicaFileRefused({ reason: "release-too-long" })),
            }),
            Effect.ensuring(sessions.closeWorkers(session)),
            Effect.result,
          );
        if (Result.isFailure(released)) {
          yield* sessions.closeWorkers(session);
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, asFileRefusal(released.failure));
        }
        const swapped = yield* swapReplicaFile({
          databasePath: session.databasePath,
          stagedPath,
          previousPath,
        }).pipe(Effect.result);
        if (Result.isFailure(swapped)) {
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, asFileRefusal(swapped.failure));
        }
        const reopened = yield* sessions.reopen(session).pipe(Effect.result);
        if (Result.isFailure(reopened)) {
          const putBack = yield* restorePreviousReplicaFile({
            databasePath: session.databasePath,
            previousPath,
          }).pipe(Effect.result);
          if (Result.isSuccess(putBack)) {
            return yield* resumeUnchanged(
              session,
              new ReplicaFileRefused({ reason: "backup-not-opened" }),
            );
          }
          sessions.forget(session);
          return yield* new ReplicaFileRefused({
            reason: "backup-not-opened",
            standing: "previous-saved",
            savedAs: path.basename(previousPath),
          });
        }
        yield* removeReplicaFile(previousPath);
        return { _tag: "restored" as const };
      }),
    );

  return {
    backUp: (session) =>
      session === undefined
        ? Effect.fail(new ReplicaFileRefused({ reason: "no-workspace" }))
        : backUp(session, dialogs),
    chooseRestore: (session) => {
      if (session === undefined)
        return Effect.fail(new ReplicaFileRefused({ reason: "no-workspace" }));
      switch (session.identity.authority) {
        case "local":
          return stageRestore(session, dialogs);
        case "remote":
          return Effect.fail(new ReplicaFileRefused({ reason: "restore-local-only" }));
      }
    },
    applyRestore: (session) =>
      Effect.suspend(() => {
        if (session === undefined) {
          return Effect.fail(new ReplicaFileRefused({ reason: "no-workspace" }));
        }
        const stagedPath = stagedRestores.take(session.workspaceToken);
        if (stagedPath === undefined) {
          return Effect.fail(new ReplicaFileRefused({ reason: "no-staged-restore" }));
        }
        switch (session.identity.authority) {
          case "local":
            return replaceWorkspace(session, stagedPath);
          case "remote":
            return Effect.fail(new ReplicaFileRefused({ reason: "restore-local-only" }));
        }
      }),
    discardRestore: (session) =>
      session === undefined ? Effect.void : stagedRestores.discard(session.workspaceToken),
  };
};
