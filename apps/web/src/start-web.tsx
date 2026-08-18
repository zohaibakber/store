import { ClerkProvider } from "@clerk/react";
import { createBrowserHistory } from "@tanstack/react-router";

import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";

import { startWebWorkspace } from "./host";
import { mountApp } from "./mount-app";

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const startWeb = async () => {
  const { bridge, store } = await startWebWorkspace(apiBaseUrl);
  setAuthSessionBridge(bridge);
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    clerk: (app) =>
      clerkPublishableKey ? (
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <ClerkActiveOrganization />
          <ClerkWorkspaceSync />
          {app}
        </ClerkProvider>
      ) : (
        app
      ),
  });
};
