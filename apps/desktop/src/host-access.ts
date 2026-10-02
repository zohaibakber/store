import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  type AuthenticatedWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@store/contracts";

import type { DeviceWorkspace } from "@/session/device-workspace";

interface AccessLocation {
  readonly pathname: string;
}

type AccessVerdict =
  | { readonly _tag: "Allow" }
  | {
      readonly _tag: "Redirect";
      readonly to: "/sign-in" | "/";
      readonly replace: true;
    };

type AppChrome = { readonly _tag: "Bare" } | { readonly _tag: "Shell" };

type HostInventoryScope = {
  readonly organizationId: string;
  readonly userId: string;
};

type OrganizationWorkspace = {
  readonly _tag: "Organization";
  readonly organization: NonNullable<AuthenticatedWorkspaceSnapshot["activeOrganization"]>;
  readonly user: AuthenticatedWorkspaceSnapshot["user"];
};

type LocalWorkspace = { readonly _tag: "Local" };

export type OpenWorkspace = LocalWorkspace | OrganizationWorkspace;

export type Workspace = { readonly _tag: "None" } | OpenWorkspace;

export interface HostAccessPolicy {
  readonly localWorkspace: boolean;

  readonly workspace: (snapshot: WorkspaceSnapshot | null) => Workspace;

  readonly workspaces: (snapshot: WorkspaceSnapshot | null) => ReadonlyArray<OpenWorkspace>;

  readonly admit: (input: {
    readonly location: AccessLocation;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => AccessVerdict;

  readonly chrome: (input: AccessLocation) => AppChrome;

  readonly inventoryScope: (snapshot: WorkspaceSnapshot | null) => HostInventoryScope | null;
}

const PUBLIC_PATHS = new Set(["/sign-in"]);

const isPublicPath = (pathname: string) => PUBLIC_PATHS.has(pathname);

const NONE: Workspace = { _tag: "None" };

const LOCAL: LocalWorkspace = { _tag: "Local" };

const LOCAL_SCOPE: HostInventoryScope = {
  organizationId: LOCAL_ORGANIZATION_ID,
  userId: LOCAL_USER_ID,
};

const organizationWorkspace = (
  snapshot: WorkspaceSnapshot | null,
): OrganizationWorkspace | null => {
  if (snapshot?.status !== "authenticated" || !snapshot.activeOrganization) return null;
  return { _tag: "Organization", organization: snapshot.activeOrganization, user: snapshot.user };
};

export const hasAuthenticatedWorkspace = (snapshot: WorkspaceSnapshot | null): boolean =>
  organizationWorkspace(snapshot) !== null;

const inventoryScopeOf = (workspace: Workspace): HostInventoryScope | null => {
  switch (workspace._tag) {
    case "None":
      return null;
    case "Local":
      return LOCAL_SCOPE;
    case "Organization":
      return { organizationId: workspace.organization.id, userId: workspace.user.id };
  }
};

const bareChrome = (input: AccessLocation): AppChrome =>
  isPublicPath(input.pathname) ? { _tag: "Bare" } : { _tag: "Shell" };

type DeviceRecord = { readonly current: () => DeviceWorkspace | null };

const resolving =
  (device: DeviceRecord | undefined) =>
  (snapshot: WorkspaceSnapshot | null): Workspace => {
    const organization = organizationWorkspace(snapshot);
    if (device === undefined) return organization ?? NONE;
    const record = device.current();
    if (organization !== null) return record?.active === "local" ? LOCAL : organization;
    return record === null || record.active === "local" || record.localCatalog === "stocked"
      ? LOCAL
      : NONE;
  };

export const hostAccess = (
  options: { readonly localWorkspace?: DeviceRecord } = {},
): HostAccessPolicy => {
  const device = options.localWorkspace;
  const workspace = resolving(device);
  return {
    localWorkspace: device !== undefined,
    workspace,
    workspaces: (snapshot) => {
      const organization = organizationWorkspace(snapshot);
      const offersLocal =
        workspace(snapshot)._tag === "Local" || device?.current()?.localCatalog === "stocked";
      return [...(organization === null ? [] : [organization]), ...(offersLocal ? [LOCAL] : [])];
    },
    chrome: bareChrome,
    inventoryScope: (snapshot) => inventoryScopeOf(workspace(snapshot)),
    admit: ({ location, snapshot }) => {
      if (isPublicPath(location.pathname)) {
        return hasAuthenticatedWorkspace(snapshot)
          ? { _tag: "Redirect", to: "/", replace: true }
          : { _tag: "Allow" };
      }
      return workspace(snapshot)._tag === "None"
        ? { _tag: "Redirect", to: "/sign-in", replace: true }
        : { _tag: "Allow" };
    },
  };
};
