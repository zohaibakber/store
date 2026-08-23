import { snakeCamelMapper } from "@electric-sql/client";
import * as Schema from "effect/Schema";

import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";
import type {
  BatchRow as BatchRowType,
  CategoryRow as CategoryRowType,
  InvoiceItemRow as InvoiceItemRowType,
  InvoiceRow as InvoiceRowType,
  ProductRow as ProductRowType,
  StockMovementRow as StockMovementRowType,
} from "./rows";

export {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";

export interface InventoryCollectionConfigOptions {
  /** Server origin/base URL. `/api` is appended by this package. */
  readonly apiBaseUrl: string;
  /** Stable server-origin/organization scope included in every collection ID. */
  readonly scopeId: string;
  /** Raw bearer-authenticated fetch. Responses must not be JSON-decoded by the host. */
  readonly authenticatedFetch: typeof fetch;
}

/**
 * Version of the disposable local replica, independent from the authoritative
 * PostgreSQL schema. Bump when a persisted TanStack collection changes shape.
 */
export const INVENTORY_REPLICA_SCHEMA_VERSION = 1;

const fnv1a = (value: string) => {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * The replica belongs to an inventory source and organization, never a user.
 * Members of the same organization therefore reuse the same local catalog on
 * a device while separate API deployments remain isolated.
 */
const inventorySourceId = (apiBaseUrl: string) => {
  const normalized = apiBaseUrl.replace(/\/+$/u, "");
  try {
    return new URL(normalized).origin;
  } catch {
    // Native development hosts may be supplied without a URL scheme. They
    // still need a stable, isolated local replica rather than a startup crash.
    return normalized || "default";
  }
};

export const inventoryReplicaScope = (apiBaseUrl: string, organizationId: string) =>
  `${inventorySourceId(apiBaseUrl)}:${organizationId}`;

export const inventoryReplicaDatabaseName = (scopeId: string) =>
  `tanstack-inventory-${fnv1a(scopeId)}.sqlite`;

const apiRoot = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const parseInt8 = (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe PostgreSQL int8 value: ${value}`);
  return parsed;
};

const electricStreamOptions = (
  input: InventoryCollectionConfigOptions,
  table: "categories" | "products" | "batches" | "invoices" | "invoice_items" | "stock_movements",
) => ({
  url: `${apiRoot(input.apiBaseUrl)}/electric/${table}`,
  fetchClient: input.authenticatedFetch,
  columnMapper: snakeCamelMapper(),
  parser: { int8: parseInt8 },
});

export const createInventoryCollectionConfigs = (input: InventoryCollectionConfigOptions) => {
  const categories = {
    id: `${input.scopeId}:categories`,
    getKey: (category: CategoryRowType) => category.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "categories"),
      transformer: Schema.decodeUnknownSync(CategoryRow),
    },
    syncMode: "eager" as const,
    startSync: false,
  };
  const products = {
    id: `${input.scopeId}:products`,
    getKey: (product: ProductRowType) => product.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "products"),
      transformer: Schema.decodeUnknownSync(ProductRow),
    },
    syncMode: "progressive" as const,
    startSync: false,
  };
  const batches = {
    id: `${input.scopeId}:batches`,
    getKey: (batch: BatchRowType) => batch.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "batches"),
      transformer: Schema.decodeUnknownSync(BatchRow),
    },
    syncMode: "progressive" as const,
    startSync: false,
  };
  const stockMovements = {
    id: `${input.scopeId}:stock-movements`,
    getKey: (movement: StockMovementRowType) => movement.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "stock_movements"),
      transformer: Schema.decodeUnknownSync(StockMovementRow),
    },
    syncMode: "on-demand" as const,
    startSync: false,
  };

  const invoices = {
    id: `${input.scopeId}:invoices`,
    getKey: (invoice: InvoiceRowType) => invoice.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "invoices"),
      transformer: Schema.decodeUnknownSync(InvoiceRow),
    },
    syncMode: "progressive" as const,
    startSync: false,
  };
  const invoiceItems = {
    id: `${input.scopeId}:invoice-items`,
    getKey: (item: InvoiceItemRowType) => item.id,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Electric's public API names this required protocol field.
    shapeOptions: {
      ...electricStreamOptions(input, "invoice_items"),
      transformer: Schema.decodeUnknownSync(InvoiceItemRow),
    },
    syncMode: "progressive" as const,
    startSync: false,
  };

  return { categories, products, batches, invoices, invoiceItems, stockMovements };
};
