import path from "node:path";

import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";

import { ReplicaFileRefused } from "../src/host/file-refusal";
import type { BackupSaved, RestoreApplied, RestoreStaged } from "../src/host/workspace-backup";
import type { Dialogs } from "./dialogs";
import type { OpenWorkspace, OpenWorkspaces } from "./open-workspaces";
import { asFileRefusal } from "./replica-refusal";
import {
  backupFileName,
  removeReplicaFile,
  restorePreviousReplicaFile,
  swapReplicaFile,
} from "./replica-restore-files";

export type ReplicaBackupDialogs = Pick<Dialogs, "chooseBackupDestination" | "chooseBackupSource">;

type StagedRestores = {
  readonly stage: (workspaceToken: string, stagedPath: string) => Effect.Effect<void>;
  readonly take: (workspaceToken: string) => Effect.Effect<Option.Option<string>>;
  readonly discard: (workspaceToken: string) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

export type ReplicaBackup = {
  readonly backUp: (
    session: OpenWorkspace | undefined,
  ) => Effect.Effect<typeof BackupSaved.Type, ReplicaFileRefused>;
  readonly chooseRestore: (
    session: OpenWorkspace | undefined,
  ) => Effect.Effect<typeof RestoreStaged.Type, ReplicaFileRefused, FileSystem.FileSystem>;
  readonly applyRestore: (
    session: OpenWorkspace | undefined,
  ) => Effect.Effect<typeof RestoreApplied.Type, ReplicaFileRefused, FileSystem.FileSystem>;
  readonly discardRestore: (
    session: OpenWorkspace | undefined,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
};

const RELEASE_LIMIT = "50 seconds";

export const makeStagedRestores = Effect.fn("StagedRestores.make")(function* () {
  const staged = yield* Ref.make(HashMap.empty<string, string>());

  const take = (workspaceToken: string) =>
    Ref.modify(staged, (all) => [
      HashMap.get(all, workspaceToken),
      HashMap.remove(all, workspaceToken),
    ]);

  return {
    stage: (workspaceToken, stagedPath) =>
      Ref.update(staged, HashMap.set(workspaceToken, stagedPath)),
    take,
    discard: (workspaceToken) =>
      Effect.flatMap(
        take(workspaceToken),
        Option.match({ onNone: () => Effect.void, onSome: removeReplicaFile }),
      ),
  } satisfies StagedRestores;
});

export const makeReplicaBackup = Effect.fn("ReplicaBackup.make")(function* (deps: {
  readonly sessions: OpenWorkspaces;
  readonly stagedRestores: StagedRestores;
  readonly dialogs: ReplicaBackupDialogs;
}) {
  const { sessions, stagedRestores, dialogs } = deps;
  const crypto = yield* Crypto.Crypto;

  const resumeUnchanged = (session: OpenWorkspace, refusal: ReplicaFileRefused) =>
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
          sessions.forget(session).pipe(
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

  const backUp = (session: OpenWorkspace, chooser: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const destination = yield* chooser.chooseBackupDestination(backupFileName(now));
      if (Option.isNone(destination)) return { _tag: "cancelled" as const };
      const written = yield* sessions.whenOpen(session, (current) =>
        current.supervisor.use((worker) =>
          worker.client.BackUp({ destinationPath: destination.value }),
        ),
      );
      return {
        _tag: "saved" as const,
        fileName: path.basename(destination.value),
        bytes: written.bytes,
      };
    }).pipe(Effect.mapError(asFileRefusal));

  const stageRestore = (session: OpenWorkspace, chooser: ReplicaBackupDialogs) =>
    Effect.gen(function* () {
      const source = yield* chooser.chooseBackupSource;
      if (Option.isNone(source)) return { _tag: "cancelled" as const };
      yield* stagedRestores.discard(session.workspaceToken);
      const stagedPath = path.join(
        path.dirname(session.databasePath),
        `restore-${yield* Effect.orDie(crypto.randomUUIDv4())}.sqlite`,
      );
      const staged = yield* sessions.whenOpen(session, (current) =>
        current.supervisor.use((worker) =>
          worker.client.StageRestore({ sourcePath: source.value, stagedPath }),
        ),
      );
      yield* stagedRestores.stage(session.workspaceToken, stagedPath);
      return {
        _tag: "staged" as const,
        fileName: path.basename(source.value),
        current: staged.current,
        backup: staged.backup,
      };
    }).pipe(Effect.mapError(asFileRefusal));

  const replaceWorkspace = (session: OpenWorkspace, stagedPath: string) =>
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
          yield* sessions.forget(session);
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
    applyRestore: Effect.fn("ReplicaBackup.applyRestore")(function* (
      session: OpenWorkspace | undefined,
    ) {
      if (session === undefined) return yield* new ReplicaFileRefused({ reason: "no-workspace" });
      const stagedPath = yield* stagedRestores.take(session.workspaceToken);
      if (Option.isNone(stagedPath)) {
        return yield* new ReplicaFileRefused({ reason: "no-staged-restore" });
      }
      switch (session.identity.authority) {
        case "local":
          return yield* replaceWorkspace(session, stagedPath.value);
        case "remote":
          return yield* new ReplicaFileRefused({ reason: "restore-local-only" });
      }
    }),
    discardRestore: (session) =>
      session === undefined ? Effect.void : stagedRestores.discard(session.workspaceToken),
  } satisfies ReplicaBackup;
});
