import { describe, expect, test, vi } from "vitest";

import { kvRateLimitStorage } from "../../src/auth/kv-rate-limit-storage";

const makeNamespace = (stored: string | null = null) => {
  const get = vi.fn(async () => stored);
  const put = vi.fn(async () => undefined);
  const namespace = {
    get,
    put,
  } as unknown as KVNamespace;

  return { namespace, get, put };
};

describe("kvRateLimitStorage", () => {
  test("reads rate-limit records", async () => {
    const record = { key: "key", count: 2, lastRequest: 100 };
    const { namespace, get } = makeNamespace(JSON.stringify(record));
    const storage = kvRateLimitStorage(namespace);

    await expect(storage.get("key")).resolves.toEqual(record);

    expect(get).toHaveBeenCalledWith("key");
  });

  test("stores rate-limit records with Cloudflare KV's minimum TTL", async () => {
    const { namespace, put } = makeNamespace();
    const storage = kvRateLimitStorage(namespace);
    const record = { key: "key", count: 1, lastRequest: 100 };

    await storage.set("key", record);

    expect(put).toHaveBeenCalledWith("key", JSON.stringify(record), { expirationTtl: 60 });
  });

  test("ignores malformed records", async () => {
    const { namespace } = makeNamespace('{"count":"invalid"}');
    const storage = kvRateLimitStorage(namespace);

    await expect(storage.get("key")).resolves.toBeNull();
  });
});
