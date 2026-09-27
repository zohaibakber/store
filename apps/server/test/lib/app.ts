import { AuthSession, EmailAddress, OrganizationId, SessionId, UserId } from "@store/auth";
import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { buildOncePerIsolate, recoverUnexpected, ServerRoutes } from "../../src/http/app";
import { ServerRuntime, type ServerRuntimeContract } from "../../src/http/runtime";
import {
  SyncAuthority,
  SyncLiveUpgrade,
  unprovisionedSyncAuthority,
  unprovisionedSyncLiveUpgrade,
  type SyncAuthorityContract,
  type SyncLiveUpgradeContract,
} from "../../src/inventory/sync-authority";

const sessionFor = (role: "owner" | "admin" | "member") =>
  AuthSession.make({
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
        role,
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
  readonly role?: "owner" | "admin" | "member";
  readonly limitInvoiceExtraction?: ServerRuntimeContract["limitInvoiceExtraction"];
  readonly productScanAi?: ProductScanAiClient;
  readonly productScanAllowed?: boolean;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly syncAuthority?: SyncAuthorityContract;
  readonly syncLiveUpgrade?: SyncLiveUpgradeContract;
}

const runtimeFor = (
  authenticated: boolean,
  options: AppOptions,
  invoiceAi: InvoiceAiClient,
): ServerRuntimeContract => {
  const session = sessionFor(options.role ?? "owner");
  const role = options.role ?? "owner";
  return {
    electronProtocol: "com.tabaaq.desktop",
    trustedOrigins: options.trustedOrigins ?? ["http://localhost:5173", "http://localhost:5174"],
    getSession: () => Effect.succeed(authenticated ? session : null),
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
                role,
              },
              organizations: [
                {
                  id: "org-1",
                  name: "Tabaaq",
                  slug: "tabaaq",
                  role,
                },
              ],
              isOnline: true,
            })
          : unauthenticated,
      ),
    invoiceAi: Effect.succeed(invoiceAi),
    limitInvoiceExtraction:
      options.limitInvoiceExtraction ?? (() => Effect.succeed({ success: true })),
    productScanAi: Effect.succeed(options.productScanAi ?? defaultProductScanAi),
    limitProductScan: () => Effect.succeed({ success: options.productScanAllowed ?? true }),
  };
};

export const workerHandlerFor = async (
  authenticated = true,
  options: AppOptions = {},
  invoiceAi = defaultInvoiceAi,
) => {
  const app = ServerRoutes.pipe(
    Layer.provide(Layer.succeed(ServerRuntime, runtimeFor(authenticated, options, invoiceAi))),
    Layer.provide(
      Layer.succeed(SyncAuthority, options.syncAuthority ?? unprovisionedSyncAuthority),
    ),
    Layer.provide(
      Layer.succeed(SyncLiveUpgrade, options.syncLiveUpgrade ?? unprovisionedSyncLiveUpgrade),
    ),
    Layer.provide(HttpServer.layerServices),
  );
  const serveRequest = await Effect.runPromise(
    buildOncePerIsolate(HttpRouter.toHttpEffect(app), testRuntimeContext),
  );
  const handler = HttpEffect.toWebHandler(
    recoverUnexpected(serveRequest).pipe(Effect.provideContext(testRuntimeContext)),
  );
  return (path: string, init?: RequestInit) =>
    handler(new Request(new URL(path, "http://localhost"), init));
};

export const appFor = (authenticated = true, options: AppOptions = {}) => ({
  request: async (path: string, init?: RequestInit, invoiceAi = defaultInvoiceAi) => {
    const serve = await workerHandlerFor(authenticated, options, invoiceAi);
    return await serve(path, init);
  },
});
