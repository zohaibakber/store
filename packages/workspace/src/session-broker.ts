import type { TokenSet as TokenSetType } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  type WorkspaceSnapshot as WorkspaceSnapshotType,
} from "@store/contracts/workspace";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { SessionHttp, type RequestError } from "./session-http";

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

export const loadSessionSnapshot = (
  hooks: SessionSnapshotHooks,
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    if (!session.tokens.get()) return yield* clearSession(hooks);
    const loaded = yield* Effect.result(session.workspace);
    if (Result.isFailure(loaded)) {
      if (isRejected(loaded.failure)) return yield* clearSession(hooks, loaded.failure.message);
      return hooks.publish(
        withWorkspaceError(
          withWorkspaceOnline(hooks.getLocalSnapshot(), false),
          loaded.failure.message,
        ),
      );
    }
    if (loaded.success.status !== "authenticated") {
      return yield* clearSession(hooks, "You signed in, but the server rejected the session.");
    }
    return yield* adoptAuthenticatedSnapshot(hooks, loaded.success);
  });

export const adoptSessionTokens = (
  hooks: SessionSnapshotHooks,
  tokens: TokenSetType | null,
  options?: { readonly onCleared?: Effect.Effect<void> },
): Effect.Effect<WorkspaceSnapshotType, never, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    yield* session.setTokens(tokens);
    if (tokens) return yield* loadSessionSnapshot(hooks);
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
