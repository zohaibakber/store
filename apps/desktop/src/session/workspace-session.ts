import type { WorkspaceSnapshot } from "@store/contracts";
import type { CatalogLifetime, CatalogReplica } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import { hasAuthenticatedWorkspace, type HostAccessPolicy } from "@/host-access";
import type { ReplayChannel } from "@/replay-channel";

export type SessionChangeBridge = {
  readonly getSession: () => Promise<WorkspaceSnapshot>;
  readonly onSessionChange: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void;
};

export type WorkspaceSession =
  | { readonly _tag: "Steady"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Switching"; readonly snapshot: WorkspaceSnapshot };

export const publishedWorkspaceSnapshot = (
  session: WorkspaceSession | undefined,
): WorkspaceSnapshot | null => session?.snapshot ?? null;

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
};

export const applyWorkspaceSnapshot = (
  ports: ApplyWorkspaceSnapshotPorts,
  next: WorkspaceSnapshot,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = ports.session.current();
    const from = current
      ? workspaceScope(current.snapshot, ports.access)
      : { _tag: "None" as const };
    const to = workspaceScope(next, ports.access);
    if (sameScope(from, to) && current) {
      ports.session.publish({ _tag: "Steady", snapshot: next });
      return;
    }

    ports.flush(() => {
      ports.session.publish({ _tag: "Switching", snapshot: next });
    });

    const scope = to._tag === "None" ? null : ports.access.inventoryScope(next);
    if (scope) ports.catalog.claim(scope);
    else ports.catalog.release();

    yield* Effect.ignore(Effect.tryPromise(() => ports.invalidate()));
    const latest = ports.session.current();
    if (latest?._tag === "Switching" && latest.snapshot === next) {
      ports.session.publish({ _tag: "Steady", snapshot: next });
    }
  });

export type WorkspaceSessionBinding = {
  readonly refresh: () => Promise<void>;
  readonly stop: () => void;
};

const boundSession = Ref.makeUnsafe(Option.none<WorkspaceSessionBinding>());

export const refreshBoundWorkspaceSession = async () => {
  const binding = Ref.getUnsafe(boundSession);
  if (Option.isNone(binding)) throw new Error("Workspace session is not bound.");
  await binding.value.refresh();
};

export const bindWorkspaceSession = (input: {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime<CatalogReplica>;
  readonly access: HostAccessPolicy;
  readonly bridge: SessionChangeBridge;
  readonly invalidate: () => Promise<void>;
  readonly flush: (fn: () => void) => void;
}): WorkspaceSessionBinding => {
  const scope = Scope.makeUnsafe();
  const latestCommit = Effect.runSync(FiberHandle.make<void>().pipe(Scope.provide(scope)));
  const commit = (snapshot: WorkspaceSnapshot) =>
    FiberHandle.run(latestCommit, applyWorkspaceSnapshot(input, snapshot));
  const unsubscribe = input.bridge.onSessionChange((snapshot) => {
    Effect.runSync(commit(snapshot));
  });
  const binding: WorkspaceSessionBinding = {
    refresh: async () => {
      const snapshot = await input.bridge.getSession();
      await Effect.runPromise(Effect.flatMap(commit(snapshot), Fiber.await));
    },
    stop: () => {
      unsubscribe();
      Effect.runSync(
        Ref.update(boundSession, (current) =>
          Option.isSome(current) && current.value === binding ? Option.none() : current,
        ),
      );
      Effect.runFork(Scope.close(scope, Exit.void));
    },
  };
  Effect.runSync(Ref.set(boundSession, Option.some(binding)));
  return binding;
};
