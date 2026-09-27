import { decodeJsonWebKeyText } from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  parseTrustedOrigins,
  resolveAuthSecurity,
} from "@store/auth/security";
import { stageUsesInventoryPostgres } from "@store/db/postgres/stage";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { invoiceAiClient, productScanAiClient } from "./src/ai/workers-ai";
import {
  authenticateHeaders,
  loadWorkspaceSnapshot,
  type AuthVerificationConfig,
} from "./src/auth/session";
import { recoverUnexpected, ServerRoutes } from "./src/http/app";
import { ServerRuntime } from "./src/http/runtime";
import { InventoryAuthorityLive, InventoryAuthorityUnavailable } from "./src/inventory/authority";
import { InventoryCommands } from "./src/inventory/commands";
import { InventoryLive } from "./src/inventory/live-tickets";
import { makePostgresSyncLiveUpgrade } from "./src/inventory/live-upgrade";
import { InventoryMaintenance, MAINTENANCE_POLICY } from "./src/inventory/maintenance";
import { InventorySnapshots } from "./src/inventory/snapshots";
import {
  makeInventorySyncAuthority,
  SyncAuthority,
  SyncLiveUpgrade,
  unavailableSyncLiveUpgrade,
} from "./src/inventory/sync-authority";
import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  productionSiteOrigin,
  requireProductionApiHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "./src/runtime/production-domain";

const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

export class Api extends Cloudflare.Worker<Api, {}>()("Api") {}

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const published = stage === "prod" || stage === "nightly";
    // Domain attachment is deploy-time only. This generator is also the Worker
    // entry (`main: import.meta.url`); `require*` reads `process.env`, which is
    // empty in workerd and 1101'd every request (including CORS preflight).
    const apiHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && published ? requireProductionApiHostname() : undefined;
    const worker = {
      main: import.meta.url,
      // Capped by the workerd that `alchemy dev` runs locally, not by Cloudflare:
      // alchemy's dev runtime pins workerd exactly, and that build refuses any
      // date past 2026-07-11. Raising this breaks `vp run dev` with a
      // WorkerdUserScript ConfigError while deploys keep working, so keep the two
      // in step. No compatibility flag gates between 07-11 and the 07-13 this
      // used to be, so nothing behavioural changed. Bump it when alchemy's
      // bundled workerd moves.
      compatibility: { date: "2026-07-11", flags: ["nodejs_compat", "enable_request_signal"] },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      dev: { port: 8787 },
    };
    return apiHostname ? { ...worker, domain: apiHostname } : worker;
  }),
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const authorityLayer = stageUsesInventoryPostgres(stage)
      ? InventoryAuthorityLive.pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding))
      : InventoryAuthorityUnavailable;
    const inventory = yield* Effect.all({
      commands: InventoryCommands,
      snapshots: InventorySnapshots,
      live: InventoryLive,
      maintenance: InventoryMaintenance,
    }).pipe(Effect.provide(authorityLayer));
    if (stageUsesInventoryPostgres(stage)) {
      yield* Cloudflare.Workers.cron(MAINTENANCE_POLICY.cronExpression, () =>
        inventory.maintenance.runScheduled().pipe(
          Effect.tap((progress) => Effect.log("inventory maintenance run", progress)),
          Effect.tapError((error) => Effect.logError("inventory maintenance failed", error)),
        ),
      );
    }
    const syncAuthority = makeInventorySyncAuthority(inventory);
    const syncLiveUpgrade = stageUsesInventoryPostgres(stage)
      ? makePostgresSyncLiveUpgrade(inventory.live)
      : unavailableSyncLiveUpgrade;
    const ai = yield* Cloudflare.Workers.AI();
    const invoiceExtractionRateLimit = yield* Cloudflare.RateLimit(
      "INVOICE_EXTRACTION_RATE_LIMIT",
      {
        namespaceId: 1002,
        simple: { limit: 10, period: 60 },
      },
    );
    const productScanRateLimit = yield* Cloudflare.RateLimit("PRODUCT_SCAN_RATE_LIMIT", {
      namespaceId: 1001,
      simple: { limit: 30, period: 60 },
    });
    // Alchemy binds every Config read during Worker Init onto Cloudflare.
    // GitHub Actions turns unset Environment vars into "", which would
    // otherwise beat Config.withDefault and ship a blank protocol/origin.
    const authPublicJwkText = yield* Config.String("AUTH_JWT_PUBLIC_JWK");
    const authBaseUrl = yield* Config.String("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const trustedOriginsRaw = yield* Config.String("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const trustedOrigins = parseTrustedOrigins(trustedOriginsRaw);
    const productionDomainEnv = {
      PRODUCTION_DOMAIN: yield* Config.String("PRODUCTION_DOMAIN").pipe(Config.withDefault("")),
      PRODUCTION_API_DOMAIN: yield* Config.String("PRODUCTION_API_DOMAIN").pipe(
        Config.withDefault(""),
      ),
      VITE_API_URL: yield* Config.String("VITE_API_URL").pipe(Config.withDefault("")),
      AUTH_TRUSTED_ORIGINS: trustedOriginsRaw,
    };
    const electronProtocol = yield* Config.String("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.String("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const published = stage === "prod" || stage === "nightly";
    const productionHostname = resolveProductionHostname(productionDomainEnv);
    const productionApiHostname = resolveProductionApiHostname(productionDomainEnv);
    // Hostname presence is a deploy-time check (CI already fails closed).
    // Dying here in the Worker turns a missing env into Cloudflare 1101 on
    // every request, which the browser reports as a CORS failure.
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
      productionAuthDomain.trim() ||
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
    const RuntimeLive = Layer.succeed(ServerRuntime, {
      electronProtocol: security.electronProtocol,
      trustedOrigins: security.trustedOrigins,
      getSession: (headers) => authenticateHeaders(headers, jwtConfig),
      loadWorkspace: (headers) => loadWorkspaceSnapshot(headers, jwtConfig),
      invoiceAi: ai.raw.pipe(Effect.map(invoiceAiClient)),
      limitInvoiceExtraction: (key) => invoiceExtractionRateLimit.limit({ key }),
      productScanAi: ai.raw.pipe(Effect.map(productScanAiClient)),
      limitProductScan: (key) => productScanRateLimit.limit({ key }),
    });
    const routes = ServerRoutes.pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(Layer.succeed(SyncAuthority, syncAuthority)),
      Layer.provide(Layer.succeed(SyncLiveUpgrade, syncLiveUpgrade)),
      Layer.provide(HttpServer.layerServices),
    );

    return {
      fetch: recoverUnexpected(Effect.scoped(Effect.flatten(HttpRouter.toHttpEffect(routes)))),
    };
  }).pipe(
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
