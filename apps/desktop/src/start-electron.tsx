import { createHashHistory } from "@tanstack/react-router";

import { electronAppHost } from "@/electron-host";
import { installAppHost } from "@/host";
import { bootstrapAuth } from "@/lib/auth";
import { createElectronInventoryHost } from "@/lib/inventory/host-electron";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  initClientSentry();
  installAppHost(electronAppHost(window));
  const inventory = await createElectronInventoryHost().catch((cause) => {
    reportError(cause, { op: "electron-inventory-host" });
    return undefined;
  });
  mountApp({
    snapshot: await bootstrapAuth(),
    history: createHashHistory(),
    access: hostAccess(),
    inventory,
  });
};
