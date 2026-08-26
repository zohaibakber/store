import type { WorkspaceSnapshot } from "@store/contracts";

/** Where the user is trying to go, stripped to what access needs. */
export interface AccessLocation {
  readonly pathname: string;
}

/**
 * Outcome of one admit() call. Completes the host decision in one step —
 * callers do not classify routes, then check auth, then pick a URL.
 */
export type AccessVerdict =
  | { readonly _tag: "Allow" }
  | {
      readonly _tag: "Redirect";
      readonly to: "/sign-in" | "/";
      readonly replace: true;
    };

export type AppChrome = { readonly _tag: "Bare" } | { readonly _tag: "Shell" };

/** Signed organization inventory. Desktop does not open a guest catalog. */
export type HostInventoryScope = {
  readonly organizationId: string;
  readonly userId: string;
};

/**
 * Host access policy. Injected at Electron bootstrap. Routes stay host-blind.
 */
export interface HostAccessPolicy {
  readonly admit: (input: {
    readonly location: AccessLocation;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => AccessVerdict;

  readonly chrome: (input: AccessLocation) => AppChrome;

  /** Resolves the inventory workspace for this session, or null until signed in. */
  readonly inventoryScope: (snapshot: WorkspaceSnapshot | null) => HostInventoryScope | null;
}

const PUBLIC_PATHS = new Set(["/sign-in"]);

const BARE_PATHS = PUBLIC_PATHS;

const isPublicPath = (pathname: string) => PUBLIC_PATHS.has(pathname);

const hasAuthenticatedWorkspace = (snapshot: WorkspaceSnapshot | null): boolean =>
  snapshot?.status === "authenticated" && snapshot.activeOrganization != null;

const remoteInventoryScope = (snapshot: WorkspaceSnapshot | null): HostInventoryScope | null => {
  if (snapshot?.status !== "authenticated" || !snapshot.activeOrganization) return null;
  return {
    organizationId: snapshot.activeOrganization.id,
    userId: snapshot.user.id,
  };
};

const bareChrome = (input: AccessLocation): AppChrome =>
  BARE_PATHS.has(input.pathname) ? { _tag: "Bare" } : { _tag: "Shell" };

/** Desktop: app routes require an authenticated workspace. */
export const desktopHostAccess = (): HostAccessPolicy => ({
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
