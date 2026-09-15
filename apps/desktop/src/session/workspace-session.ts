import type { WorkspaceSnapshot } from "@store/contracts";

import { hasAuthenticatedWorkspace, type HostAccessPolicy } from "@/host-access";
import type { CatalogLifetime, CatalogReplica } from "@/lib/inventory/lifetime";
import type { ReplayChannel } from "@/replay-channel";

export type SessionChangeBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

/**
 * Phase is a shell gate, not an admit flag.
 * beforeLoad reads `.snapshot` and ignores `_tag`.
 * Switching.snapshot is the destination already published.
 */
export type WorkspaceSession =
  | { readonly _tag: "Steady"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Switching"; readonly snapshot: WorkspaceSnapshot };

export type WorkspaceScope =
  | { readonly _tag: "None" }
  | { readonly _tag: "Organization"; readonly key: string };

export const workspaceScope = (
  snapshot: WorkspaceSnapshot,
  access: HostAccessPolicy,
): WorkspaceScope => {
  if (!hasAuthenticatedWorkspace(snapshot)) return { _tag: "None" };
  const scope = access.inventoryScope(snapshot);
  if (!scope) return { _tag: "None" };
  return { _tag: "Organization", key: `${scope.organizationId}:${scope.userId}` };
};

const sameScope = (left: WorkspaceScope, right: WorkspaceScope): boolean => {
  if (left._tag === "None" && right._tag === "None") return true;
  return left._tag === "Organization" && right._tag === "Organization" && left.key === right.key;
};

export type ApplyWorkspaceSnapshotPorts = {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime<CatalogReplica>;
  readonly access: HostAccessPolicy;
  readonly invalidate: () => Promise<void>;
  readonly flush: (fn: () => void) => void;
  readonly isCurrent: () => boolean;
};

/**
 * The only writer of WorkspaceSession. Does not navigate, admit, or await
 * PowerSync dispose.
 */
export const applyWorkspaceSnapshot = async (
  ports: ApplyWorkspaceSnapshotPorts,
  next: WorkspaceSnapshot,
): Promise<void> => {
  const current = ports.session.current();
  const from = current ? workspaceScope(current.snapshot, ports.access) : { _tag: "None" as const };
  const to = workspaceScope(next, ports.access);
  if (sameScope(from, to) && current) {
    ports.session.publish({ _tag: "Steady", snapshot: next });
    return;
  }

  ports.flush(() => {
    ports.session.publish({ _tag: "Switching", snapshot: next });
  });

  if (to._tag === "None") {
    ports.catalog.release();
  } else {
    const scope = ports.access.inventoryScope(next);
    if (scope) ports.catalog.claim(scope);
    else ports.catalog.release();
  }

  await ports.invalidate().catch(() => undefined);
  if (!ports.isCurrent()) return;
  const latest = ports.session.current();
  if (latest?._tag === "Switching" && latest.snapshot === next) {
    ports.session.publish({ _tag: "Steady", snapshot: next });
  }
};

let boundRefresh: (() => Promise<void>) | undefined;

export const refreshBoundWorkspaceSession = async () => {
  if (!boundRefresh) throw new Error("Workspace session is not bound.");
  await boundRefresh();
};

export const bindWorkspaceSession = (input: {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime<CatalogReplica>;
  readonly access: HostAccessPolicy;
  readonly bridge: SessionChangeBridge;
  readonly invalidate: () => Promise<void>;
  readonly flush: (fn: () => void) => void;
}) => {
  let epoch = 0;
  const commit = (snapshot: WorkspaceSnapshot) => {
    const thisEpoch = ++epoch;
    return applyWorkspaceSnapshot(
      {
        session: input.session,
        catalog: input.catalog,
        access: input.access,
        invalidate: input.invalidate,
        flush: input.flush,
        isCurrent: () => thisEpoch === epoch,
      },
      snapshot,
    );
  };
  const refresh = async () => {
    await commit(await input.bridge.getSession());
  };
  boundRefresh = refresh;
  const stop = input.bridge.onSessionChange((snapshot) => {
    void commit(snapshot);
  });
  return {
    stop: () => {
      stop();
      if (boundRefresh === refresh) boundRefresh = undefined;
    },
    refresh,
  };
};
