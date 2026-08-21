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

/**
 * Host access policy. Inject exactly one adapter at bootstrap
 * (`browserHostAccess` or `desktopHostAccess`). Routes stay host-blind.
 *
 * Product axis: {@link HostAccessPolicy.allowsGuestWorkspace} — whether this
 * host may run without an authenticated workspace (Locked store + continue
 * offline). Browser: false. Desktop: true.
 */
export interface HostAccessPolicy {
  readonly admit: (input: {
    readonly location: AccessLocation;
    readonly snapshot: WorkspaceSnapshot | null;
  }) => AccessVerdict;

  readonly chrome: (input: AccessLocation) => AppChrome;

  /**
   * True iff Locked guest inventory and sign-in “continue offline” are part of
   * this host product.
   */
  readonly allowsGuestWorkspace: boolean;
}

const PUBLIC_PATHS = new Set(["/sign-in"]);

const isPublicPath = (pathname: string) => PUBLIC_PATHS.has(pathname);

const hasAuthenticatedWorkspace = (snapshot: WorkspaceSnapshot | null): boolean =>
  snapshot?.status === "authenticated" && snapshot.activeOrganization != null;

const bareChrome = (input: AccessLocation): AppChrome =>
  isPublicPath(input.pathname) ? { _tag: "Bare" } : { _tag: "Shell" };

/** Browser: app routes require an authenticated workspace. */
export const browserHostAccess = (): HostAccessPolicy => ({
  allowsGuestWorkspace: false,
  chrome: bareChrome,
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

/** Desktop: anonymous / locked local store remains a first-class entry. */
export const desktopHostAccess = (): HostAccessPolicy => ({
  allowsGuestWorkspace: true,
  chrome: bareChrome,
  admit: ({ location, snapshot }) => {
    if (isPublicPath(location.pathname) && hasAuthenticatedWorkspace(snapshot)) {
      return { _tag: "Redirect", to: "/", replace: true };
    }
    return { _tag: "Allow" };
  },
});
