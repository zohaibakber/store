import type { WorkspaceSnapshot } from "@store/contracts";
import { createBrowserHistory } from "@tanstack/react-router";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";
import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { authBaseUrl, completeGoogle } from "@/lib/first-party-auth";

import { startWebWorkspace } from "./host";
import { browserHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

const hasAuthenticatedWorkspace = (snapshot: WorkspaceSnapshot): boolean =>
  snapshot.status === "authenticated" && snapshot.activeOrganization != null;

export const startWeb = async () => {
  const apiBaseUrl = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  const access = browserHostAccess();
  const history = createBrowserHistory();
  const workspace = startWebWorkspace(apiBaseUrl, authBaseUrl, {
    allowsGuestWorkspace: access.allowsGuestWorkspace,
  });
  setAuthSessionBridge(workspace.bridge);

  const authSnapshot = await workspace.resolveAuth();
  await completeGoogle(globalThis.location.href).catch(() => false);

  // OAuth AdoptSession activates the store inline. Cookie sessions from
  // resolveAuth still need activateWorkspace before inventory routes are safe.
  if (workspace.hasStore() || !hasAuthenticatedWorkspace(authSnapshot)) {
    // Unsigned / guest-refused: mount as soon as auth is known (no Locked store).
    // OAuth-completed: store already open — mount with the live session.
    mountApp({
      store: workspace.store,
      initialAuth: await bootstrapAuth(),
      history,
      access,
    });
    return;
  }

  // Signed-in cookie path: replace #boot-shell with React AppLoading while
  // OfflineStore opens. sessionPending keeps admit from bouncing to /sign-in
  // before the authenticated snapshot is published.
  mountApp({
    store: workspace.store,
    initialAuth: { _tag: "Loading" },
    history,
    access,
    sessionPending: true,
  });
  await workspace.activateWorkspace();
};
