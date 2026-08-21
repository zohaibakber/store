import { AuthSession, EmailAddress, OrganizationId, SessionId, UserId } from "@store/auth";
import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerRoutes } from "../../src/http/app";
import {
  ServerRuntime,
  type ServerRuntimeContract,
  type SyncLiveInput,
} from "../../src/http/runtime";

const session = AuthSession.make({
  user: {
    id: UserId.make("user-1"),
    name: "Member",
    email: EmailAddress.make("member@example.com"),
    image: null,
  },
  session: {
    id: SessionId.make("session-1"),
    userId: UserId.make("user-1"),
    activeOrganizationId: OrganizationId.make("org-1"),
    expiresAt: Date.now() + 60_000,
  },
  organizations: [
    {
      id: OrganizationId.make("org-1"),
      name: "Tabaaq",
      slug: "tabaaq",
      role: "owner",
    },
  ],
});

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });

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
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly connectSyncLive?: (
    input: SyncLiveInput,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

export const appFor = (member: boolean, authenticated = true, options: AppOptions = {}) => ({
  request: async (path: string, init?: RequestInit, invoiceAi = defaultInvoiceAi) => {
    const runtime = {
      electronProtocol: "com.tabaaq.desktop",
      trustedOrigins: options.trustedOrigins ?? ["http://localhost:5173", "http://localhost:5174"],
      getSession: () => Effect.succeed(authenticated ? session : null),
      hasActiveMember: () => Effect.succeed(member),
      loadWorkspace: () =>
        Effect.succeed(
          authenticated
            ? decodeAuthenticatedWorkspace({
                status: "authenticated",
                user: session.user,
                activeOrganization: {
                  id: "org-1",
                  name: "Tabaaq",
                  slug: "tabaaq",
                  role: "owner",
                },
                organizations: [
                  {
                    id: "org-1",
                    name: "Tabaaq",
                    slug: "tabaaq",
                    role: "owner",
                  },
                ],
                isOnline: true,
              })
            : unauthenticated,
        ),
      invoiceAi: Effect.succeed(invoiceAi),
      productScanAi: Effect.succeed(options.productScanAi ?? defaultProductScanAi),
      limitProductScan: () => Effect.succeed({ success: options.productScanAllowed ?? true }),
      runSync: (actor, request) =>
        Effect.succeed({
          protocolVersion: 2 as const,
          organizationId: actor.organizationId,
          cursor: request.cursor,
          nextCursor: request.cursor,
          headCursor: request.cursor,
          hasMore: false,
          acknowledgements: [],
          changes: [],
        }),
      connectSyncLive: (input) =>
        options.connectSyncLive
          ? options.connectSyncLive(input)
          : Effect.succeed(HttpServerResponse.empty()),
    } satisfies ServerRuntimeContract;
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
        testRuntimeContext,
      );
    } finally {
      await dispose();
    }
  },
});
