import { describe, expect, test, vi } from "vitest";

import { kvSecondaryStorage } from "../../src/auth/kv-secondary-storage";

const makeNamespace = () => {
  const get = vi.fn(async () => null);
  const put = vi.fn(async () => undefined);
  const deleteKey = vi.fn(async () => undefined);
  const namespace = {
    get,
    put,
    delete: deleteKey,
  } as unknown as KVNamespace;

  return { namespace, get, put, deleteKey };
};

describe("kvSecondaryStorage", () => {
  test("delegates reads and deletes", async () => {
    const { namespace, get, deleteKey } = makeNamespace();
    const storage = kvSecondaryStorage(namespace);

    await storage.get("key");
    await storage.delete("key");

    expect(get).toHaveBeenCalledWith("key");
    expect(deleteKey).toHaveBeenCalledWith("key");
  });

  test("clamps expiration to Cloudflare KV's minimum TTL", async () => {
    const { namespace, put } = makeNamespace();
    const storage = kvSecondaryStorage(namespace);

    await storage.set("key", "value", 10);
    await storage.set("rounded", "value", 60.1);
    await storage.set("persistent", "value");

    expect(put).toHaveBeenNthCalledWith(1, "key", "value", { expirationTtl: 60 });
    expect(put).toHaveBeenNthCalledWith(2, "rounded", "value", { expirationTtl: 61 });
    expect(put).toHaveBeenNthCalledWith(3, "persistent", "value", undefined);
  });
});
