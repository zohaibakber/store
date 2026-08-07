import type { SyncEntityChange, SyncRequest } from "@store/contracts";
import { operationPayloadHash } from "@store/contracts/operation-hash";
import { vi } from "vitest";

import { createApp } from "../../src/http/app";
import type { SyncLiveConnector } from "../../src/http/context";
import { factory } from "../../src/http/factory";
import type { SyncActor } from "../../src/sync/service";

const session = {
  user: {
    id: "user-1",
    name: "Member",
    email: "member@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: "session-1",
    token: "secret",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    activeOrganizationId: "org-1",
  },
};

export const requestFor = (): SyncRequest => {
  const operation = {
    operationId: "operation-1",
    organizationId: "org-1",
    deviceId: "device-1",
    actorUserId: "user-1",
    clientSequence: 1,
    occurredAt: 1_750_000_000_000,
    payloadHash: "",
    changes: [
      {
        entity: "category",
        action: "upsert",
        entityId: "general",
        rowVersion: 1,
        row: { id: "general", name: "General" },
      },
    ] satisfies ReadonlyArray<SyncEntityChange>,
  };
  return {
    protocolVersion: 2,
    organizationId: "org-1",
    deviceId: "device-1",
    cursor: 0,
    operations: [{ ...operation, payloadHash: operationPayloadHash(operation) }],
  };
};

export const appFor = (
  member: boolean,
  authenticated = true,
  runSync = vi.fn(async (actor: SyncActor, request: SyncRequest) => ({
    protocolVersion: 2 as const,
    organizationId: actor.organizationId,
    cursor: request.cursor,
    nextCursor: request.cursor,
    headCursor: request.cursor,
    hasMore: false,
    acknowledgements: [],
    changes: [],
  })),
  connectSyncLive: SyncLiveConnector = async () =>
    new Response("WebSocket upgrades are unavailable in this test", { status: 501 }),
) => {
  const runtime = factory.createMiddleware(async (c, next) => {
    c.set("authApi", {
      getSession: async () => (authenticated ? session : null),
      getActiveMember: async () => (member ? { id: "member-1" } : null),
    });
    c.set("authHandler", async () => new Response(null, { status: 404 }));
    c.set("runSync", runSync);
    c.set("connectSyncLive", connectSyncLive);
    c.set("trustedOrigins", ["http://localhost:5173"]);
    await next();
  });
  return createApp(runtime);
};
