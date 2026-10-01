import { decodeJsonWebKeyText, makeAccessTokenVerifier } from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  LOCAL_WEB_ORIGINS,
  parseTrustedOrigins,
  publicHostnameFrom,
  resolveAuthSecurity,
} from "@store/auth/security";
import { inventoryPlacement } from "@store/db/postgres/infra";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { Api, OrgHub } from "./api";
import { invoiceAiClient, productScanAiClient } from "./src/ai/workers-ai";
import {
  authenticateHeaders,
  loadWorkspaceSnapshot,
  type AuthVerificationConfig,
} from "./src/auth/session";
import {
  buildOncePerIsolate,
  recoverUnexpected,
  ServerRoutes,
  workerRuntimeServices,
} from "./src/http/app";
import { RATE_LIMITS, ServerRuntime } from "./src/http/runtime";
import { InventoryAuthorityLive } from "./src/inventory/authority";
import { InventoryCommands } from "./src/inventory/commands";
import { InventoryLive } from "./src/inventory/live-horizon";
import { InventoryMaintenance, MAINTENANCE_POLICY } from "./src/inventory/maintenance";
import { InventorySnapshots } from "./src/inventory/snapshots";
import { makeInventorySyncAuthority, SyncAuthority } from "./src/inventory/sync-authority";
import { LiveFanout, makeLiveFanout } from "./src/live/fanout";
import { OrgHubLive } from "./src/live/org-hub";
import { LiveRoutes } from "./src/live/route";
import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  productionDomainConfig,
  productionSiteOrigin,
  requireProductionApiHostname,
  requireProductionHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "./src/runtime/production-domain";

const ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE = "2026-07-11";

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const published = stage === "prod";
    const domains =
      !globalThis.__ALCHEMY_RUNTIME__ && published ? yield* productionDomainConfig : undefined;
    const worker = {
      main: import.meta.url,
      compatibility: {
        date: ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE,
        flags: ["nodejs_compat", "enable_request_signal"],
      },
      placement: inventoryPlacement(stage),
      observability: { enabled: true },
      dev: { port: 8787 },
    };
    if (domains === undefined) return worker;
    const siteHostname = requireProductionHostname(domains);
    return {
      ...worker,
      domain: requireProductionApiHostname(domains),
      routes: [{ pattern: `${siteHostname}/api/*`, zoneName: siteHostname }],
      workersDev: false,
    };
  }),
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const inventory = yield* Effect.all({
      commands: InventoryCommands,
      snapshots: InventorySnapshots,
      live: InventoryLive,
      maintenance: InventoryMaintenance,
    }).pipe(
      Effect.provide(
        InventoryAuthorityLive.pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding)),
      ),
    );
    yield* Cloudflare.Workers.cron(MAINTENANCE_POLICY.cronExpression, () =>
      inventory.maintenance.runScheduled().pipe(
        Effect.tap((progress) => Effect.log("inventory maintenance run", progress)),
        Effect.tapError((error) => Effect.logError("inventory maintenance failed", error)),
      ),
    );
    const syncAuthority = makeInventorySyncAuthority(inventory);
    const hubs = yield* OrgHub;
    const execution = yield* Cloudflare.WorkerExecutionContext;
    const liveFanout = makeLiveFanout(hubs, (effect) => execution.waitUntil(effect));
    const ai = yield* Cloudflare.Workers.AI();
    const invoiceExtractionRateLimit = yield* Cloudflare.RateLimit(
      "INVOICE_EXTRACTION_RATE_LIMIT",
      {
        namespaceId: 1002,
        simple: RATE_LIMITS.invoiceExtraction,
      },
    );
    const productScanRateLimit = yield* Cloudflare.RateLimit("PRODUCT_SCAN_RATE_LIMIT", {
      namespaceId: 1001,
      simple: RATE_LIMITS.productScan,
    });
    const authPublicJwkText = yield* Config.String("AUTH_JWT_PUBLIC_JWK");
    const authBaseUrl = yield* Config.String("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const productionDomainEnv = yield* productionDomainConfig;
    const trustedOrigins = parseTrustedOrigins(productionDomainEnv.AUTH_TRUSTED_ORIGINS);
    const electronProtocol = yield* Config.String("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.String("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const published = stage === "prod";
    const productionHostname = resolveProductionHostname(productionDomainEnv);
    const productionApiHostname = resolveProductionApiHostname(productionDomainEnv);
    if (!globalThis.__ALCHEMY_RUNTIME__ && !localDevelopment && published) {
      if (!productionHostname) {
        return yield* Effect.die(new Error(PRODUCTION_DOMAIN_MISSING_MESSAGE));
      }
      if (!productionApiHostname) {
        return yield* Effect.die(new Error(PRODUCTION_API_DOMAIN_MISSING_MESSAGE));
      }
    }
    const siteOrigin = productionSiteOrigin(productionDomainEnv);
    const authHostname =
      publicHostnameFrom(productionAuthDomain) ??
      (productionHostname ? `auth.${productionHostname}` : undefined);
    const authOrigin =
      authBaseUrl.trim() ||
      (localDevelopment || !authHostname ? "http://localhost:8788" : `https://${authHostname}`);
    const security = resolveAuthSecurity({
      baseURL: authOrigin,
      electronProtocol,
      mobileProtocol,
      trustedOrigins: [
        ...trustedOrigins,
        ...(siteOrigin ? [siteOrigin] : []),
        ...(localDevelopment ? LOCAL_WEB_ORIGINS : []),
      ],
    });
    yield* Effect.forEach(
      security.rejectedSettings,
      (setting) =>
        Effect.logError("auth.setting_rejected").pipe(
          Effect.annotateLogs({
            message: `${setting.setting} value "${setting.value}" ${setting.reason} and was ignored.`,
            setting: setting.setting,
            value: setting.value,
            reason: setting.reason,
          }),
        ),
      { discard: true },
    );
    const publicJwk = yield* decodeJsonWebKeyText(authPublicJwkText).pipe(Effect.orDie);
    const jwtConfig: AuthVerificationConfig = {
      issuer: security.baseURL,
      audience: "tabaaq-api",
      publicJwk,
    };
    const verifyAccessToken = yield* makeAccessTokenVerifier(jwtConfig);
    const RuntimeLive = Layer.succeed(ServerRuntime, {
      trustedOrigins: security.trustedOrigins,
      getSession: (headers) => authenticateHeaders(headers, verifyAccessToken),
      loadWorkspace: (headers) => loadWorkspaceSnapshot(headers, verifyAccessToken),
      invoiceAi: ai.raw.pipe(Effect.map(invoiceAiClient)),
      limitInvoiceExtraction: (key) => invoiceExtractionRateLimit.limit({ key }),
      productScanAi: ai.raw.pipe(Effect.map(productScanAiClient)),
      limitProductScan: (key) => productScanRateLimit.limit({ key }),
    });
    const routes = Layer.mergeAll(
      ServerRoutes,
      LiveRoutes({
        hubs,
        getSession: (headers) => authenticateHeaders(headers, verifyAccessToken),
        readLiveHorizon: inventory.live.readLiveHorizon,
      }),
    ).pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(Layer.succeed(SyncAuthority, syncAuthority)),
      Layer.provide(Layer.succeed(LiveFanout, liveFanout)),
      Layer.provide(HttpServer.layerServices),
    );

    const serveRequest = yield* buildOncePerIsolate(
      HttpRouter.toHttpEffect(routes),
      yield* workerRuntimeServices,
    );

    return {
      fetch: recoverUnexpected(serveRequest),
    };
  }).pipe(
    Effect.provide(OrgHubLive),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
