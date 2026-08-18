import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { Api, requireProductionHostname } from "../server/infra";

const rootDir = import.meta.dirname;

/**
 * React SPA frontend, deployed the way Alchemy documents for Vite SPAs:
 * `Cloudflare.Website.Vite` runs Vite during `alchemy deploy` (CI included)
 * and ships client assets. Deep links fall back to `index.html`.
 *
 * Production attaches this Worker to `PRODUCTION_DOMAIN` (apex). The API Worker
 * attaches to `api.<domain>` in the same deploy — the hostnames no longer
 * collide, so there is no two-pass detach. Locally, `/api/*` is still proxied
 * to the API Worker so `vp run dev` stays same-origin. Production browsers
 * call `VITE_API_URL` (the API host) with Clerk Bearer tokens.
 *
 * @see https://alchemy.run/cloudflare/frontend/vite-spa/
 * @see https://alchemy.run/cloudflare/frontend/vite/
 */
export const Website = Cloudflare.Website.Vite(
  "Website",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const siteHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && stage === "prod" ? requireProductionHostname() : undefined;

    const websiteConfig = {
      rootDir,
      main: "worker.ts",
      env: {
        API: Api,
      },
      assets: {
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/api", "/api/*"],
      },
      // Capped by the workerd that `alchemy dev` runs locally — keep in step
      // with the API Worker. See apps/server/infra.ts.
      compatibility: { date: "2026-07-11", flags: ["nodejs_compat", "enable_request_signal"] },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      // Standalone `vp dev` also uses 5174 with a `/api` proxy; alchemy's
      // Cloudflare Vite plugin owns that port when this resource is in the
      // stack (`bun alchemy dev`).
      dev: { port: 5174 },
      memo: {
        include: ["**/*", "../../packages/*/src/**"],
        lockfile: true,
      },
    };
    return siteHostname ? { ...websiteConfig, domain: siteHostname } : websiteConfig;
  }),
);

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
