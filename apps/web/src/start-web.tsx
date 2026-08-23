import { createBrowserHistory } from "@tanstack/react-router";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";
import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { authBaseUrl, completeGoogle } from "@/lib/first-party-auth";

import { browserHostAccess } from "./host-access";
import { mountApp } from "./mount-app";
import { startWebSession } from "./session-host";

export const startWeb = async () => {
  const apiBaseUrl = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  const session = startWebSession(apiBaseUrl, authBaseUrl);
  setAuthSessionBridge(session.bridge);
  await session.initialize();
  await completeGoogle(globalThis.location.href).catch(() => false);

  mountApp({
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: browserHostAccess(),
    inventory: {
      apiBaseUrl,
      authenticatedFetch: session.bridge.apiFetch!,
      deviceId: session.bridge.deviceId!,
      openPersistence: async (databaseName: string) => {
        const { openBrowserInventoryPersistence } =
          await import("@/lib/inventory-persistence.browser");
        return openBrowserInventoryPersistence(databaseName);
      },
    },
  });
};
