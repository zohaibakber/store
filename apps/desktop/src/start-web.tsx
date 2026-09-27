import { createBrowserHistory } from "@tanstack/react-router";

import { bootstrapAuth } from "@/lib/auth";
import { createWebInventoryHost } from "@/lib/inventory/host-web";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";

import { hostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startWeb = async () => {
  initClientSentry();
  let inventory: ReturnType<typeof createWebInventoryHost>;
  try {
    inventory = createWebInventoryHost();
  } catch (cause) {
    reportError(cause, { op: "web-inventory-host" });
    inventory = undefined;
  }
  mountApp({
    snapshot: await bootstrapAuth(),
    history: createBrowserHistory(),
    access: hostAccess(),
    inventory,
  });
};
