import { createBrowserHistory } from "@tanstack/react-router";

import { resolveBrowserApiBaseUrl } from "@/lib/api-base-url";
import { bootstrapAuth, setAuthSessionBridge } from "@/lib/auth";
import { authBaseUrl, completeGoogle } from "@/lib/first-party-auth";

import { startWebWorkspace } from "./host";
import { mountApp } from "./mount-app";

export const startWeb = async () => {
  const apiBaseUrl = resolveBrowserApiBaseUrl({
    configuredApiUrl: import.meta.env.VITE_API_URL ?? "",
    pageOrigin: globalThis.location.origin,
  });
  const { bridge, store } = await startWebWorkspace(apiBaseUrl, authBaseUrl);
  setAuthSessionBridge(bridge);
  await completeGoogle(globalThis.location.href).catch(() => false);
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createBrowserHistory(),
  });
};
