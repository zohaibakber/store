import type { IssuedSession } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  type WorkspaceSnapshot as WorkspaceSnapshotType,
} from "@store/contracts/workspace";
import * as Effect from "effect/Effect";

import { SessionHttp, isSupersededSession, type RequestError } from "./session-http";

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

export interface SessionSnapshotHooks {
  readonly getLocalSnapshot: () => WorkspaceSnapshotType;
  readonly publish: (snapshot: WorkspaceSnapshotType) => WorkspaceSnapshotType;
  readonly clearAuthenticated?: Effect.Effect<void>;
  readonly persistAuthenticated?: (snapshot: WorkspaceSnapshotType) => Effect.Effect<void, Error>;
}

export const adoptAuthenticatedSnapshot = (
  hooks: SessionSnapshotHooks,
  snapshot: WorkspaceSnapshotType,
): Effect.Effect<WorkspaceSnapshotType> =>
  Effect.suspend(() => {
    const online = withWorkspaceOnline(snapshot, true);
    hooks.publish(online);
    if (hooks.persistAuthenticated === undefined) return Effect.succeed(online);
    return hooks.persistAuthenticated(online).pipe(
      Effect.as(online),
      Effect.catch((error) =>
        Effect.sync(() => hooks.publish(withWorkspaceError(online, error.message))),
      ),
    );
  });

const clearSession = (hooks: SessionSnapshotHooks, workspaceError: string | null = null) =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    yield* session.setTokens(null);
    if (hooks.clearAuthenticated !== undefined) yield* hooks.clearAuthenticated;
    return hooks.publish(unauthenticated(true, workspaceError));
  });

const isRejected = (error: RequestError) => error.status === 401 || error.status === 403;

const settleSnapshot = <R>(
  hooks: SessionSnapshotHooks,
  load: Effect.Effect<WorkspaceSnapshotType, RequestError, R>,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp | R> =>
  load.pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        if (isSupersededSession(error)) return Effect.sync(() => hooks.getLocalSnapshot());
        if (isRejected(error)) return clearSession(hooks, error.message);
        return Effect.sync(() =>
          hooks.publish(
            withWorkspaceError(withWorkspaceOnline(hooks.getLocalSnapshot(), false), error.message),
          ),
        );
      },
      onSuccess: (snapshot) =>
        snapshot.status === "authenticated"
          ? adoptAuthenticatedSnapshot(hooks, snapshot)
          : clearSession(hooks, "You signed in, but the server rejected the session."),
    }),
  );

export const loadSessionSnapshot = (
  hooks: SessionSnapshotHooks,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    if (!session.tokens.get()) return yield* clearSession(hooks);
    return yield* settleSnapshot(hooks, session.workspace);
  });

export const adoptSessionTokens = (
  hooks: SessionSnapshotHooks,
  issued: IssuedSession | null,
  options?: { readonly onCleared?: Effect.Effect<void> },
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    if (issued) return yield* settleSnapshot(hooks, session.adopt(issued));
    yield* session.setTokens(null);
    if (options?.onCleared !== undefined) yield* options.onCleared;
    return hooks.publish(unauthenticated(true));
  });

export const renewSessionSnapshot = (
  hooks: SessionSnapshotHooks,
): Effect.Effect<WorkspaceSnapshotType, RequestError, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    const refreshed = yield* session.renewAccess;
    return refreshed === null ? yield* loadSessionSnapshot(hooks) : hooks.getLocalSnapshot();
  });
