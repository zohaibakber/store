import type { WorkspaceSnapshot } from "@store/contracts";

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

export interface HostAccessPolicy {
  readonly admit: (input: {
    readonly location: AccessLocation;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => AccessVerdict;

  readonly chrome: (input: AccessLocation) => AppChrome;

  readonly inventoryScope: (snapshot: WorkspaceSnapshot | null) => HostInventoryScope | null;
}

const PUBLIC_PATHS = new Set(["/sign-in"]);

const isPublicPath = (pathname: string) => PUBLIC_PATHS.has(pathname);

export const hasAuthenticatedWorkspace = (snapshot: WorkspaceSnapshot | null): boolean =>
  snapshot?.status === "authenticated" && snapshot.activeOrganization != null;

const remoteInventoryScope = (snapshot: WorkspaceSnapshot | null): HostInventoryScope | null => {
  if (snapshot?.status !== "authenticated" || !snapshot.activeOrganization) return null;
  return {
    organizationId: snapshot.activeOrganization.id,
    userId: snapshot.user.id,
  };
};

const bareChrome = (input: AccessLocation): AppChrome =>
  PUBLIC_PATHS.has(input.pathname) ? { _tag: "Bare" } : { _tag: "Shell" };

export const hostAccess = (): HostAccessPolicy => ({
  chrome: bareChrome,
  inventoryScope: remoteInventoryScope,
  admit: ({ location, snapshot }) => {
    const authenticated = hasAuthenticatedWorkspace(snapshot);
    if (isPublicPath(location.pathname)) {
      if (authenticated) return { _tag: "Redirect", to: "/", replace: true };
      return { _tag: "Allow" };
    }
    if (!authenticated) return { _tag: "Redirect", to: "/sign-in", replace: true };
    return { _tag: "Allow" };
  },
});
