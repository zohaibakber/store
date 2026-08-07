import { AuthDatabase } from "@store/db/auth/infra";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import type { OrganizationStore } from "./src/sync/organization-store";

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

/**
 * The API Worker. This is a plain async (non-Effect) Worker: `main` points at
 * the existing Hono application and every binding is declared on `env`, so the
 * runtime under `src/` is untouched by the move off wrangler.
 */
export const Api = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const authDb = yield* AuthDatabase;

  return yield* Cloudflare.Worker("Api", {
    main: new URL("./src/index.ts", import.meta.url).href,
    // `worker.url` becomes the custom domain when one is set, so the stack's
    // `apiUrl` output is the right thing to feed a desktop release either way.
    ...(stage === "prod" ? { domain: PRODUCTION_DOMAIN } : {}),
    // Capped by the workerd that `alchemy dev` runs locally, not by Cloudflare:
    // alchemy's dev runtime pins workerd exactly, and that build refuses any
    // date past 2026-07-11. Raising this breaks `vp run dev` with a
    // WorkerdUserScript ConfigError while deploys keep working, so keep the two
    // in step. No compatibility flag gates between 07-11 and the 07-13 this
    // used to be, so nothing behavioural changed. Bump it when alchemy's
    // bundled workerd moves.
    compatibility: { date: "2026-07-11", flags: ["nodejs_compat"] },
    placement: { mode: "smart" },
    observability: { enabled: true },
    // The desktop falls back to http://localhost:8787 in development, so pin
    // the local dev port rather than taking alchemy's default of 1337.
    dev: { port: 8787 },
    env: {
      AUTH_DB: authDb,
      AI: Cloudflare.Workers.AI(),
      // One Durable Object per organization, each with its own SQLite database.
      // The class name must match the export from `src/index.ts`.
      ORGANIZATION_STORE: Cloudflare.DurableObject<OrganizationStore>("ORGANIZATION_STORE", {
        className: "OrganizationStore",
      }),
      BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
      // Extra *browser* origins to trust for CORS and Better Auth's origin
      // check, comma-separated. Empty is the correct production value: the
      // Worker's own origin and the Electron protocol origin are trusted
      // independently. For browser-based local development set this in the
      // stage's env file.
      AUTH_TRUSTED_ORIGINS: Config.string("AUTH_TRUSTED_ORIGINS").pipe(Config.withDefault("")),
      ELECTRON_PROTOCOL: Config.string("ELECTRON_PROTOCOL").pipe(
        Config.withDefault("com.tabaaq.desktop"),
      ),
    },
  });
});

/**
 * The Worker's runtime bindings, derived from the declaration above. This
 * replaces the global `Env` interface that `wrangler types` used to generate
 * into `worker-configuration.d.ts` — the env can no longer drift from the
 * infrastructure that produced it.
 */
export type ApiEnv = Cloudflare.InferEnv<typeof Api>;
