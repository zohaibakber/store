import { init } from "@sentry/electron/renderer";
import { init as reactInit } from "@sentry/react";
import { createAppCatalogLifetime } from "@store/inventory-react";
import { createHashHistory } from "@tanstack/react-router";

import { installAppHost } from "@/host";
import { electronAppHost } from "@/host/electron";
import { bootstrapAuth } from "@/lib/auth";
import { createElectronInventoryHost } from "@/lib/inventory/host-electron";
import { browserStorage } from "@/lib/preferences";
import { reportError } from "@/lib/report-error";
import { deviceWorkspaceStore } from "@/session/device-workspace";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  if (import.meta.env.VITE_SENTRY_DSN?.trim()) init({}, reactInit);
  installAppHost(electronAppHost(window));
  const device = deviceWorkspaceStore(browserStorage());
  const [inventory, snapshot] = await Promise.all([
    createElectronInventoryHost().catch((cause) => {
      reportError(cause, { op: "electron-inventory-host" });
      return undefined;
    }),
    bootstrapAuth(),
  ]);
  mountApp({
    snapshot,
    history: createHashHistory(),
    access: hostAccess({ localWorkspace: device }),
    catalog: createAppCatalogLifetime(),
    inventory,
    device,
  });
};
