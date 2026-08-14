import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BetterAuth } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { makeEffectAuthConfig } from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  parseTrustedOrigins,
} from "@store/auth/security";
import { AuthDatabase } from "@store/db/auth/infra";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { recoverUnexpected, ServerRoutes, ServerRuntime } from "./src";
import { invoiceAiClient } from "./src/ai/invoice-ai";
import { productScanAiClient } from "./src/ai/product-scan-ai";
import { reportAuthEvent } from "./src/runtime/worker";
import { OrganizationStore, OrganizationStoreLive } from "./src/sync/organization-store";

export { OrganizationStore };

/**
 * Production serves from a stable hostname on the existing `zohaibakber.com`
 * zone, so packaged desktop builds have a URL that survives redeploys.
 * Cloudflare provisions the DNS record and certificate; the zone is inferred
 * from the hostname and must already exist in the account.
 *
 * Other stages stay on their generated `workers.dev` URL — a custom domain per
 * stage would need one hostname each, and nothing depends on dev's URL being
 * stable.
 */
const PRODUCTION_DOMAIN = "tabaaq.zohaibakber.com";
const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;
const webDist = fileURLToPath(new URL("../web/dist", import.meta.url));

/**
 * The API Worker, authentication, bindings, routes, and Durable Object clients
 * all stay in one Effect runtime. No framework or Promise adapter sits between
 * Alchemy and the HTTP API.
 */
export class Api extends Cloudflare.Worker<Api, {}, OrganizationStore>()("Api") {}

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;

    return {
      main: import.meta.url,
      // `worker.url` becomes the custom domain when one is set, so the stack's
      // `apiUrl` output is the right thing to feed a desktop release either way.
      ...(stage === "prod" ? { domain: PRODUCTION_DOMAIN } : {}),
      ...(existsSync(webDist)
        ? {
            assets: {
              directory: webDist,
              notFoundHandling: "single-page-application" as const,
              runWorkerFirst: ["/api", "/api/*"],
            },
          }
        : {}),
      // Capped by the workerd that `alchemy dev` runs locally, not by Cloudflare:
      // alchemy's dev runtime pins workerd exactly, and that build refuses any
      // date past 2026-07-11. Raising this breaks `vp run dev` with a
      // WorkerdUserScript ConfigError while deploys keep working, so keep the two
      // in step. No compatibility flag gates between 07-11 and the 07-13 this
      // used to be, so nothing behavioural changed. Bump it when alchemy's
      // bundled workerd moves.
      compatibility: { date: "2026-07-11", flags: ["nodejs_compat", "enable_request_signal"] },
      placement: { mode: "smart" },
      observability: { enabled: true },
      // The desktop falls back to http://localhost:8787 in development, so pin
      // the local dev port rather than taking alchemy's default of 1337.
      dev: { port: 8787 },
    };
  }),
  Effect.gen(function* () {
    const organizationStore = yield* OrganizationStore;
    const ai = yield* Cloudflare.Workers.AI();
    const productScanRateLimit = yield* Cloudflare.Workers.RateLimit("PRODUCT_SCAN_RATE_LIMIT", {
      namespaceId: 1001,
      simple: { limit: 30, period: 60 },
    });
    // Alchemy binds every Config read during Worker Init onto Cloudflare.
    // GitHub Actions turns unset Environment vars into "", which would
    // otherwise beat Config.withDefault and ship a blank protocol/origin.
    const secret = yield* Config.redacted("BETTER_AUTH_SECRET");
    const trustedOrigins = yield* Config.string("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
      Config.map(parseTrustedOrigins),
    );
    const electronProtocol = yield* Config.string("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.string("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const secretValue = Redacted.value(secret);
    const authConfig = makeEffectAuthConfig({
      audit: reportAuthEvent,
      // Better Auth requires a real absolute URL at construction. Production
      // always serves from the stable custom domain; local alchemy dev is
      // pinned to 8787. Preview stages still infer extra origins from the
      // incoming request via trustedOrigins.
      baseURL: localDevelopment ? "http://localhost:8787" : `https://${PRODUCTION_DOMAIN}`,
      electronProtocol,
      mobileProtocol,
      secret: secretValue,
      trustedOrigins: localDevelopment ? [...trustedOrigins, ...LOCAL_WEB_ORIGINS] : trustedOrigins,
    });
    const auth = yield* BetterAuth({
      ...authConfig.options,
      // AuthDatabase already owns the checked-in Drizzle migrations. The
      // Alchemy adapter supplies the D1 runtime binding without creating a
      // second migration authority.
      migrate: false,
      secret,
    });

    const RuntimeLive = Layer.succeed(ServerRuntime, {
      electronProtocol,
      trustedOrigins: authConfig.trustedOrigins,
      authFetch: (request) =>
        auth.fetch.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request)),
      getSession: (headers) => auth.getSession(headers),
      hasActiveMember: (headers) =>
        auth.api.getActiveMember({ headers }).pipe(Effect.map((member) => member !== null)),
      invoiceAi: ai.raw.pipe(Effect.map(invoiceAiClient)),
      productScanAi: ai.raw.pipe(Effect.map((binding) => productScanAiClient(binding))),
      limitProductScan: (key) => productScanRateLimit.limit({ key }),
      runSync: (actor, request) =>
        organizationStore.getByName(actor.organizationId).exchange(actor, request),
    });
    const routes = ServerRoutes.pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(HttpServer.layerServices),
    );

    return {
      fetch: recoverUnexpected(Effect.scoped(Effect.flatten(HttpRouter.toHttpEffect(routes)))),
    };
  }).pipe(
    Effect.provide(CloudflareD1(AuthDatabase)),
    Effect.provide(OrganizationStoreLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
