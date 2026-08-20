import { ClerkProvider } from "@clerk/react";
import { createBrowserHistory } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";
import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { useClerkAppearance } from "@/lib/clerk-runtime";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";

import { startWebWorkspace } from "./host";
import { mountApp } from "./mount-app";

function WebClerk({ children }: { children: ReactNode }) {
  const appearance = useClerkAppearance();
  return (
    <ClerkProvider appearance={appearance} publishableKey={clerkPublishableKey}>
      <ClerkActiveOrganization />
      <ClerkWorkspaceSync />
      {children}
    </ClerkProvider>
  );
}

export const startWeb = async () => {
  const apiBaseUrl = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  const { bridge, store } = await startWebWorkspace(apiBaseUrl);
  setAuthSessionBridge(bridge);
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    clerk: (app) => (clerkPublishableKey ? <WebClerk>{app}</WebClerk> : app),
  });
};
