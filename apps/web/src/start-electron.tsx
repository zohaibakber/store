import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";
import { createAppCatalogLifetime } from "@store/inventory-react";
import { createHashHistory } from "@tanstack/react-router";

import { installAppHost } from "@/host";
import { electronAppHost } from "@/host/electron";
import { createElectronInventoryHost } from "@/lib/inventory/host-electron";
import { hostInventoryOf } from "@/lib/inventory/host-inventory";
import { reportError } from "@/lib/report-error";
import { WORKSPACE_SCOPE } from "@/lib/workspace";

import { mountApp } from "./mount-app";

export const startElectron = async () => {
  if (import.meta.env.VITE_SENTRY_DSN?.trim()) init({}, reactInit);
  installAppHost(electronAppHost(window));
  const inventory = await createElectronInventoryHost().catch((cause) => {
    reportError(cause, { op: "electron-inventory-host" });
    return undefined;
  });
  const catalog = createAppCatalogLifetime();
  catalog.claim(WORKSPACE_SCOPE);
  mountApp({
    history: createHashHistory(),
    catalog,
    inventory: hostInventoryOf(inventory),
  });
};
