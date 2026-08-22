import type { TokenSet as TokenSetType } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  WorkspaceSnapshot,
  type WorkspaceSnapshot as WorkspaceSnapshotType,
} from "@store/contracts/workspace";
import * as Schema from "effect/Schema";

import { RequestError, type SessionHttpClient } from "./session-http";

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

export interface SessionSnapshotHooks {
  readonly http: SessionHttpClient;
  readonly getLocalSnapshot: () => WorkspaceSnapshotType;
  readonly publish: (snapshot: WorkspaceSnapshotType) => WorkspaceSnapshotType;
  /** Optional clear of persisted tokens/session when auth is rejected (desktop). */
  readonly clearAuthenticated?: () => Promise<void>;
  /** Optional persist after a successful authenticated session (desktop). */
  readonly persistAuthenticated?: (snapshot: WorkspaceSnapshotType) => Promise<void>;
}

/**
 * Shared ensure-fresh → GET /api/auth/session → online/offline/error mapping.
 * Hosts only supply refresh + optional persistence; this owns the snapshot machine.
 */
export const loadSessionSnapshot = async (
  hooks: SessionSnapshotHooks,
): Promise<WorkspaceSnapshotType> => {
  if (!hooks.http.tokens.get()) {
    const local = hooks.getLocalSnapshot();
    return hooks.publish(withWorkspaceOnline(local, local.status === "authenticated"));
  }
  try {
    const snapshot = Schema.decodeUnknownSync(WorkspaceSnapshot)(
      await hooks.http.apiRequest("/api/auth/session"),
    );
    if (snapshot.status !== "authenticated") {
      await hooks.clearAuthenticated?.();
      return hooks.publish(
        unauthenticated(true, "You signed in, but the server rejected the session."),
      );
    }
    const online = withWorkspaceOnline(snapshot, true);
    await hooks.persistAuthenticated?.(online);
    return hooks.publish(online);
  } catch (error) {
    if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
      await hooks.clearAuthenticated?.();
      return hooks.publish(unauthenticated(true, error.message));
    }
    return hooks.publish(
      withWorkspaceError(
        withWorkspaceOnline(hooks.getLocalSnapshot(), false),
        error instanceof Error ? error.message : "Could not reach the session server.",
      ),
    );
  }
};

export const adoptSessionTokens = async (
  hooks: SessionSnapshotHooks,
  tokens: TokenSetType | null,
  options?: { readonly onCleared?: () => Promise<void> },
): Promise<WorkspaceSnapshotType> => {
  hooks.http.tokens.set(tokens);
  if (!tokens) {
    await options?.onCleared?.();
    return hooks.publish(unauthenticated(true));
  }
  return loadSessionSnapshot(hooks);
};

export const renewSessionSnapshot = async (
  hooks: SessionSnapshotHooks,
): Promise<WorkspaceSnapshotType> => {
  await hooks.http.ensureFreshAccess(true);
  return loadSessionSnapshot(hooks);
};
