import type { WorkspaceSnapshot } from "@store/contracts";
import type { CatalogLifetime } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import type { AuthSessionBridge } from "@/host";
import { hasAuthenticatedWorkspace, type HostAccessPolicy } from "@/host-access";
import type { ReplayChannel } from "@/host/replay-channel";

import {
  deviceWorkspaceAfter,
  type DeviceWorkspace,
  type DeviceWorkspaceChange,
  type DeviceWorkspaceStore,
} from "./device-workspace";

export type WorkspaceSession =
  | { readonly _tag: "Steady"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Switching"; readonly snapshot: WorkspaceSnapshot };

export const publishedWorkspaceSnapshot = (
  session: WorkspaceSession | undefined,
): WorkspaceSnapshot | null => session?.snapshot ?? null;

type WorkspaceScope =
  | { readonly _tag: "None" }
  | { readonly _tag: "Local" }
  | { readonly _tag: "Organization"; readonly key: string };

const NO_SCOPE: WorkspaceScope = { _tag: "None" };

const workspaceScope = (snapshot: WorkspaceSnapshot, access: HostAccessPolicy): WorkspaceScope => {
  const workspace = access.workspace(snapshot);
  switch (workspace._tag) {
    case "None":
    case "Local":
      return { _tag: workspace._tag };
    case "Organization":
      return { _tag: "Organization", key: `${workspace.organization.id}:${workspace.user.id}` };
  }
};

const sameScope = (left: WorkspaceScope, right: WorkspaceScope): boolean => {
  switch (left._tag) {
    case "None":
    case "Local":
      return right._tag === left._tag;
    case "Organization":
      return right._tag === "Organization" && right.key === left.key;
  }
};

type WorkspaceChange =
  | { readonly _tag: "Session"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Selected"; readonly active: DeviceWorkspace["active"] }
  | { readonly _tag: "LocalCatalog"; readonly state: DeviceWorkspace["localCatalog"] };

type DeviceChange = Exclude<WorkspaceChange, { readonly _tag: "Session" }>;

type WorkspaceSessionPorts = {
  readonly session: ReplayChannel<WorkspaceSession>;
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly device?: DeviceWorkspaceStore;
};

type ApplyWorkspaceSnapshotPorts = WorkspaceSessionPorts & {
  readonly invalidate: () => Promise<void>;
  readonly flush: (fn: () => void) => void;
};

const deviceChangeOf = (
  change: WorkspaceChange,
  previous: WorkspaceSnapshot | null,
): DeviceWorkspaceChange => {
  switch (change._tag) {
    case "Session": {
      const organization = hasAuthenticatedWorkspace(change.snapshot);
      return {
        _tag: "Session",
        organization,
        signedIn: organization && previous !== null && !hasAuthenticatedWorkspace(previous),
      };
    }
    case "Selected":
    case "LocalCatalog":
      return change;
  }
};

const recordFor = (
  device: DeviceWorkspaceStore | undefined,
  change: DeviceWorkspaceChange,
): DeviceWorkspace | null => {
  if (device === undefined) return null;
  const before = device.current();
  const after = deviceWorkspaceAfter(before, change);
  return after === before ? null : after;
};

const recordOnDevice = (
  device: DeviceWorkspaceStore | undefined,
  change: DeviceWorkspaceChange,
): void => {
  const record = recordFor(device, change);
  if (record !== null) device?.write(record);
};

export const startWorkspaceSession = (
  ports: WorkspaceSessionPorts,
  snapshot: WorkspaceSnapshot,
): void => {
  recordOnDevice(ports.device, deviceChangeOf({ _tag: "Session", snapshot }, null));
  ports.session.publish({ _tag: "Steady", snapshot });
  const scope = ports.access.inventoryScope(snapshot);
  if (scope) ports.catalog.claim(scope);
};

const applyWorkspaceChange = (
  ports: ApplyWorkspaceSnapshotPorts,
  change: WorkspaceChange,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = ports.session.current();
    const next = change._tag === "Session" ? change.snapshot : current?.snapshot;
    if (next === undefined) return;
    const from = current ? workspaceScope(current.snapshot, ports.access) : NO_SCOPE;
    recordOnDevice(ports.device, deviceChangeOf(change, current?.snapshot ?? null));
    const to = workspaceScope(next, ports.access);
    if (sameScope(from, to) && current) {
      ports.session.publish({ _tag: "Steady", snapshot: next });
      return;
    }

    ports.flush(() => {
      ports.session.publish({ _tag: "Switching", snapshot: next });
    });

    const scope = ports.access.inventoryScope(next);
    if (scope) ports.catalog.claim(scope);
    else ports.catalog.release();

    yield* Effect.ignore(Effect.tryPromise(() => ports.invalidate()));
    const latest = ports.session.current();
    if (latest?._tag === "Switching" && latest.snapshot === next) {
      ports.session.publish({ _tag: "Steady", snapshot: next });
    }
  });

type WorkspaceSessionBinding = {
  readonly refresh: () => Promise<void>;
  readonly change: (change: DeviceChange) => Promise<void>;
};

const boundSession = Ref.makeUnsafe(Option.none<WorkspaceSessionBinding>());

const bound = (): WorkspaceSessionBinding => {
  const binding = Ref.getUnsafe(boundSession);
  if (Option.isNone(binding)) throw new Error("Workspace session is not bound.");
  return binding.value;
};

export const refreshBoundWorkspaceSession = async () => {
  await bound().refresh();
};

export const selectBoundWorkspace = async (active: DeviceWorkspace["active"]) => {
  await bound().change({ _tag: "Selected", active });
};

export const witnessBoundLocalCatalog = async (state: DeviceWorkspace["localCatalog"]) => {
  await bound().change({ _tag: "LocalCatalog", state });
};

export const bindWorkspaceSession = (
  input: ApplyWorkspaceSnapshotPorts & {
    readonly bridge: Pick<AuthSessionBridge, "getSession" | "onSessionChange">;
  },
): void => {
  const scope = Scope.makeUnsafe();
  const latestCommit = Effect.runSync(FiberHandle.make<void>().pipe(Scope.provide(scope)));
  const commit = (change: WorkspaceChange) =>
    FiberHandle.run(latestCommit, applyWorkspaceChange(input, change), { startImmediately: true });
  const settled = (change: WorkspaceChange) =>
    Effect.runPromise(Effect.flatMap(commit(change), Fiber.await)).then(() => undefined);
  input.bridge.onSessionChange((snapshot) => {
    Effect.runSync(commit({ _tag: "Session", snapshot }));
  });
  const binding: WorkspaceSessionBinding = {
    refresh: async () => settled({ _tag: "Session", snapshot: await input.bridge.getSession() }),
    change: (change) =>
      recordFor(input.device, change) === null ? Promise.resolve() : settled(change),
  };
  Effect.runSync(Ref.set(boundSession, Option.some(binding)));
};
