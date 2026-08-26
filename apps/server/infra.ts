import { decodeJsonWebKey } from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  parseTrustedOrigins,
  resolveAuthSecurity,
} from "@store/auth/security";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { recoverUnexpected, ServerRoutes, ServerRuntime } from "./src";
import { invoiceAiClient } from "./src/ai/invoice-ai";
import { productScanAiClient } from "./src/ai/product-scan-ai";
import {
  authenticateHeaders,
  loadWorkspaceSnapshot,
  type AuthVerificationConfig,
} from "./src/auth/session";
import {
  LEGACY_MIGRATION_QUEUE_MAX_ATTEMPTS,
  LegacyMigrationJobProcessingError,
  type LegacyMigrationJobStore,
  LegacyMigrationQueueError,
  LegacyMigrationQueueMessage,
  processLegacyMigrationJob,
  terminalMigrationFailure,
} from "./src/electric/legacy-migration-worker";
import {
  ElectricMutationDatabase,
  ElectricMutationDatabaseLive,
} from "./src/electric/mutation-database";
import type { InventoryDatabaseError, InventoryProtocolError } from "./src/inventory/errors";
import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  productionSiteOrigin,
  requireProductionApiHostname,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "./src/runtime/production-domain";
import { reportError, reportRejectedAuthSettings } from "./src/runtime/worker";
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

const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

/**
 * `ORGANIZATION_STORE` is the deployed Durable Object identity that owns
 * legacy production inventory. Do not rename or remove this binding until an
 * export/backfill has completed and the copied data has been verified.
 */
export class Api extends Cloudflare.Worker<Api, {}, OrganizationStore>()("Api") {}
export const LegacyMigrationQueue = Cloudflare.Queues.Queue("LegacyMigrationQueue");

export const ApiLive = Api.make(
  Effect.gen(function* () {
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
    };
    return apiHostname ? { ...worker, domain: apiHostname } : worker;
  }),
  Effect.gen(function* () {
    const organizationStore = yield* OrganizationStore;
    const electricMutations = yield* ElectricMutationDatabase;
    const migrationQueueResource = yield* LegacyMigrationQueue;
    const migrationQueue = yield* Cloudflare.Queues.WriteQueue(migrationQueueResource);
    const migrationJobs: LegacyMigrationJobStore = {
      claim: electricMutations.legacyMigrationJobs.claim,
      migrateBatch: electricMutations.migrateLegacyCatalog,
      reconcile: electricMutations.reconcileLegacyCatalog,
      updateProgress: electricMutations.legacyMigrationJobs.updateProgress,
      succeed: electricMutations.legacyMigrationJobs.succeed,
      fail: electricMutations.legacyMigrationJobs.fail,
    };
    yield* Cloudflare.Queues.consumeQueueMessages(
      migrationQueueResource,
      {
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: LEGACY_MIGRATION_QUEUE_MAX_ATTEMPTS,
        maxWaitTime: "1 second",
        retryDelay: "15 seconds",
      },
      (stream) =>
        Stream.runForEach(stream, (message) =>
          Schema.decodeUnknownEffect(LegacyMigrationQueueMessage)(message.body).pipe(
            Effect.flatMap((body) => {
              const handleFailure = (
                error:
                  | InventoryDatabaseError
                  | InventoryProtocolError
                  | LegacyMigrationJobProcessingError,
              ) => {
                reportError("legacy_migration.queue_attempt_failed", error);
                return message.attempts >= LEGACY_MIGRATION_QUEUE_MAX_ATTEMPTS
                  ? terminalMigrationFailure(migrationJobs, body)(error)
                  : Effect.fail(error);
              };
              return processLegacyMigrationJob(migrationJobs, body, message.attempts).pipe(
                Effect.flatMap((outcome) =>
                  outcome.kind === "continue"
                    ? migrationQueue.send(body, { contentType: "json" }).pipe(
                        Effect.asVoid,
                        Effect.mapError(() =>
                          LegacyMigrationQueueError.make({
                            message: "Migration could not be continued. It will retry shortly.",
                          }),
                        ),
                      )
                    : Effect.void,
                ),
                Effect.catchTags({
                  InventoryDatabaseError: handleFailure,
                  InventoryProtocolError: handleFailure,
                  LegacyMigrationJobProcessingError: handleFailure,
                  LegacyMigrationQueueError: (error) => Effect.fail(error),
                }),
              );
            }),
          ),
        ),
    );
    const ai = yield* Cloudflare.Workers.AI();
    const productScanRateLimit = yield* Cloudflare.Workers.RateLimit("PRODUCT_SCAN_RATE_LIMIT", {
      namespaceId: 1001,
      simple: { limit: 30, period: 60 },
    });
    // Alchemy binds every Config read during Worker Init onto Cloudflare.
    // GitHub Actions turns unset Environment vars into "", which would
    // otherwise beat Config.withDefault and ship a blank protocol/origin.
    const authPublicJwkText = yield* Config.string("AUTH_JWT_PUBLIC_JWK");
    const authBaseUrl = yield* Config.string("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.string("PRODUCTION_AUTH_DOMAIN").pipe(
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
    const powerSyncUrl = yield* Config.string("POWERSYNC_URL").pipe(Config.withDefault(""));
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
    reportRejectedAuthSettings(security.rejectedSettings);
    const publicJwk = yield* Effect.try({
      try: () => JSON.parse(authPublicJwkText),
      catch: (cause) => new Error(`AUTH_JWT_PUBLIC_JWK is invalid JSON: ${String(cause)}`),
    }).pipe(Effect.flatMap(decodeJsonWebKey), Effect.orDie);
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
      powerSyncUrl: powerSyncUrl.trim().replace(/\/+$/u, ""),
      productScanAi: ai.raw.pipe(Effect.map((binding) => productScanAiClient(binding))),
      limitProductScan: (key) => productScanRateLimit.limit({ key }),
      // Kept only for already-deployed clients during the migration window.
      // New web, mobile, and desktop clients use Postgres through PowerSync.
      connectSyncLive: (input) => connectWithOrganizationStore(organizationStore, input),
      writeElectricMutation: electricMutations.write,
      importInventory: electricMutations.importInventory,
      issueInvoice: electricMutations.issueInvoice,
      startLegacyCatalogMigration: (actor, request) =>
        electricMutations.legacyMigrationJobs.start(actor, request).pipe(
          Effect.tap(({ jobId }) =>
            migrationQueue
              .send(
                {
                  jobId,
                  organizationId: actor.organizationId,
                } satisfies LegacyMigrationQueueMessage,
                { contentType: "json" },
              )
              .pipe(
                Effect.tapError(() =>
                  electricMutations.legacyMigrationJobs
                    .fail({
                      jobId,
                      organizationId: actor.organizationId,
                      error: "Migration could not be queued. Reopen the app to try again.",
                    })
                    .pipe(Effect.ignore),
                ),
                Effect.mapError(() =>
                  LegacyMigrationQueueError.make({
                    message: "Migration could not be queued. Try again shortly.",
                  }),
                ),
              ),
          ),
        ),
      getLegacyCatalogMigration: electricMutations.legacyMigrationJobs.getStatus,
    });
    const routes = ServerRoutes.pipe(
      Layer.provide(RuntimeLive),
      Layer.provide(HttpServer.layerServices),
    );

    return {
      fetch: recoverUnexpected(Effect.scoped(Effect.flatten(HttpRouter.toHttpEffect(routes)))),
    };
  }).pipe(
    Effect.provide(OrganizationStoreLive),
    Effect.provide(ElectricMutationDatabaseLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
    Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
    Effect.provide(Cloudflare.Queues.WriteQueueBinding),
    Effect.provide(Cloudflare.Queues.EventSourceLive),
  ),
);

export default ApiLive;
