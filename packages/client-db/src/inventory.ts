export {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "./rows";

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
