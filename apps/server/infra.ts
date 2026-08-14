import { makeAuth, makeEffectAuthConfig } from "@store/auth";
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
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { recoverUnexpected, ServerRoutes, ServerRuntime } from "./src";
import { invoiceAiClient } from "./src/ai/invoice-ai";
import { productScanAiClient } from "./src/ai/product-scan-ai";
import { absoluteAuthRequest } from "./src/auth/request-url";
import { reportAuthEvent, reportRejectedAuthSettings } from "./src/runtime/worker";
import { OrganizationStore, OrganizationStoreLive } from "./src/sync/organization-store";

export { OrganizationStore };

/**
 * Production's public hostname lives on the Website Worker (`apps/web/infra.ts`)
 * so packaged desktop builds and the browser SPA share one origin that survives
 * redeploys. Cloudflare provisions the DNS record and certificate; the zone is
 * inferred from the hostname and must already exist in the account.
 *
 * Other stages stay on their generated `workers.dev` URL — a custom domain per
 * stage would need one hostname each, and nothing depends on a preview URL
 * being stable. The API Worker itself is always `workers.dev`; `/api/*` is
 * proxied from the Website origin over a service binding.
 */
export const PRODUCTION_DOMAIN = "tabaaq.zohaibakber.com";
const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

/**
 * The API Worker, authentication, bindings, routes, and Durable Object clients
 * all stay in one Effect runtime. No framework or Promise adapter sits between
 * Alchemy and the HTTP API.
 */
export class Api extends Cloudflare.Worker<Api, {}, OrganizationStore>()("Api") {}

export const ApiLive = Api.make(
  Effect.succeed({
    main: import.meta.url,
    // Omitting `domain` leaves live attachments in place (Alchemy #942). The
    // hostname used to live here; `null` detaches it so the Website Worker can
    // take `tabaaq.zohaibakber.com`. This API Worker stays on workers.dev.
    domain: null,
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
    const authBaseURL = localDevelopment ? "http://localhost:8787" : `https://${PRODUCTION_DOMAIN}`;
    const authTrustedOrigins = localDevelopment
      ? [...trustedOrigins, ...LOCAL_WEB_ORIGINS]
      : trustedOrigins;
    const authConfig = makeEffectAuthConfig({
      audit: reportAuthEvent,
      // Better Auth requires a real absolute URL at construction. Production
      // always serves from the Website custom domain (SPA + `/api` proxy);
      // local alchemy dev is pinned to 8787. Preview stages still infer extra
      // origins from the incoming request via trustedOrigins.
      baseURL: authBaseURL,
      electronProtocol,
      mobileProtocol,
      secret: secretValue,
      trustedOrigins: authTrustedOrigins,
    });
    reportRejectedAuthSettings(authConfig.rejectedSettings);

    // Construct Better Auth the way this Worker did before the Alchemy
    // wrapper: D1 binding + `makeAuth` + `auth.handler`. That wrapper rebuilt
    // the instance per event through its own fetch/toWeb path, and every
    // `/api/auth/*` request started returning 500 after the switch.
    const runtimeAuth = Effect.gen(function* () {
      const database = yield* authD1.raw;
      return makeAuth({
        audit: reportAuthEvent,
        baseURL: authBaseURL,
        database,
        electronProtocol,
        mobileProtocol,
        secret: secretValue,
        trustedOrigins: authTrustedOrigins,
      });
    });

    const RuntimeLive = Layer.succeed(ServerRuntime, {
      electronProtocol,
      trustedOrigins: authConfig.trustedOrigins,
      authFetch: (request) =>
        Effect.gen(function* () {
          const auth = yield* runtimeAuth;
          const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
          const response = yield* Effect.promise(() =>
            auth.handler(absoluteAuthRequest(webRequest, authBaseURL)),
          );
          return HttpServerResponse.fromWeb(response);
        }),
      getSession: (headers) =>
        Effect.gen(function* () {
          const auth = yield* runtimeAuth;
          return yield* Effect.promise(() => auth.api.getSession({ headers }));
        }),
      hasActiveMember: (headers) =>
        Effect.gen(function* () {
          const auth = yield* runtimeAuth;
          const member = yield* Effect.promise(() => auth.api.getActiveMember({ headers }));
          return member !== null;
        }),
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
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(OrganizationStoreLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
