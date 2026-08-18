import { ClerkProvider } from "@clerk/react";
import { createBrowserHistory } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { useClerkAppearance } from "@/lib/clerk-runtime";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";

import { startWebWorkspace } from "./host";
import { mountApp } from "./mount-app";

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

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
  const { bridge, store } = await startWebWorkspace(apiBaseUrl);
  setAuthSessionBridge(bridge);
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    clerk: (app) => (clerkPublishableKey ? <WebClerk>{app}</WebClerk> : app),
  });
};
