import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import { claimedCatalogScope } from "@store/inventory-react";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { AuthSessionBridge } from "@/host";
import {
  hasAuthenticatedWorkspace,
  type HostAccessPolicy,
  type OpenWorkspace,
  type Workspace,
} from "@/host-access";

import {
  deviceWorkspaceAfter,
  type DeviceWorkspace,
  type DeviceWorkspaceChange,
  type DeviceWorkspaceStore,
} from "./device-workspace";

export type WorkspaceSession = {
  readonly _tag: "Steady" | "Switching";
  readonly snapshot: WorkspaceSnapshot;
  readonly workspace: Workspace;
  readonly workspaces: ReadonlyArray<OpenWorkspace>;
};

const sessionOf = (
  tag: WorkspaceSession["_tag"],
  snapshot: WorkspaceSnapshot,
  access: HostAccessPolicy,
): WorkspaceSession => ({
  _tag: tag,
  snapshot,
  workspace: access.workspace(snapshot),
  workspaces: access.workspaces(snapshot),
});

type WorkspaceScope =
  | { readonly _tag: "None" }
  | { readonly _tag: "Local" }
  | { readonly _tag: "Organization"; readonly key: string };

const workspaceScope = (workspace: Workspace): WorkspaceScope => {
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

class WorkspaceSessionPorts extends Context.Service<
  WorkspaceSessionPorts,
  {
    readonly access: HostAccessPolicy;
    readonly device: DeviceWorkspaceStore;
    readonly bridge: Pick<AuthSessionBridge, "getSession" | "sessionChanges">;
    readonly invalidate: Effect.Effect<void>;
    readonly flush: (fn: () => void) => void;
  }
>()("@store/desktop/WorkspaceSessionPorts") {}

export class WorkspaceSessionUnreachable extends Schema.TaggedError<WorkspaceSessionUnreachable>()(
  "WorkspaceSessionUnreachable",
  { cause: Schema.Defect() },
) {}

class WorkspaceSessionPortsMissing extends Schema.TaggedError<WorkspaceSessionPortsMissing>()(
  "WorkspaceSessionPortsMissing",
  {},
) {}

export const workspaceSessionAtom = Atom.make<WorkspaceSession>({
  _tag: "Steady",
  snapshot: unauthenticatedWorkspace({ isOnline: false }),
  workspace: { _tag: "None" },
  workspaces: [],
}).pipe(Atom.keepAlive);

const workspaceSessionPorts = Atom.make(Option.none<WorkspaceSessionPorts["Service"]>()).pipe(
  Atom.keepAlive,
);

const sessionRuntime = Atom.runtime((get) =>
  Option.match(get(workspaceSessionPorts), {
    onNone: () =>
      Layer.effect(WorkspaceSessionPorts, Effect.fail(new WorkspaceSessionPortsMissing())),
    onSome: (ports) => Layer.succeed(WorkspaceSessionPorts, ports),
  }),
);

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
  ports: WorkspaceSessionPorts["Service"],
  snapshot: WorkspaceSnapshot,
): void => {
  registry.set(workspaceSessionPorts, Option.some(ports));
  recordOnDevice(ports.device, deviceChangeOf({ _tag: "Session", snapshot }, null));
  registry.set(workspaceSessionAtom, sessionOf("Steady", snapshot, ports.access));
  registry.set(claimedCatalogScope, Option.fromNullishOr(ports.access.inventoryScope(snapshot)));
};

const leaveRegistryBatch = Effect.callback<void>((resume) => {
  queueMicrotask(() => resume(Effect.void));
});

const commitWorkspaceChange = sessionRuntime
  .fn<WorkspaceChange>()(
    Effect.fn("WorkspaceSession.commit")(function* (change, get) {
      const { access, device, flush, invalidate } = yield* WorkspaceSessionPorts;
      const current = get.registry.get(workspaceSessionAtom);
      const next = change._tag === "Session" ? change.snapshot : current.snapshot;
      const from = workspaceScope(current.workspace);
      recordOnDevice(device, deviceChangeOf(change, current.snapshot));
      const resolved = sessionOf("Steady", next, access);
      if (sameScope(from, workspaceScope(resolved.workspace))) {
        get.set(workspaceSessionAtom, resolved);
        return;
      }

      yield* leaveRegistryBatch;
      flush(() => {
        get.set(workspaceSessionAtom, { ...resolved, _tag: "Switching" });
      });
      get.set(claimedCatalogScope, Option.fromNullishOr(access.inventoryScope(next)));

      yield* invalidate;
      const latest = get.registry.get(workspaceSessionAtom);
      if (latest._tag === "Switching" && latest.snapshot === next) {
        get.set(workspaceSessionAtom, resolved);
      }
    }),
  )
  .pipe(Atom.keepAlive);

const settled = (get: Atom.FnContext, change: WorkspaceChange) => {
  get.set(commitWorkspaceChange, change);
  return get.result(commitWorkspaceChange, { suspendOnWaiting: true });
};

export const refreshWorkspaceSession = sessionRuntime.fn<void>()(
  Effect.fn("WorkspaceSession.refresh")(function* (_, get) {
    const { bridge } = yield* WorkspaceSessionPorts;
    const snapshot = yield* Effect.tryPromise({
      try: () => bridge.getSession(),
      catch: (cause) => new WorkspaceSessionUnreachable({ cause }),
    });
    yield* settled(get, { _tag: "Session", snapshot });
  }),
);

const changeDevice = Effect.fn("WorkspaceSession.changeDevice")(function* (
  change: DeviceChange,
  get: Atom.FnContext,
) {
  const { device } = yield* WorkspaceSessionPorts;
  if (recordFor(device, change) === null) return;
  yield* settled(get, change);
});

export const selectWorkspace = sessionRuntime.fn<DeviceWorkspace["active"]>()((active, get) =>
  changeDevice({ _tag: "Selected", active }, get),
);

export const witnessLocalCatalog = sessionRuntime.fn<DeviceWorkspace["localCatalog"]>()(
  (state, get) => changeDevice({ _tag: "LocalCatalog", state }, get),
);

export const workspaceSessionFeed = sessionRuntime
  .atom(
    Effect.gen(function* () {
      const { bridge } = yield* WorkspaceSessionPorts;
      const registry = yield* AtomRegistry.AtomRegistry;
      yield* bridge.sessionChanges.pipe(
        Stream.runForEach((snapshot) =>
          Effect.sync(() => registry.set(commitWorkspaceChange, { _tag: "Session", snapshot })),
        ),
      );
    }),
  )
  .pipe(Atom.keepAlive);
