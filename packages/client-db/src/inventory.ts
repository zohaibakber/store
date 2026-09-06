export {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";

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
  `powersync-inventory-${fnv1a(scopeId)}.sqlite`;
