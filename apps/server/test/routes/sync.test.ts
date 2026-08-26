import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it, vi } from "vitest";

import { authHeadersForRequest } from "../../src/auth/organization";
import type { SyncLiveInput } from "../../src/http/runtime";
import { appFor } from "../lib/app";

/** Compat until retirement: Durable Object / `/api/sync/live` WebSocket engine. */
describe("sync authorization", () => {
  it("normalizes Expo's trusted native origin", () => {
    const requestHeaders = new Headers({
      authorization: "Bearer token",
      "expo-origin": "com.tabaaq.mobile:///",
    });
    const authHeaders = authHeadersForRequest(requestHeaders);

    expect(authHeaders.get("origin")).toBe("com.tabaaq.mobile:///");
    expect(requestHeaders.get("origin")).toBeNull();
  });

  it("does not replace a browser-provided origin", () => {
    const authHeaders = authHeadersForRequest(
      new Headers({ origin: "https://app.example", "expo-origin": "untrusted://" }),
    );

    expect(authHeaders.get("origin")).toBe("https://app.example");
  });

  it("forwards a verified Electron origin when Origin is missing", () => {
    const authHeaders = authHeadersForRequest(
      new Headers({
        authorization: "Bearer token",
        "electron-origin": "com.tabaaq.desktop://app",
      }),
    );

    expect(authHeaders.get("origin")).toBe("com.tabaaq.desktop://app");
  });

  it("replaces Electron's opaque null Origin with electron-origin", () => {
    const authHeaders = authHeadersForRequest(
      new Headers({
        origin: "null",
        "electron-origin": "com.tabaaq.desktop://app",
      }),
    );

    expect(authHeaders.get("origin")).toBe("com.tabaaq.desktop://app");
  });

  it("denies unauthenticated live upgrades", async () => {
    const response = await appFor(false).request(
      "/api/sync/live?organizationId=org-1&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(401);
  });

  it("denies live upgrades when the session was revoked with organization access", async () => {
    // Membership removal invalidates the session; there is no separate member ping.
    const response = await appFor(false).request(
      "/api/sync/live?organizationId=org-1&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(401);
  });

  it("authorizes live upgrades and forwards only trusted workspace identity", async () => {
    const connect = vi.fn((_input: SyncLiveInput) => Effect.succeed(HttpServerResponse.empty()));
    const response = await appFor(true, { connectSyncLive: connect }).request(
      "/api/sync/live?organizationId=org-1&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket" } },
    );

    expect(response.status).toBe(204);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        deviceId: "device-1",
        authenticationExpiresAt: expect.any(Number),
      }),
    );
    expect(JSON.stringify(connect.mock.calls[0]?.[0])).not.toContain("secret");
  });

  it("does not attach CORS headers to WebSocket upgrades", async () => {
    const connect = vi.fn((_input: SyncLiveInput) => Effect.succeed(HttpServerResponse.empty()));
    const response = await appFor(true, { connectSyncLive: connect }).request(
      "/api/sync/live?organizationId=org-1&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket", origin: "http://localhost:5173" } },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects live upgrades for a client-claimed organization", async () => {
    const response = await appFor(true).request(
      "/api/sync/live?organizationId=other-org&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(403);
  });

  it("requires a WebSocket upgrade for the live route", async () => {
    const response = await appFor(true).request(
      "/api/sync/live?organizationId=org-1&deviceId=device-1&protocolVersion=2",
    );
    expect(response.status).toBe(426);
  });
});
