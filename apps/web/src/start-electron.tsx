import { createHashHistory } from "@tanstack/react-router";

import { bootstrapAuth } from "@/lib/auth";
import { completeGoogle, reportGoogleAuthError } from "@/lib/first-party-auth";
import type { InventoryHost, LegacyLocalInventorySnapshot } from "@/lib/inventory-host";
import { decodeLegacyLocalInventorySnapshot } from "@/lib/legacy-local-snapshot";
import { reportError } from "@/lib/report-error";
import { initClientSentry } from "@/lib/sentry";

import { desktopHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

type InventoryHttpBridge = NonNullable<Window["inventoryHttp"]>;

const emptyLegacySnapshot = (): LegacyLocalInventorySnapshot => ({
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
});

const loadLegacyLocalInventory = async (): Promise<LegacyLocalInventorySnapshot> => {
  const bridge = window.legacyLocalInventory;
  if (!bridge) return emptyLegacySnapshot();
  return decodeLegacyLocalInventorySnapshot(await bridge.load(), (cause) => {
    reportError(cause, { op: "legacy-locked-replica-decode" });
  });
};

const aborted = (signal: AbortSignal) => {
  if (signal.reason) throw signal.reason;
  throw new DOMException("The inventory request was aborted.", "AbortError");
};

const electronAuthenticatedFetch =
  (bridge: InventoryHttpBridge): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET" && request.method !== "POST") {
      throw new Error(`Unsupported inventory request method: ${request.method}`);
    }
    if (request.signal.aborted) aborted(request.signal);

    const requestId = crypto.randomUUID();
    const abort = () => bridge.abort(requestId);
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await bridge.request({
        requestId,
        url: request.url,
        method: request.method,
        headers: [...request.headers.entries()],
        body: request.method === "POST" ? await request.arrayBuffer() : null,
      });
      if (request.signal.aborted) aborted(request.signal);
      return new Response(response.body.byteLength === 0 ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers.map(([name, value]): [string, string] => [name, value]),
      });
    } catch (cause) {
      if (request.signal.aborted) aborted(request.signal);
      throw cause;
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  };

const electronInventoryHost = async (): Promise<InventoryHost | undefined> => {
  const http = window.inventoryHttp;
  if (!http) return undefined;
  const config = await http.getConfig();
  return {
    apiBaseUrl: config.apiBaseUrl,
    authenticatedFetch: electronAuthenticatedFetch(http),
    deviceId: config.deviceId,
    openPowerSyncDatabase: async (databaseName: string) => {
      const { openWebInventoryPowerSync } = await import("@/lib/inventory-powersync.web");
      return openWebInventoryPowerSync(databaseName);
    },
    loadLegacyLocalSnapshot: loadLegacyLocalInventory,
  };
};

export const startElectron = async () => {
  initClientSentry();
  const inventory = await electronInventoryHost().catch((cause) => {
    reportError(cause, { op: "electron-inventory-host" });
    return undefined;
  });
  mountApp({
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    access: desktopHostAccess(),
    inventory,
  });
  window.auth?.onOAuthCallback((url) => {
    void completeGoogle(url).catch((cause) => {
      reportError(cause, { op: "google-sign-in-callback" });
      reportGoogleAuthError(cause);
    });
  });
};
