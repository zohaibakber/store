import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import { createHashHistory } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { bootstrapAuth } from "@/lib/auth";
import { completeGoogle, reportGoogleAuthError } from "@/lib/first-party-auth";
import type { InventoryHost, LegacyLocalInventorySnapshot } from "@/lib/inventory-host";

import { desktopHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

type InventoryHttpBridge = NonNullable<Window["inventoryHttp"]>;

const SQLiteBoolean = Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]);
const LegacyCategoryRow = Schema.Struct({
  ...CategoryRow.fields,
  tracksPacks: SQLiteBoolean,
});
const LegacyProductRow = Schema.Struct({
  ...ProductRow.fields,
  visible: SQLiteBoolean,
});
const LegacyLocalInventorySnapshotWire = Schema.Struct({
  categories: Schema.Array(LegacyCategoryRow),
  products: Schema.Array(LegacyProductRow),
  batches: Schema.Array(BatchRow),
  invoices: Schema.Array(InvoiceRow),
  invoiceItems: Schema.Array(InvoiceItemRow),
  stockMovements: Schema.Array(StockMovementRow),
});

const decodeSQLiteBoolean = (value: boolean | 0 | 1) => value === true || value === 1;

const loadLegacyLocalInventory = async (): Promise<LegacyLocalInventorySnapshot> => {
  const bridge = window.legacyLocalInventory;
  if (!bridge) {
    return {
      categories: [],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    };
  }
  const raw = Schema.decodeUnknownSync(LegacyLocalInventorySnapshotWire)(await bridge.load());
  return {
    categories: raw.categories.map((row) =>
      Schema.decodeUnknownSync(CategoryRow)({
        ...row,
        tracksPacks: decodeSQLiteBoolean(row.tracksPacks),
      }),
    ),
    products: raw.products.map((row) =>
      Schema.decodeUnknownSync(ProductRow)({
        ...row,
        visible: decodeSQLiteBoolean(row.visible),
      }),
    ),
    batches: raw.batches.map((row) => Schema.decodeUnknownSync(BatchRow)(row)),
    invoices: raw.invoices.map((row) => Schema.decodeUnknownSync(InvoiceRow)(row)),
    invoiceItems: raw.invoiceItems.map((row) => Schema.decodeUnknownSync(InvoiceItemRow)(row)),
    stockMovements: raw.stockMovements.map((row) =>
      Schema.decodeUnknownSync(StockMovementRow)(row),
    ),
  };
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
  const persistence = window.tanstackDbPersistence;
  if (!http || !persistence) return undefined;
  const config = await http.getConfig();
  return {
    apiBaseUrl: config.apiBaseUrl,
    authenticatedFetch: electronAuthenticatedFetch(http),
    deviceId: config.deviceId,
    openPersistence: async () => {
      const { openElectronInventoryPersistence } =
        await import("@/lib/inventory-persistence.electron");
      return openElectronInventoryPersistence();
    },
    loadLegacyLocalSnapshot: loadLegacyLocalInventory,
  };
};

export const startElectron = async () => {
  const inventory = await electronInventoryHost().catch(() => undefined);
  mountApp({
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    access: desktopHostAccess(),
    inventory,
  });
  window.auth?.onOAuthCallback((url) => {
    void completeGoogle(url).catch((cause) => {
      console.error("Google sign-in callback failed", cause);
      reportGoogleAuthError(cause);
    });
  });
};
