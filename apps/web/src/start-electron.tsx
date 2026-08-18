import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import { DEFAULT_ELECTRON_PROTOCOL } from "@store/auth/security";
import { createHashHistory } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { bootstrapAuth } from "@/lib/auth";
import { useClerkAppearance } from "@/lib/clerk-runtime";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";
import { electronStore } from "@/lib/store";

import { mountApp } from "./mount-app";

function ElectronClerk({ children }: { children: ReactNode }) {
  const appearance = useClerkAppearance();
  return (
    <ElectronClerkProvider
      allowedRedirectProtocols={[DEFAULT_ELECTRON_PROTOCOL]}
      appearance={appearance}
      passkeys={passkeys}
      publishableKey={clerkPublishableKey}
    >
      <ClerkActiveOrganization />
      <ClerkWorkspaceSync />
      {children}
    </ElectronClerkProvider>
  );
}

export const startElectron = async () => {
  const store = electronStore();
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    clerk: (app) => (clerkPublishableKey ? <ElectronClerk>{app}</ElectronClerk> : app),
  });
};
