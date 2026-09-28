import { describe, expect, it } from "vitest";

import {
  MAX_INVENTORY_COMMAND_BODY_BYTES,
  assertInventoryRequestBodySize,
  makeReplicaSyncApiRequest,
  validatedInventoryUrl,
} from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";

describe("desktop inventory HTTP allowlist", () => {
  it("rejects the retired inventory mutation routes", () => {
    for (const path of ["mutations", "imports", "invoices"]) {
      expect(() =>
        validatedInventoryUrl(apiBaseUrl, {
          method: "POST",
          url: `https://api.tabaaq.app/api/inventory/${path}`,
        }),
      ).toThrow("The inventory request is outside the configured inventory API.");
    }
  });

  it("rejects retired credential fetches", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/powersync/credentials",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("allows the sync command and receipt routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/commands",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/commands");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/replicas",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/replicas");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/pull",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/pull");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/receipts/sale-a",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/receipts/sale-a");
  });

  it("allows snapshot routes and refuses the retired live proxy routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/snapshots",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1");
    for (const [method, url] of [
      ["POST", "https://api.tabaaq.app/api/sync/live-tickets"],
      ["GET", "https://api.tabaaq.app/api/sync/live?replicaId=replica-a&subscription=operational"],
      ["POST", "https://api.tabaaq.app/api/sync/live"],
    ] as const) {
      expect(() => validatedInventoryUrl(apiBaseUrl, { method, url })).toThrow(
        "The inventory request is outside the configured inventory API.",
      );
    }
  });

  it("rejects a path that would leak credentials", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it.each([
    "https://api.tabaaq.app/api/inventory/legacy-migrations",
    "https://api.tabaaq.app/api/inventory/legacy-migrations/job-123",
    "https://api.tabaaq.app/api/inventory/products",
  ])("rejects leftover or unknown inventory GET %s", (url) => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url,
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("rejects command bodies larger than 1 MiB", () => {
    expect(() =>
      assertInventoryRequestBodySize("x".repeat(MAX_INVENTORY_COMMAND_BODY_BYTES + 1)),
    ).toThrow("The inventory request body exceeds the 1 MiB limit.");
  });

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("forwards allowlisted worker sync requests through the authenticated fetch", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const syncApiRequest = makeReplicaSyncApiRequest(apiBaseUrl, async (url, init) => {
      requests.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    });
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
    await expect(syncApiRequest("/api/inventory/products")).rejects.toThrow(
      "The inventory request is outside the configured inventory API.",
    );
    expect(requests).toHaveLength(1);
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
