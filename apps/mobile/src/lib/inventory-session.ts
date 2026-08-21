import * as Schema from "effect/Schema";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

import { fetchWorkspaceSession } from "@/lib/auth-client";
import type { StoredInventoryContext } from "@/lib/inventory-types";
import { isLocalUserId } from "@/lib/local-session";

const INVENTORY_CONTEXT_KEY = "tabaaq-product-context-v1";

export const createInventoryEntityId = () => Crypto.randomUUID();

export const persistentDeviceId = async () => {
  const key = "tabaaq-device-id";
  const stored = await SecureStore.getItemAsync(key);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(key, created);
  return created;
};

const readInventoryContext = async (userId: string): Promise<StoredInventoryContext | null> => {
  const serialized = await Storage.getItem(INVENTORY_CONTEXT_KEY);
  if (!serialized) return null;
  try {
    // SAFETY: Every required field is checked before this value is returned.
    const value = JSON.parse(serialized) as Partial<StoredInventoryContext>;
    if (
      value.version !== 1 ||
      value.userId !== userId ||
      !Schema.is(Schema.String)(value.organizationId) ||
      !value.organizationId
    ) {
      return null;
    }
    // SAFETY: Version, user, and non-empty organization fields were validated above.
    return value as StoredInventoryContext;
  } catch {
    return null;
  }
};

const persistInventoryContext = (userId: string, organizationId: string) =>
  Storage.setItem(
    INVENTORY_CONTEXT_KEY,
    JSON.stringify({ version: 1, userId, organizationId } satisfies StoredInventoryContext),
  );

const organizationIdFromLocalContext = async (userId: string) => {
  const localContext = await readInventoryContext(userId);
  return localContext?.organizationId ?? null;
};

const ensureLocalOrganizationId = async (userId: string) => {
  const existing = await organizationIdFromLocalContext(userId);
  if (existing) return existing;
  const organizationId = `local-org:${Crypto.randomUUID()}`;
  await persistInventoryContext(userId, organizationId);
  return organizationId;
};

/** Resolve the organization bound to this user (local cache, local-only mint, or session). */
export const resolveOrganizationId = async (userId: string): Promise<string> => {
  const localOrganizationId = await organizationIdFromLocalContext(userId);
  if (localOrganizationId) return localOrganizationId;
  if (isLocalUserId(userId)) return ensureLocalOrganizationId(userId);

  try {
    const session = await fetchWorkspaceSession();
    const cached = await organizationIdFromLocalContext(userId);
    if (cached) return cached;

    const organization = session.activeOrganization ?? session.organizations[0];
    if (!organization) throw new Error("Create or join a store before using inventory.");
    await persistInventoryContext(userId, organization.id);
    return organization.id;
  } catch (cause) {
    const fallback = await organizationIdFromLocalContext(userId);
    if (fallback) return fallback;
    throw cause;
  }
};
