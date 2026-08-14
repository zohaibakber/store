import type { SyncEntityChange, SyncRequest } from "@store/contracts";
import { operationPayloadHash } from "@store/contracts/operation-hash";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import { vi } from "vitest";

import { ServerRoutes } from "../../src/http/app";
import { ServerRuntime, type ServerRuntimeShape } from "../../src/http/runtime";
import type { SyncActor } from "../../src/sync/model";

const session = {
  user: {
    id: "user-1",
    name: "Member",
    email: "member@example.com",
    image: null,
  },
  session: {
    id: "session-1",
    userId: "user-1",
    activeOrganizationId: "org-1",
    clerkOrganizationId: "org_clerk_1",
  },
  organizations: [
    {
      id: "org-1",
      clerkOrganizationId: "org_clerk_1",
      name: "Org",
      slug: "org",
      role: "member",
    },
  ],
};

const defaultInvoiceAi: InvoiceAiClient = {
  toMarkdown: async () => [],
  generate: async () => ({ supplier: null, invoiceNumber: null, lines: [] }),
};

const defaultProductScanAi: ProductScanAiClient = {
  generate: async () => ({
    name: null,
    composition: null,
    strength: null,
    unitsPerPack: null,
    batchNumber: null,
    expiresAt: null,
    confidence: 0,
  }),
};

const testRuntimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "server-route-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

export interface AppOptions {
  readonly productScanAi?: ProductScanAiClient;
  readonly productScanAllowed?: boolean;
}

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
  options: AppOptions = {},
) => ({
  request: async (path: string, init?: RequestInit, invoiceAi = defaultInvoiceAi) => {
    const runtime = {
      electronProtocol: "com.tabaaq.desktop",
      trustedOrigins: ["http://localhost:5173"],
      getSession: () => Effect.succeed(authenticated ? session : null),
      hasActiveMember: () => Effect.succeed(member),
      loadWorkspace: () =>
        Effect.succeed(
          authenticated
            ? {
                status: "authenticated" as const,
                user: session.user,
                activeOrganization: {
                  id: "org-1",
                  name: "Org",
                  slug: "org",
                  role: "member",
                  clerkOrganizationId: "org_clerk_1",
                },
                organizations: [
                  {
                    id: "org-1",
                    name: "Org",
                    slug: "org",
                    role: "member",
                    clerkOrganizationId: "org_clerk_1",
                  },
                ],
                isOnline: true,
              }
            : {
                status: "unauthenticated" as const,
                user: null,
                activeOrganization: null,
                organizations: [],
                isOnline: true,
              },
        ),
      invoiceAi: Effect.succeed(invoiceAi),
      productScanAi: Effect.succeed(options.productScanAi ?? defaultProductScanAi),
      limitProductScan: () => Effect.succeed({ success: options.productScanAllowed ?? true }),
      runSync: (actor, request) => Effect.promise(() => runSync(actor, request)),
    } satisfies ServerRuntimeShape;
    const RuntimeLive = Layer.succeed(ServerRuntime, runtime);
    const app = ServerRoutes.pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(Layer.succeed(RuntimeContext, Context.get(testRuntimeContext, RuntimeContext))),
    );
    const { dispose, handler } = HttpRouter.toWebHandler(app, { disableLogger: true });
    try {
      return await handler(
        new Request(new URL(path, "http://localhost"), init),
        Context.add(testRuntimeContext, ServerRuntime, runtime),
      );
    } finally {
      await dispose();
    }
  },
});
