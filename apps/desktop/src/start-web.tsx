import { createBrowserHistory } from "@tanstack/react-router";

import { installAppHost } from "@/host";
import { bootstrapAuth } from "@/lib/auth";
import { authBaseUrl } from "@/lib/first-party-auth";
import { createWebInventoryHost } from "@/lib/inventory/host-web";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";
import { apiBaseUrl } from "@/web/api-base-url";
import { createWebAppHost } from "@/web/app-host";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startWeb = async () => {
  initClientSentry();
  const web = createWebAppHost({
    apiBaseUrl,
    authBaseUrl,
    location: window.location,
    history: window.history,
  });
  installAppHost(web.host);
  let inventory: ReturnType<typeof createWebInventoryHost> | undefined;
  try {
    inventory = createWebInventoryHost({
      apiBaseUrl,
      authenticatedFetch: web.authenticatedFetch,
      liveAccessToken: web.liveAccessToken,
    });
  } catch (cause) {
    reportError(cause, { op: "web-inventory-host" });
    inventory = undefined;
  }
  await web.initialize();
  mountApp({
    snapshot: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: hostAccess(),
    inventory,
  });
};
