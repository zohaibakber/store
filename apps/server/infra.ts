import { decodeJwtKeyRingText, makeAccessTokenVerifier } from "@store/auth";
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
import { searchGlobalProducts } from "@store/services";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Api, OrgHub } from "./api";
import { workersAiLanguageModel } from "./src/ai/language-model";
import { invoiceAiClient, productScanAiClient } from "./src/ai/workers-ai";
import { makeGlobalSearchCache } from "./src/global-search/cache";
import { PageImagesLive } from "./src/global-search/page-images";
import { cloudflareWebSearch } from "./src/global-search/web-search";
import { makeWorkerFetch } from "./src/http/app";
import { RATE_LIMITS } from "./src/http/runtime";
import { makeInventoryCommands } from "./src/inventory/commands";
import { makeInventoryDevices } from "./src/inventory/devices";
import { makeInventoryImports } from "./src/inventory/imports";
import { makeInventoryLive } from "./src/inventory/live-horizon";
import { MAINTENANCE_POLICY, makeInventoryMaintenance } from "./src/inventory/maintenance";
import { openInventoryDrizzle } from "./src/inventory/postgres";
import { makeInventorySnapshots } from "./src/inventory/snapshots";
import { makeLiveFanout } from "./src/live/fanout";
import { OrgHubLive } from "./src/live/org-hub";
import { buildOncePerIsolate, workerRuntimeServices } from "./src/runtime/isolate";
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
const GLOBAL_SEARCH_GATEWAY_CACHE_SECONDS = 7 * 24 * 60 * 60;

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
    const db = yield* openInventoryDrizzle.pipe(
      Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
    );
    const live = makeInventoryLive(db);
    const maintenance = makeInventoryMaintenance(db);
    yield* Cloudflare.Workers.cron(MAINTENANCE_POLICY.cronExpression, () =>
      maintenance.runScheduled().pipe(
        Effect.tap((progress) => Effect.log("inventory maintenance run", progress)),
        Effect.tapError((error) => Effect.logError("inventory maintenance failed", error)),
      ),
    );
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
    const globalSearchRateLimit = yield* Cloudflare.RateLimit("GLOBAL_SEARCH_RATE_LIMIT", {
      namespaceId: 1003,
      simple: RATE_LIMITS.globalSearch,
    });
    const globalSearchGateway = yield* Cloudflare.AI.Gateway("GlobalSearchGateway", {
      cacheTtl: GLOBAL_SEARCH_GATEWAY_CACHE_SECONDS,
      rateLimitingInterval: 60,
      rateLimitingLimit: 120,
      rateLimitingTechnique: "sliding",
      spendLimits: {
        enabled: true,
        rules: [{ limitType: "cost", limit: 100, window: "1 day" }],
      },
    });
    const aiGateway = yield* Cloudflare.AI.QueryGateway(globalSearchGateway);
    const globalSearchServices = yield* Effect.cached(
      Effect.uninterruptible(
        buildOncePerIsolate(
          Layer.build(
            Layer.mergeAll(
              cloudflareWebSearch(aiGateway),
              workersAiLanguageModel(aiGateway),
              PageImagesLive,
            ),
          ),
          yield* workerRuntimeServices,
        ),
      ),
    );
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
    const keys = yield* decodeJwtKeyRingText(authPublicJwkText).pipe(Effect.orDie);
    const verifyAccessToken = yield* makeAccessTokenVerifier({
      issuer: security.baseURL,
      audience: "tabaaq-api",
      keys,
    });
    const fetch = yield* makeWorkerFetch({
      runtime: {
        trustedOrigins: security.trustedOrigins,
        verifyAccessToken,
        invoiceAi: ai.raw.pipe(Effect.map(invoiceAiClient)),
        limitInvoiceExtraction: (key) => invoiceExtractionRateLimit.limit({ key }),
        productScanAi: ai.raw.pipe(Effect.map(productScanAiClient)),
        limitProductScan: (key) => productScanRateLimit.limit({ key }),
        globalSearchCache: makeGlobalSearchCache((effect) => execution.waitUntil(effect)),
        searchGlobalProducts: (query) =>
          Effect.flatMap(globalSearchServices, (services) =>
            Effect.provide(searchGlobalProducts(query), services),
          ),
        limitGlobalSearch: (key) => globalSearchRateLimit.limit({ key }),
      },
      commands: makeInventoryCommands(db),
      snapshots: makeInventorySnapshots(db),
      imports: makeInventoryImports(db),
      devices: makeInventoryDevices(db),
      readLiveHorizon: live.readLiveHorizon,
      hubs,
      liveFanout,
    });

    return { fetch };
  }).pipe(
    Effect.provide(OrgHubLive),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.AI.QueryGatewayBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
