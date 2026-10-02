import path from "node:path";

import type {
  BackupOutcome,
  RestoreChoice,
  RestoreOutcome,
} from "@store/web/host/workspace-backup";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  backupFileName,
  removeReplicaFile,
  restorePreviousReplicaFile,
  swapReplicaFile,
} from "./replica-restore-files";
import type { ReplicaSession, ReplicaSessions } from "./replica-sessions";

export type ReplicaBackupDialogs = {
  readonly chooseDestination: (suggestedName: string) => Promise<string | null>;
  readonly chooseSource: () => Promise<string | null>;
};

export type StagedRestores = {
  readonly stage: (workspaceToken: string, stagedPath: string) => void;
  readonly take: (workspaceToken: string) => string | undefined;
  readonly discard: (workspaceToken: string) => Effect.Effect<void>;
};

export type ReplicaBackup = {
  readonly backUp: (session: ReplicaSession | undefined) => Effect.Effect<BackupOutcome>;
  readonly chooseRestore: (session: ReplicaSession | undefined) => Effect.Effect<RestoreChoice>;
  readonly applyRestore: (session: ReplicaSession | undefined) => Effect.Effect<RestoreOutcome>;
  readonly discardRestore: (session: ReplicaSession | undefined) => Effect.Effect<void>;
};

const RESTORE_LOCAL_ONLY = "Only the workspace on this device can be restored from a file.";

const NO_WORKSPACE = "Open a workspace before using backups.";

const failed = (message: string) => ({ _tag: "failed" as const, message });

const messageOf = (cause: { readonly message: string }) => cause.message;

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
  readonly sessions: ReplicaSessions;
  readonly stagedRestores: StagedRestores;
  readonly dialogs: ReplicaBackupDialogs | undefined;
}): ReplicaBackup => {
  const { sessions, stagedRestores, dialogs } = deps;

  const resumeUnchanged = (session: ReplicaSession, reason: string) =>
    sessions.reopen(session).pipe(
      Effect.as(failed(`${reason} Your workspace is unchanged.`)),
      Effect.catch(() =>
        Effect.sync(() => {
          sessions.forget(session);
          return failed(`${reason} Your workspace is unchanged. Restart Tabaaq to open it.`);
        }),
      ),
    );

  const backUp = (session: ReplicaSession, chooser: ReplicaBackupDialogs) =>
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
    }).pipe(Effect.catch((cause) => Effect.succeed(failed(messageOf(cause)))));

  const stageRestore = (session: ReplicaSession, chooser: ReplicaBackupDialogs) =>
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
    }).pipe(Effect.catch((cause) => Effect.succeed(failed(messageOf(cause)))));

  const replaceWorkspace = (session: ReplicaSession, stagedPath: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const previousPath = `${session.databasePath}.before-restore-${yield* Clock.currentTimeMillis}`;
        yield* Effect.acquireRelease(session.gate.close, () => session.gate.open);
        yield* sessions.ownership.hold(session.databasePath);
        const released = yield* session.admission
          .read(
            session.admission.write(
              session.supervisor
                .use((worker) => worker.client.ReleaseForRestore({ stagedPath }))
                .pipe(Effect.ensuring(sessions.closeWorkers(session))),
            ),
          )
          .pipe(Effect.result);
        if (Result.isFailure(released)) {
          yield* sessions.closeWorkers(session);
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, messageOf(released.failure));
        }
        const swapped = yield* swapReplicaFile({
          databasePath: session.databasePath,
          stagedPath,
          previousPath,
        }).pipe(Effect.result);
        if (Result.isFailure(swapped)) {
          yield* removeReplicaFile(stagedPath);
          return yield* resumeUnchanged(session, messageOf(swapped.failure));
        }
        const reopened = yield* sessions.reopen(session).pipe(Effect.result);
        if (Result.isFailure(reopened)) {
          const putBack = yield* restorePreviousReplicaFile({
            databasePath: session.databasePath,
            previousPath,
          }).pipe(Effect.result);
          if (Result.isSuccess(putBack)) {
            return yield* resumeUnchanged(session, "The backup could not be opened.");
          }
          sessions.forget(session);
          return failed(
            `The backup could not be opened. Your previous workspace is saved as ${path.basename(previousPath)}.`,
          );
        }
        yield* removeReplicaFile(previousPath);
        yield* sessions.invalidate(reopened.success.session, reopened.success.stamp);
        return { _tag: "restored" as const };
      }),
    );

  return {
    backUp: (session) =>
      session === undefined || dialogs === undefined
        ? Effect.succeed(failed(NO_WORKSPACE))
        : backUp(session, dialogs),
    chooseRestore: (session) => {
      if (session === undefined || dialogs === undefined)
        return Effect.succeed(failed(NO_WORKSPACE));
      switch (session.identity.authority) {
        case "local":
          return stageRestore(session, dialogs);
        case "remote":
          return Effect.succeed(failed(RESTORE_LOCAL_ONLY));
      }
    },
    applyRestore: (session) =>
      Effect.suspend(() => {
        if (session === undefined) return Effect.succeed(failed(NO_WORKSPACE));
        const stagedPath = stagedRestores.take(session.workspaceToken);
        if (stagedPath === undefined) return Effect.succeed(failed("Choose a backup file first."));
        switch (session.identity.authority) {
          case "local":
            return replaceWorkspace(session, stagedPath);
          case "remote":
            return Effect.succeed(failed(RESTORE_LOCAL_ONLY));
        }
      }),
    discardRestore: (session) =>
      session === undefined ? Effect.void : stagedRestores.discard(session.workspaceToken),
  };
};
