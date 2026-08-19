import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  parseTrustedOrigins,
  resolveAuthSecurity,
} from "@store/auth/security";
import { AuthDatabase } from "@store/db/auth/infra";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { recoverUnexpected, ServerRoutes, ServerRuntime } from "./src";
import { invoiceAiClient } from "./src/ai/invoice-ai";
import { productScanAiClient } from "./src/ai/product-scan-ai";
import { d1FromEnv, isD1Database } from "./src/auth/d1";
import { authenticateHeaders, loadWorkspaceSnapshot } from "./src/auth/session";
import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  productionApiOrigin,
  productionSiteOrigin,
  requireProductionApiHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "./src/runtime/production-domain";
import { reportRejectedAuthSettings } from "./src/runtime/worker";
import {
  OrganizationStore,
  OrganizationStoreLive,
  connectWithOrganizationStore,
} from "./src/sync/organization-store";

export { OrganizationStore };
export {
  requireProductionApiHostname,
  requireProductionHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "./src/runtime/production-domain";

/**
 * Production attaches two hostnames on the zone inferred from
 * `PRODUCTION_DOMAIN`: the Website Worker on the apex, the API Worker on
 * `api.<domain>` (or `PRODUCTION_API_DOMAIN` / `VITE_API_URL`). Cloudflare
 * provisions DNS and certificates. Neither hostname is baked into source.
 * Other stages stay on generated `workers.dev` URLs. Locally, the Website
 * Worker still proxies `/api/*` so `vp run dev` stays same-origin.
 */
const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

/**
 * The API Worker, authentication, bindings, routes, and Durable Object clients
 * all stay in one Effect runtime. No framework or Promise adapter sits between
 * Alchemy and the HTTP API.
 *
 * `ORGANIZATION_STORE` Durable Object names are the store organization ids
 * (legacy Better Auth org ids when a Clerk org has been bound). Do not rename
 * the class or switch `getByName` to Clerk org ids. That would orphan existing
 * sqlite.
 */
export class Api extends Cloudflare.Worker<Api, {}, OrganizationStore>()("Api") {}

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const authDatabase = yield* AuthDatabase;
    const { stage } = yield* Alchemy.Stack;
    // Domain attachment is deploy-time only. This generator is also the Worker
    // entry (`main: import.meta.url`); `require*` reads `process.env`, which is
    // empty in workerd and 1101'd every request (including CORS preflight).
    const apiHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && stage === "prod"
        ? requireProductionApiHostname()
        : undefined;
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
      // The desktop falls back to http://localhost:8787 in development, so pin
      // the local dev port rather than taking alchemy's default of 1337.
      dev: { port: 8787 },
      // Binding D1 as both `AUTH_DB` (Hono-era fetch env) and `AuthDatabase`
      // (QueryDatabase LogicalId) so clerk_org_binding lookups find it either way.
      env: {
        AUTH_DB: authDatabase,
        AuthDatabase: authDatabase,
      },
    };
    // Apex stays on the Website Worker. This Worker claims `api.<domain>` in
    // prod; omitting `domain` on other stages leaves workers.dev in place.
    return apiHostname ? { ...worker, domain: apiHostname } : worker;
  }),
  Effect.gen(function* () {
    const organizationStore = yield* OrganizationStore;
    const ai = yield* Cloudflare.Workers.AI();
    const productScanRateLimit = yield* Cloudflare.Workers.RateLimit("PRODUCT_SCAN_RATE_LIMIT", {
      namespaceId: 1001,
      simple: { limit: 30, period: 60 },
    });
    const authDatabase = yield* AuthDatabase;
    const authD1 = yield* Cloudflare.D1.QueryDatabase(authDatabase);
    // Alchemy binds every Config read during Worker Init onto Cloudflare.
    // GitHub Actions turns unset Environment vars into "", which would
    // otherwise beat Config.withDefault and ship a blank protocol/origin.
    const clerkSecretKey = yield* Config.redacted("CLERK_SECRET_KEY");
    const clerkJwtKey = yield* Config.string("CLERK_JWT_KEY").pipe(Config.withDefault(""));
    const clerkJwtAudience = yield* Config.string("CLERK_JWT_AUDIENCE").pipe(
      Config.withDefault(""),
    );
    const trustedOriginsRaw = yield* Config.string("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const trustedOrigins = parseTrustedOrigins(trustedOriginsRaw);
    const productionDomainEnv = {
      PRODUCTION_DOMAIN: yield* Config.string("PRODUCTION_DOMAIN").pipe(Config.withDefault("")),
      PRODUCTION_API_DOMAIN: yield* Config.string("PRODUCTION_API_DOMAIN").pipe(
        Config.withDefault(""),
      ),
      VITE_API_URL: yield* Config.string("VITE_API_URL").pipe(Config.withDefault("")),
      AUTH_TRUSTED_ORIGINS: trustedOriginsRaw,
    };
    const electronProtocol = yield* Config.string("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.string("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const { stage } = yield* Alchemy.Stack;
    const productionHostname = resolveProductionHostname(productionDomainEnv);
    const productionApiHostname = resolveProductionApiHostname(productionDomainEnv);
    // Hostname presence is a deploy-time check (CI already fails closed).
    // Dying here in the Worker turns a missing env into Cloudflare 1101 on
    // every request, which the browser reports as a CORS failure.
    if (!globalThis.__ALCHEMY_RUNTIME__ && !localDevelopment && stage === "prod") {
      if (!productionHostname) {
        return yield* Effect.die(new Error(PRODUCTION_DOMAIN_MISSING_MESSAGE));
      }
      if (!productionApiHostname) {
        return yield* Effect.die(new Error(PRODUCTION_API_DOMAIN_MISSING_MESSAGE));
      }
    }
    const siteOrigin = productionSiteOrigin(productionDomainEnv);
    const apiOrigin = productionApiOrigin(productionDomainEnv);
    const security = resolveAuthSecurity({
      baseURL: localDevelopment || !apiOrigin ? "http://localhost:8787" : apiOrigin,
      electronProtocol,
      mobileProtocol,
      trustedOrigins: [
        ...trustedOrigins,
        ...(siteOrigin ? [siteOrigin] : []),
        ...(localDevelopment ? LOCAL_WEB_ORIGINS : []),
      ],
    });
    reportRejectedAuthSettings(security.rejectedSettings);
    const baseClerkConfig = {
      secretKey: Redacted.value(clerkSecretKey),
      authorizedParties: [...security.trustedOrigins],
    };
    const keyClerkConfig = fallbackIfBlank(clerkJwtKey, "")
      ? { ...baseClerkConfig, jwtKey: clerkJwtKey.trim() }
      : baseClerkConfig;
    const clerkConfig = fallbackIfBlank(clerkJwtAudience, "")
      ? { ...keyClerkConfig, jwtAudience: clerkJwtAudience.trim() }
      : keyClerkConfig;

    const liveAuthDatabase = Effect.gen(function* () {
      const workerEnv = yield* Effect.serviceOption(Cloudflare.Workers.WorkerEnvironment);
      // Static `import { env } from "cloudflare:workers"` crashes Node during
      // `alchemy deploy`. Load it only inside a request, where workerd has it.
      const moduleEnv = yield* Effect.promise(() =>
        import("cloudflare:workers").then((mod) => mod.env).catch(() => undefined),
      );
      const fromQuery = yield* authD1.raw;
      const database =
        d1FromEnv(Option.getOrUndefined(workerEnv)) ??
        d1FromEnv(moduleEnv) ??
        (isD1Database(fromQuery) ? fromQuery : undefined);
      if (!database) {
        return yield* Effect.die(
          new Error("Auth D1 binding is missing (tried AuthDatabase and AUTH_DB)."),
        );
      }
      return database;
    });

    const RuntimeLive = Layer.succeed(ServerRuntime, {
      electronProtocol: security.electronProtocol,
      trustedOrigins: security.trustedOrigins,
      getSession: (headers) =>
        liveAuthDatabase.pipe(
          Effect.flatMap((database) =>
            authenticateHeaders(headers, { config: clerkConfig, database }),
          ),
        ),
      hasActiveMember: (headers) =>
        liveAuthDatabase.pipe(
          Effect.flatMap((database) =>
            authenticateHeaders(headers, { config: clerkConfig, database }),
          ),
          Effect.map((session) => session?.session.activeOrganizationId != null),
        ),
      loadWorkspace: (headers) =>
        liveAuthDatabase.pipe(
          Effect.flatMap((database) =>
            loadWorkspaceSnapshot(headers, { config: clerkConfig, database }),
          ),
        ),
      invoiceAi: ai.raw.pipe(Effect.map(invoiceAiClient)),
      productScanAi: ai.raw.pipe(Effect.map((binding) => productScanAiClient(binding))),
      limitProductScan: (key) => productScanRateLimit.limit({ key }),
      runSync: (actor, request) =>
        organizationStore.getByName(actor.organizationId).exchange(actor, request),
      connectSyncLive: (input) => connectWithOrganizationStore(organizationStore, input),
    });
    const routes = ServerRoutes.pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(HttpServer.layerServices),
    );

    return {
      fetch: recoverUnexpected(Effect.scoped(Effect.flatten(HttpRouter.toHttpEffect(routes)))),
    };
  }).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(OrganizationStoreLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
