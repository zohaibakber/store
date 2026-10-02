import type { IssuedSession, TokenSet } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  type WorkspaceSnapshot as WorkspaceSnapshotType,
} from "@store/contracts/workspace";
import * as Effect from "effect/Effect";

import {
  SessionHttp,
  isRejectedStatus,
  isSupersededSession,
  type RequestError,
} from "./session-http";

const SESSION_REJECTED = "You signed in, but the server rejected the session.";

export interface SessionSnapshotHooks {
  readonly getLocalSnapshot: () => WorkspaceSnapshotType;
  readonly publish: (snapshot: WorkspaceSnapshotType) => WorkspaceSnapshotType;
  readonly clearAuthenticated?: Effect.Effect<void>;
  readonly persistAuthenticated?: (
    snapshot: WorkspaceSnapshotType,
    tokens: TokenSet,
  ) => Effect.Effect<void, Error>;
}

export const adoptAuthenticatedSnapshot = (
  hooks: SessionSnapshotHooks,
  snapshot: WorkspaceSnapshotType,
  tokens: TokenSet | null,
): Effect.Effect<WorkspaceSnapshotType> =>
  Effect.suspend(() => {
    const online = withWorkspaceOnline(snapshot, true);
    hooks.publish(online);
    if (hooks.persistAuthenticated === undefined || tokens === null) return Effect.succeed(online);
    return hooks.persistAuthenticated(online, tokens).pipe(
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
    return hooks.publish(unauthenticatedWorkspace({ isOnline: true, workspaceError }));
  });

const publishUnreachable = (hooks: SessionSnapshotHooks, workspaceError: string) =>
  Effect.sync(() =>
    hooks.publish(
      withWorkspaceError(withWorkspaceOnline(hooks.getLocalSnapshot(), false), workspaceError),
    ),
  );

const confirmRejection = Effect.fnUntraced(function* (hooks: SessionSnapshotHooks, reason: string) {
  const session = yield* SessionHttp;
  if ((yield* session.tokens) === null) return yield* clearSession(hooks, reason);
  return yield* session.ensureFreshAccess(true).pipe(
    Effect.matchEffect({
      onFailure: (error) => publishUnreachable(hooks, error.message),
      onSuccess: (access) =>
        Effect.flatMap(session.tokens, (tokens) =>
          access?.workspace !== undefined || (access === null && tokens !== null)
            ? Effect.sync(() => hooks.getLocalSnapshot())
            : clearSession(hooks, reason),
        ),
    }),
  );
});

const settleSnapshot = <R>(
  hooks: SessionSnapshotHooks,
  load: Effect.Effect<WorkspaceSnapshotType, RequestError, R>,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp | R> =>
  load.pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        if (isSupersededSession(error) || error.refresh === "succeeded") {
          return Effect.sync(() => hooks.getLocalSnapshot());
        }
        if (isRejectedStatus(error.status) && error.refresh === undefined) {
          return confirmRejection(hooks, error.message);
        }
        return publishUnreachable(hooks, error.message);
      },
      onSuccess: (snapshot) =>
        snapshot.status === "authenticated"
          ? Effect.flatMap(
              SessionHttp.use((session) => session.tokens),
              (tokens) => adoptAuthenticatedSnapshot(hooks, snapshot, tokens),
            )
          : confirmRejection(hooks, SESSION_REJECTED),
    }),
  );

export const loadSessionSnapshot = (
  hooks: SessionSnapshotHooks,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    if ((yield* session.tokens) === null) return yield* clearSession(hooks);
    return yield* settleSnapshot(hooks, session.workspace);
  });

export const resumeSessionSnapshot = (
  hooks: SessionSnapshotHooks,
  tokens: TokenSet,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    yield* session.setTokens(tokens);
    return yield* session.ensureFreshAccess().pipe(
      Effect.matchEffect({
        onFailure: (error) => publishUnreachable(hooks, error.message),
        onSuccess: (access) =>
          access?.workspace === undefined
            ? loadSessionSnapshot(hooks)
            : Effect.sync(() => hooks.getLocalSnapshot()),
      }),
    );
  });

export const adoptSessionTokens = (
  hooks: SessionSnapshotHooks,
  issued: IssuedSession,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.flatMap(SessionHttp, (session) => settleSnapshot(hooks, session.adopt(issued)));

export const renewSessionSnapshot = (
  hooks: SessionSnapshotHooks,
): Effect.Effect<WorkspaceSnapshotType, RequestError, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    const refreshed = yield* session.renewAccess;
    return refreshed === null ? yield* loadSessionSnapshot(hooks) : hooks.getLocalSnapshot();
  });
