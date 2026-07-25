import type { AuthSecondaryStorage } from "@store/auth";

const minimumKvTtl = 60;

export const kvSecondaryStorage = (namespace: KVNamespace): AuthSecondaryStorage => ({
  get: (key) => namespace.get(key),
  set: (key, value, ttl) =>
    namespace.put(
      key,
      value,
      ttl === undefined ? undefined : { expirationTtl: Math.max(minimumKvTtl, Math.ceil(ttl)) },
    ),
  delete: (key) => namespace.delete(key),
});
