import type { AuthRateLimitRecord, AuthRateLimitStorage } from "@store/auth";

const minimumKvTtl = 60;

const parseRecord = (value: string | null): AuthRateLimitRecord | null => {
  if (!value) return null;
  try {
    const record: unknown = JSON.parse(value);
    if (
      typeof record !== "object" ||
      record === null ||
      typeof Reflect.get(record, "key") !== "string" ||
      typeof Reflect.get(record, "count") !== "number" ||
      typeof Reflect.get(record, "lastRequest") !== "number"
    ) {
      return null;
    }
    return record as AuthRateLimitRecord;
  } catch {
    return null;
  }
};

export const kvRateLimitStorage = (namespace: KVNamespace): AuthRateLimitStorage => ({
  get: async (key) => parseRecord(await namespace.get(key)),
  set: (key, value) => namespace.put(key, JSON.stringify(value), { expirationTtl: minimumKvTtl }),
});
