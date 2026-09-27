import { createHashHistory } from "@tanstack/react-router";

import { bootstrapAuth } from "@/lib/auth";
import { completeGoogle, reportGoogleAuthError } from "@/lib/first-party-auth";
import { createElectronInventoryHost } from "@/lib/inventory/host-electron";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  initClientSentry();
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
  window.auth?.onOAuthCallback((url) => {
    void completeGoogle(url).catch((cause) => {
      reportError(cause, { op: "google-sign-in-callback" });
      reportGoogleAuthError(cause);
    });
  });
};
