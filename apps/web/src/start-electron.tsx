import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider as ElectronClerkProvider } from "@clerk/electron/react";
import { DEFAULT_ELECTRON_PROTOCOL } from "@store/auth/security";
import { createHashHistory } from "@tanstack/react-router";

import { bootstrapAuth } from "@/lib/auth";
import {
  ClerkActiveOrganization,
  ClerkWorkspaceSync,
  clerkPublishableKey,
} from "@/lib/clerk-workspace";
import { electronStore } from "@/lib/store";

import { mountApp } from "./mount-app";

export const startElectron = async () => {
  const store = electronStore();
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    clerk: (app) =>
      clerkPublishableKey ? (
        <ElectronClerkProvider
          allowedRedirectProtocols={[DEFAULT_ELECTRON_PROTOCOL]}
          passkeys={passkeys}
          publishableKey={clerkPublishableKey}
        >
          <ClerkActiveOrganization />
          <ClerkWorkspaceSync />
          {app}
        </ElectronClerkProvider>
      ) : (
        app
      ),
  });
};
