import { describe, expect, it } from "vitest";

import { makeReplicaSyncApiRequest } from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";
const outside = "The inventory request is outside the configured inventory API.";

const recordingSyncApi = () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const syncApiRequest = makeReplicaSyncApiRequest(apiBaseUrl, async (url, init) => {
    requests.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  });
  return { requests, syncApiRequest };
};

describe("desktop inventory HTTP allowlist", () => {
  it.each([
    ["POST", "/api/sync/commands"],
    ["POST", "/api/sync/replicas"],
    ["POST", "/api/sync/pull"],
    ["POST", "/api/sync/snapshots"],
    ["GET", "/api/sync/receipts/sale-a"],
    ["GET", "/api/sync/snapshots/snap-1/parts/1"],
  ] as const)("forwards %s %s", async (method, pathname) => {
    const { requests, syncApiRequest } = recordingSyncApi();
    await syncApiRequest(pathname, { method });
    expect(requests.map((request) => request.url)).toEqual([`${apiBaseUrl}${pathname}`]);
  });

  it.each([
    ["GET", "/api/sync/live?replicaId=replica-a&subscription=operational"],
    ["POST", "/api/sync/live"],
    ["GET", "/api/sync/pull"],
    ["GET", "/api/sync/receipts/a/b"],
    ["GET", "/api/sync/snapshots/snap-1/parts/0"],
    ["GET", "/v1/session/refresh"],
    ["POST", "/v1/session/refresh"],
    ["POST", "https://evil.example/api/sync/pull"],
    ["POST", "//evil.example/api/sync/pull"],
    ["POST", "https://user:pass@api.tabaaq.app/api/sync/pull"],
  ] as const)("refuses %s %s before any request", async (method, pathname) => {
    const { requests, syncApiRequest } = recordingSyncApi();
    await expect(syncApiRequest(pathname, { method })).rejects.toThrow(outside);
    expect(requests).toEqual([]);
  });

  it("refuses command bodies larger than 1 MiB", async () => {
    const { requests, syncApiRequest } = recordingSyncApi();
    await expect(
      syncApiRequest("/api/sync/commands", { method: "POST", body: "x".repeat(1_048_577) }),
    ).rejects.toThrow("The inventory request body exceeds the 1 MiB limit.");
    expect(requests).toEqual([]);
  });

  it("forwards a JSON command body with a live deadline", async () => {
    const { requests, syncApiRequest } = recordingSyncApi();
    await expect(
      syncApiRequest("/api/sync/commands", { method: "POST", body: "{}" }),
    ).resolves.toEqual({ ok: true, status: 200, bodyText: '{"ok":true}' });
    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/commands",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: expect.any(AbortSignal),
        },
      },
    ]);
    expect(requests[0]?.init.signal?.aborted).toBe(false);
  });

  it("returns the server's Retry-After header to the worker", async () => {
    const syncApiRequest = makeReplicaSyncApiRequest(
      apiBaseUrl,
      async () =>
        new Response('{"error":{"code":"SNAPSHOT_UNAVAILABLE","message":"building"}}', {
          status: 503,
          headers: { "retry-after": "12" },
        }),
    );
    await expect(
      syncApiRequest("/api/sync/snapshots", { method: "POST", body: "{}", timeoutMillis: 30_000 }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      bodyText: '{"error":{"code":"SNAPSHOT_UNAVAILABLE","message":"building"}}',
      retryAfter: "12",
    });
  });

  it("aborts the upstream request when the worker's deadline passes", async () => {
    const syncApiRequest = makeReplicaSyncApiRequest(
      apiBaseUrl,
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(
      syncApiRequest("/api/sync/pull", { method: "POST", body: "{}", timeoutMillis: 1 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
