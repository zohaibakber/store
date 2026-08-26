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
import { ServerRuntime, type ServerRuntimeContract } from "../../src/http/runtime";

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
  readonly powerSyncUrl?: string;
  readonly productScanAi?: ProductScanAiClient;
  readonly productScanAllowed?: boolean;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly connectSyncLive?: ServerRuntimeContract["connectSyncLive"];
  readonly writeInventoryMutation?: ServerRuntimeContract["writeInventoryMutation"];
  readonly importInventory?: ServerRuntimeContract["importInventory"];
  readonly issueInvoice?: ServerRuntimeContract["issueInvoice"];
  readonly startLegacyCatalogMigration?: ServerRuntimeContract["startLegacyCatalogMigration"];
  readonly getLegacyCatalogMigration?: ServerRuntimeContract["getLegacyCatalogMigration"];
  readonly migrateLegacyCatalogBatch?: ServerRuntimeContract["migrateLegacyCatalogBatch"];
  readonly reconcileLegacyCatalog?: ServerRuntimeContract["reconcileLegacyCatalog"];
}

/** Route test harness. Organization access follows the JWT session: no session means revoked. */
export const appFor = (authenticated = true, options: AppOptions = {}) => ({
  request: async (path: string, init?: RequestInit, invoiceAi = defaultInvoiceAi) => {
    const session = sessionFor(options.role ?? "owner");
    const role = options.role ?? "owner";
    const runtime = {
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
      powerSyncUrl: options.powerSyncUrl ?? "https://powersync.example",
      productScanAi: Effect.succeed(options.productScanAi ?? defaultProductScanAi),
      limitProductScan: () => Effect.succeed({ success: options.productScanAllowed ?? true }),
      connectSyncLive:
        options.connectSyncLive ??
        (() => Effect.succeed(HttpServerResponse.empty({ status: 101 }))),
      writeInventoryMutation: options.writeInventoryMutation ?? (() => Effect.succeed({ txid: 1 })),
      importInventory:
        options.importInventory ?? (() => Effect.die("Inventory import is not configured.")),
      issueInvoice:
        options.issueInvoice ?? (() => Effect.die("Invoice commands are not configured.")),
      startLegacyCatalogMigration:
        options.startLegacyCatalogMigration ??
        (() => Effect.die("Legacy catalog migration is not configured.")),
      getLegacyCatalogMigration:
        options.getLegacyCatalogMigration ??
        (() => Effect.die("Legacy catalog migration status is not configured.")),
      migrateLegacyCatalogBatch:
        options.migrateLegacyCatalogBatch ??
        (() => Effect.die("Legacy catalog batch migration is not configured.")),
      reconcileLegacyCatalog:
        options.reconcileLegacyCatalog ??
        (() => Effect.die("Legacy catalog reconciliation is not configured.")),
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
