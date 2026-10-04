import { init } from "@sentry/react";
import { createAppCatalogLifetime } from "@store/inventory-react";
import { createBrowserHistory } from "@tanstack/react-router";

import { installAppHost } from "@/host";
import { bootstrapAuth } from "@/lib/auth";
import { authBaseUrl } from "@/lib/first-party-auth";
import { NO_REPLICA } from "@/lib/inventory/host-inventory";
import { createWebAppHost } from "@/web/app-host";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

const apiBaseUrl = (import.meta.env.VITE_API_URL?.trim() || "http://localhost:8787").replace(
  /\/+$/u,
  "",
);

const initSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return;
  init({
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    release: `tabaaq-web@${__APP_VERSION__}`,
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "BrowserSession"),
  });
};

const warmSignedInApp = () => {
  void import("@/components/app/shell").catch(() => undefined);
};

export const startWeb = async () => {
  initSentry();
  const web = createWebAppHost({
    apiBaseUrl,
    authBaseUrl,
    location: window.location,
    history: window.history,
  });
  installAppHost(web.host);
  void web.sessionExpected().then((expected) => {
    if (expected) warmSignedInApp();
  });
  await web.initialize();
  mountApp({
    snapshot: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: hostAccess(),
    catalog: createAppCatalogLifetime(),
    inventory: NO_REPLICA,
  });
};
