import { createBrowserHistory } from "@tanstack/react-router";

import { installAppHost } from "@/host";
import { bootstrapAuth } from "@/lib/auth";
import { authBaseUrl } from "@/lib/first-party-auth";
import {
  createWebCatalogLifetime,
  createWebInventoryHost,
  warmWebWorkspace,
} from "@/lib/inventory/host-web";
import { reportError } from "@/lib/report-error";
import { initWebSentry } from "@/lib/sentry-web";
import { apiBaseUrl } from "@/web/api-base-url";
import { createWebAppHost } from "@/web/app-host";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

const warmSignedInApp = () => {
  warmWebWorkspace();
  void import("@/components/app/shell").catch(() => undefined);
};

export const startWeb = async () => {
  initWebSentry();
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
  void web.sessionExpected().then((expected) => {
    if (expected) warmSignedInApp();
  });
  await web.initialize();
  mountApp({
    snapshot: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: hostAccess(),
    catalog: createWebCatalogLifetime(),
    inventory,
  });
};
