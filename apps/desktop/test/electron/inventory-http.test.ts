import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeReplicaSyncApiRequest } from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";
const outside = "The inventory request is outside the configured inventory API.";

const recordingSyncApi = () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const request = makeReplicaSyncApiRequest(apiBaseUrl, async (url, init) => {
    requests.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  });
  const syncApiRequest = (...input: Parameters<typeof request>) =>
    Effect.runPromise(request(...input));
  return { requests, syncApiRequest };
};

describe("desktop inventory HTTP allowlist", () => {
  it.each([
    ["GET", "/api/sync/live?replicaId=replica-a&subscription=operational"],
    ["POST", "/api/sync/live"],
    ["GET", "/api/sync/pull"],
    ["GET", "/api/sync/receipts/a/b"],
    ["GET", "/api/sync/snapshots/snap-1/parts/0"],
    ["GET", "/api/sync/imports/import-1/commit"],
    ["POST", "/api/sync/imports/import-1/parts/0"],
    ["POST", "/api/sync/imports/import-1/parts/1025"],
    ["POST", "/api/sync/imports/import-1/parts/1/extra"],
    ["POST", "/api/sync/imports/import-1/staged"],
    ["POST", "/api/sync/imports/commit"],
    ["POST", "/api/sync/imports/import-1/commit/again"],
    ["POST", "/api/sync/imports/import%2F1/parts/1"],
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
});
