import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useState } from "react";

const LAST_USER_KEY = "tabaaq-last-user-v1";
const INVENTORY_CONTEXT_KEY = "tabaaq-product-context-v1";
const InventoryContextUser = Schema.Struct({
  userId: Schema.String,
});

let rememberedUserId: string | null | undefined;
const listeners = new Set<(userId: string | null) => void>();

const publish = (userId: string | null) => {
  rememberedUserId = userId;
  for (const listener of listeners) listener(userId);
};

const userIdFromInventoryContext = async () => {
  const serialized = await Storage.getItem(INVENTORY_CONTEXT_KEY);
  if (!serialized) return null;
  try {
    const parsed = Schema.decodeUnknownOption(InventoryContextUser)(JSON.parse(serialized));
    const userId = Option.getOrNull(parsed)?.userId.trim() ?? "";
    return userId || null;
  } catch {
    return null;
  }
};

const lastUserIdReady = (async () => {
  try {
    const stored = await Storage.getItem(LAST_USER_KEY);
    if (stored !== null) {
      const userId = stored.trim() ? stored : null;
      publish(userId);
      return userId;
    }
    const fromInventory = await userIdFromInventoryContext();
    if (fromInventory) await Storage.setItem(LAST_USER_KEY, fromInventory);
    publish(fromInventory);
    return fromInventory;
  } catch {
    publish(null);
    return null;
  }
})();

export const peekLastUserId = async (): Promise<string | null> => {
  if (rememberedUserId !== undefined) return rememberedUserId;
  return lastUserIdReady;
};

export const rememberLastUserId = async (userId: string) => {
  publish(userId);
  await Storage.setItem(LAST_USER_KEY, userId);
};

export const forgetLastUserId = async () => {
  publish(null);
  await Storage.setItem(LAST_USER_KEY, "");
};

export function useLastUserId() {
  const [userId, setUserId] = useState<string | null | undefined>(rememberedUserId);

  useEffect(() => {
    if (rememberedUserId !== undefined) {
      setUserId(rememberedUserId);
      return;
    }
    const listener = (next: string | null) => setUserId(next);
    listeners.add(listener);
    void lastUserIdReady;
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return userId;
}
