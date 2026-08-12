import type { SyncRequest } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import { authHeadersForRequest } from "../../src/auth/organization";
import type { SyncActor } from "../../src/sync/service";
import { appFor, requestFor, type SyncLiveConnector } from "../lib/app";

describe("sync authorization", () => {
  it("normalizes Expo's trusted native origin for Better Auth", () => {
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=session",
      "expo-origin": "com.tabaaq.mobile:///",
    });
    const authHeaders = authHeadersForRequest(requestHeaders);

    expect(authHeaders.get("origin")).toBe("com.tabaaq.mobile:///");
    expect(requestHeaders.get("origin")).toBeNull();
  });

  it("does not replace a browser-provided origin", () => {
    const authHeaders = authHeadersForRequest(
      new Headers({ origin: "https://tabaaq.zohaibakber.com", "expo-origin": "untrusted://" }),
    );

    expect(authHeaders.get("origin")).toBe("https://tabaaq.zohaibakber.com");
  });

  it("denies unauthenticated sync requests", async () => {
    const response = await appFor(false, false).request("/api/sync", {
      method: "POST",
      body: JSON.stringify(requestFor()),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(401);
  });

  it("denies sync requests after organization access is revoked", async () => {
    const response = await appFor(false).request("/api/sync", {
      method: "POST",
      body: JSON.stringify(requestFor()),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(403);
  });

  it("passes authoritative identity to the sync runner without returning credentials", async () => {
    const runner = vi.fn(async (actor: SyncActor, request: SyncRequest) => ({
      protocolVersion: 2 as const,
      organizationId: actor.organizationId,
      cursor: request.cursor,
      nextCursor: request.cursor,
      headCursor: request.cursor,
      hasMore: false,
      acknowledgements: [],
      changes: [],
    }));
    const response = await appFor(true, true, runner).request("/api/sync", {
      method: "POST",
      body: JSON.stringify(requestFor()),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organizationId: "org-1",
      cursor: 0,
      hasMore: false,
    });
    expect(runner).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      expect.objectContaining({ organizationId: "org-1", deviceId: "device-1" }),
    );
    const apiResponse = await appFor(true).request("/api");
    expect(JSON.stringify(await apiResponse.json())).not.toContain("authToken");
  });

  it("returns the Effect schema failure for an invalid sync request", async () => {
    const request = requestFor();
    const operation = request.operations[0];
    if (!operation) throw new Error("Expected a sync operation");
    const change = operation.changes[0];
    if (!change) throw new Error("Expected a sync change");

    const response = await appFor(true).request("/api/sync", {
      method: "POST",
      body: JSON.stringify({
        organizationId: request.organizationId,
        deviceId: request.deviceId,
        cursor: request.cursor,
        operations: [
          {
            operationId: operation.operationId,
            organizationId: operation.organizationId,
            deviceId: operation.deviceId,
            actorUserId: operation.actorUserId,
            clientSequence: operation.clientSequence,
            occurredAt: operation.occurredAt,
            payloadHash: operation.payloadHash,
            changes: Array.from({ length: 1_001 }, () => change),
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVALID_SYNC_REQUEST",
        message: expect.stringContaining(
          "operations[0].changes contains 1001 items; at most 1000 are allowed",
        ),
      },
    });
  });

  it("authorizes live upgrades and forwards only trusted workspace identity", async () => {
    const connect = vi.fn<SyncLiveConnector>(async () => new Response(null, { status: 204 }));
    const response = await appFor(true, true, undefined, connect).request(
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

  it("rejects live upgrades for a client-claimed organization", async () => {
    const response = await appFor(true).request(
      "/api/sync/live?organizationId=other-org&deviceId=device-1&protocolVersion=2",
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(403);
  });
});
