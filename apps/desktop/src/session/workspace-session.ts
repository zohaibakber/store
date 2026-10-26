import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import type { CatalogLifetime } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";

import type { AuthSessionBridge } from "@/host";
import { hasAuthenticatedWorkspace, type HostAccessPolicy } from "@/host-access";

import {
  deviceWorkspaceAfter,
  type DeviceWorkspace,
  type DeviceWorkspaceChange,
  type DeviceWorkspaceStore,
} from "./device-workspace";

export type WorkspaceSession =
  | { readonly _tag: "Steady"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Switching"; readonly snapshot: WorkspaceSnapshot };

type WorkspaceScope =
  | { readonly _tag: "None" }
  | { readonly _tag: "Local" }
  | { readonly _tag: "Organization"; readonly key: string };

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

export type WorkspaceSessionPorts = {
  readonly catalog: CatalogLifetime;
  readonly access: HostAccessPolicy;
  readonly device: DeviceWorkspaceStore;
  readonly bridge: Pick<AuthSessionBridge, "getSession" | "onSessionChange">;
  readonly invalidate: () => Promise<void>;
  readonly flush: (fn: () => void) => void;
};

export const workspaceSessionAtom = Atom.make<WorkspaceSession>({
  _tag: "Steady",
  snapshot: unauthenticatedWorkspace({ isOnline: false }),
}).pipe(Atom.keepAlive);

const workspaceSessionPortsAtom = Atom.make(Option.none<WorkspaceSessionPorts>()).pipe(
  Atom.keepAlive,
);

const portsOf = (registry: AtomRegistry.AtomRegistry) =>
  Option.match(registry.get(workspaceSessionPortsAtom), {
    onNone: () => Effect.die("Workspace session ports are not mounted."),
    onSome: Effect.succeed,
  });

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
  device: DeviceWorkspaceStore,
  change: DeviceWorkspaceChange,
): DeviceWorkspace | null => {
  const before = device.current();
  const after = deviceWorkspaceAfter(before, change);
  return after === before ? null : after;
};

const recordOnDevice = (device: DeviceWorkspaceStore, change: DeviceWorkspaceChange): void => {
  const record = recordFor(device, change);
  if (record !== null) device.write(record);
};

export const startWorkspaceSession = (
  registry: AtomRegistry.AtomRegistry,
  ports: WorkspaceSessionPorts,
  snapshot: WorkspaceSnapshot,
): void => {
  registry.set(workspaceSessionPortsAtom, Option.some(ports));
  recordOnDevice(ports.device, deviceChangeOf({ _tag: "Session", snapshot }, null));
  registry.set(workspaceSessionAtom, { _tag: "Steady", snapshot });
  const scope = ports.access.inventoryScope(snapshot);
  if (scope) ports.catalog.claim(scope);
};

const leaveBatch = Effect.promise(() => Promise.resolve());

const commitWorkspaceChange = Atom.fn<WorkspaceChange>()(
  Effect.fn("WorkspaceSession.commit")(function* (change: WorkspaceChange, get: Atom.FnContext) {
    const ports = yield* portsOf(get.registry);
    const current = get.registry.get(workspaceSessionAtom);
    const next = change._tag === "Session" ? change.snapshot : current.snapshot;
    const from = workspaceScope(current.snapshot, ports.access);
    recordOnDevice(ports.device, deviceChangeOf(change, current.snapshot));
    const to = workspaceScope(next, ports.access);
    if (sameScope(from, to)) {
      get.set(workspaceSessionAtom, { _tag: "Steady", snapshot: next });
      return;
    }

    yield* leaveBatch;
    ports.flush(() => {
      get.set(workspaceSessionAtom, { _tag: "Switching", snapshot: next });
    });

    const scope = ports.access.inventoryScope(next);
    if (scope) ports.catalog.claim(scope);
    else ports.catalog.release();

    yield* Effect.ignore(Effect.tryPromise(() => ports.invalidate()));
    const latest = get.registry.get(workspaceSessionAtom);
    if (latest._tag === "Switching" && latest.snapshot === next) {
      get.set(workspaceSessionAtom, { _tag: "Steady", snapshot: next });
    }
  }),
).pipe(Atom.keepAlive);

const settled = (get: Atom.FnContext, change: WorkspaceChange) => {
  get.set(commitWorkspaceChange, change);
  return get.result(commitWorkspaceChange, { suspendOnWaiting: true });
};

export const refreshWorkspaceSession = Atom.fn<void>()(
  Effect.fn("WorkspaceSession.refresh")(function* (_: void, get: Atom.FnContext) {
    const { bridge } = yield* portsOf(get.registry);
    const snapshot = yield* Effect.tryPromise({
      try: () => bridge.getSession(),
      catch: (cause) => cause,
    });
    yield* settled(get, { _tag: "Session", snapshot });
  }),
);

const changeDevice = Effect.fn("WorkspaceSession.changeDevice")(function* (
  change: DeviceChange,
  get: Atom.FnContext,
) {
  const { device } = yield* portsOf(get.registry);
  if (recordFor(device, change) === null) return;
  yield* settled(get, change);
});

export const selectWorkspace = Atom.fn<DeviceWorkspace["active"]>()((active, get) =>
  changeDevice({ _tag: "Selected", active }, get),
);

export const witnessLocalCatalog = Atom.fn<DeviceWorkspace["localCatalog"]>()((state, get) =>
  changeDevice({ _tag: "LocalCatalog", state }, get),
);

export const workspaceSessionFeed = Atom.make(
  Effect.fn("WorkspaceSession.feed")(function* (get: Atom.AtomContext) {
    const { bridge } = yield* portsOf(get.registry);
    yield* Stream.callback<WorkspaceSnapshot>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => bridge.onSessionChange((snapshot) => Queue.offerUnsafe(queue, snapshot))),
        (stop) => Effect.sync(stop),
      ),
    ).pipe(
      Stream.runForEach((snapshot) =>
        Effect.sync(() => get.set(commitWorkspaceChange, { _tag: "Session", snapshot })),
      ),
    );
  }),
).pipe(Atom.keepAlive);
