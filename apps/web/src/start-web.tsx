import { createBrowserHistory } from "@tanstack/react-router";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";
import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { authBaseUrl, completeGoogle } from "@/lib/first-party-auth";
import { initClientSentry } from "@/lib/sentry";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";
import { startWebSession } from "./session-host";

export const startWeb = async () => {
  initClientSentry();
  const apiBaseUrl = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  const session = startWebSession(apiBaseUrl, authBaseUrl);
  setAuthSessionBridge(session.bridge);
  await session.initialize();
  await completeGoogle(globalThis.location.href).catch(() => false);

  mountApp({
    snapshot: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: hostAccess(),
    inventory: {
      apiBaseUrl,
      authenticatedFetch: session.bridge.apiFetch!,
      deviceId: session.bridge.deviceId!,
      openPowerSyncDatabase: async (databaseName: string) => {
        const { openWebInventoryPowerSync } = await import("@/lib/inventory-powersync.web");
        return openWebInventoryPowerSync(databaseName);
      },
    },
  });
};
