import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { apiOrigin, authClient, nativeAuthHeaders } from "@/lib/auth-client";

type SyncChange = {
  cursor: number;
  change: {
    entity: "category" | "product" | "batch" | string;
    action: "upsert" | "delete";
    entityId: string;
    row: unknown;
  };
};

type SyncResponse = {
  nextCursor: number;
  hasMore: boolean;
  changes: ReadonlyArray<SyncChange>;
};

type ProductRow = {
  id: string;
  name: string;
  categoryId: string;
  composition: string | null;
  strength: string | null;
  aisle: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitPrice: number | null;
  visible: boolean;
};

type CategoryRow = { id: string; name: string; tracksPacks: boolean };
type BatchRow = {
  id: string;
  productId: string;
  packQuantity: number;
  unitQuantity: number;
};

export type MobileProduct = {
  id: string;
  name: string;
  category: string;
  details: string;
  aisle: string | null;
  stock: number;
  stockLabel: string;
  unitPrice: number | null;
  visible: boolean;
};

const asRow = <T>(value: unknown): T | null =>
  typeof value === "object" && value !== null ? (value as T) : null;

const deviceId = async () => {
  const key = "tabaaq-device-id";
  const stored = await SecureStore.getItemAsync(key);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(key, created);
  return created;
};

const activeOrganizationId = async () => {
  const listed = await authClient.organization.list();
  if (listed.error) throw listed.error;
  const organization = listed.data?.[0];
  if (!organization) return null;
  const selected = await authClient.organization.setActive({ organizationId: organization.id });
  if (selected.error) throw selected.error;
  return organization.id;
};

const requestPage = async (organizationId: string, id: string, cursor: number) => {
  const response = await fetch(`${apiOrigin}/api/sync`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      ...nativeAuthHeaders(),
    },
    body: JSON.stringify({
      protocolVersion: 2,
      organizationId,
      deviceId: id,
      clientPlatform: "mobile",
      clientVersion: "0.1.0",
      cursor,
      operations: [],
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | (SyncResponse & { error?: { message?: string } })
    | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `Sync failed (${response.status}).`);
  return payload as SyncResponse;
};

export const loadProducts = async (): Promise<ReadonlyArray<MobileProduct>> => {
  const organizationId = await activeOrganizationId();
  if (!organizationId) return [];

  const id = await deviceId();
  const categories = new Map<string, CategoryRow>();
  const products = new Map<string, ProductRow>();
  const batches = new Map<string, BatchRow>();
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await requestPage(organizationId, id, cursor);
    for (const serverChange of page.changes) {
      const { change } = serverChange;
      const target =
        change.entity === "category"
          ? categories
          : change.entity === "product"
            ? products
            : change.entity === "batch"
              ? batches
              : null;
      if (!target) continue;
      if (change.action === "delete") target.delete(change.entityId);
      else {
        const row = asRow<CategoryRow & ProductRow & BatchRow>(change.row);
        if (row) target.set(change.entityId, row);
      }
    }
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }

  const batchesByProduct = new Map<string, Array<BatchRow>>();
  for (const batch of batches.values()) {
    const rows = batchesByProduct.get(batch.productId) ?? [];
    rows.push(batch);
    batchesByProduct.set(batch.productId, rows);
  }

  return [...products.values()]
    .map((product) => {
      const category = categories.get(product.categoryId);
      const stock = (batchesByProduct.get(product.id) ?? []).reduce(
        (total, batch) => total + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
        0,
      );
      const details = [product.composition, product.strength].filter(Boolean).join(" · ");
      return {
        id: product.id,
        name: product.name,
        category: category?.name ?? "Uncategorized",
        details,
        aisle: product.aisle,
        stock,
        stockLabel: `${stock} ${stock === 1 ? "unit" : "units"}`,
        unitPrice: product.unitPrice,
        visible: product.visible,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const formatPrice = (paisa: number | null) => {
  if (paisa === null) return "—";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: paisa % 100 === 0 ? 0 : 2,
  }).format(paisa / 100);
};
