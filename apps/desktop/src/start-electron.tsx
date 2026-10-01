import { createHashHistory } from "@tanstack/react-router";

import { electronAppHost } from "@/electron-host";
import { installAppHost } from "@/host";
import { bootstrapAuth } from "@/lib/auth";
import { createElectronInventoryHost } from "@/lib/inventory/host-electron";
import { browserStorage } from "@/lib/preferences";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";
import { deviceWorkspaceStore } from "@/session/device-workspace";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  initClientSentry();
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
    inventory,
    device,
  });
};
