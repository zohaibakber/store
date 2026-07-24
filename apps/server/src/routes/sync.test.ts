import type { SyncRequest } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import type { SyncActor } from "../sync/service";
import { appFor, requestFor } from "../testing/app";

describe("sync authorization", () => {
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
      organizationId: actor.organizationId,
      cursor: request.cursor,
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
});
