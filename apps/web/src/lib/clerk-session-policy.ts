import type { WorkspaceSnapshot } from "@store/contracts";

export type WorkspaceScreen = "loading" | "shell" | "create-org" | "auth";
export type ClerkWorkspaceSyncAction = "idle" | "clear" | "refresh";

/**
 * The local catalog is the source of truth. Clerk is only required to mint a
 * token for the first sign-in and later sync. Never to open an existing store.
 */
export function workspaceScreen(input: {
  readonly snapshot: WorkspaceSnapshot | null;
  readonly clerkConfigured: boolean;
  readonly clerkLoaded: boolean;
  readonly online: boolean;
}): WorkspaceScreen {
  if (input.snapshot?.status === "authenticated") {
    return input.snapshot.activeOrganization ? "shell" : "create-org";
  }
  if (!input.clerkConfigured) return "auth";
  if (!input.clerkLoaded && input.online) return "loading";
  return "auth";
}

/** Do not drop a persisted workspace just because Clerk could not reach FAPI. */
export function clerkWorkspaceSyncAction(input: {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
  readonly online: boolean;
}): ClerkWorkspaceSyncAction {
  if (!input.isLoaded) return "idle";
  if (input.isSignedIn) return "refresh";
  return input.online ? "clear" : "idle";
}
