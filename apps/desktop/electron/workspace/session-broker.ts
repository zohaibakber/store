import type { IssuedSession, TokenSet } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  type WorkspaceSnapshot as WorkspaceSnapshotType,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  SessionHttp,
  isRejectedStatus,
  isSupersededSession,
  type RequestError,
} from "./session-http";

const SESSION_REJECTED = "You signed in, but the server rejected the session.";

export class SessionPersistFailed extends Schema.TaggedError<SessionPersistFailed>()(
  "SessionPersistFailed",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export interface SessionSnapshotHooks {
  readonly current: Effect.Effect<WorkspaceSnapshotType>;
  readonly publish: (snapshot: WorkspaceSnapshotType) => Effect.Effect<WorkspaceSnapshotType>;
  readonly clearAuthenticated: Effect.Effect<void>;
  readonly persistAuthenticated: (
    snapshot: WorkspaceSnapshotType,
    tokens: TokenSet,
  ) => Effect.Effect<void, SessionPersistFailed>;
}

export const adoptAuthenticatedSnapshot = (
  hooks: SessionSnapshotHooks,
  snapshot: WorkspaceSnapshotType,
  tokens: TokenSet | null,
): Effect.Effect<WorkspaceSnapshotType> =>
  Effect.gen(function* () {
    const online = yield* hooks.publish(withWorkspaceOnline(snapshot, true));
    if (tokens === null) return online;
    return yield* hooks.persistAuthenticated(online, tokens).pipe(
      Effect.as(online),
      Effect.catchTag("SessionPersistFailed", (error) =>
        hooks.publish(withWorkspaceError(online, error.message)),
      ),
    );
  });

const clearSession = (hooks: SessionSnapshotHooks, workspaceError: string | null = null) =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    yield* session.setTokens(null);
    yield* hooks.clearAuthenticated;
    return yield* hooks.publish(unauthenticatedWorkspace({ isOnline: true, workspaceError }));
  });

const publishUnreachable = (hooks: SessionSnapshotHooks, workspaceError: string) =>
  Effect.flatMap(hooks.current, (local) =>
    hooks.publish(withWorkspaceError(withWorkspaceOnline(local, false), workspaceError)),
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
            ? hooks.current
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
          return hooks.current;
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
          access?.workspace === undefined ? loadSessionSnapshot(hooks) : hooks.current,
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
    return yield* refreshed === null ? loadSessionSnapshot(hooks) : hooks.current;
  });
