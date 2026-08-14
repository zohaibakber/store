import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { Api, PRODUCTION_DOMAIN } from "../server/infra";

const rootDir = import.meta.dirname;

/**
 * React SPA frontend, deployed the way Alchemy documents for Vite SPAs:
 * `Cloudflare.Website.Vite` runs Vite during `alchemy deploy` (CI included)
 * and ships client assets. Deep links fall back to `index.html`. `/api/*`
 * is served by `worker.ts` and proxied to the API Worker so auth
 * cookies stay same-origin.
 *
 * Production hostname attach is a second `alchemy deploy` with
 * `CLAIM_PRODUCTION_DOMAIN=1`. Alchemy applies the API Worker update and this
 * create in parallel, so claiming the hostname in the same pass races the API
 * Worker's detach (`domain: null`). Omitting `domain` leaves a live attachment
 * alone, so later deploys without the flag do not drop the hostname.
 *
 * @see https://alchemy.run/cloudflare/frontend/vite-spa/
 * @see https://alchemy.run/cloudflare/frontend/vite/
 */
export const Website = Cloudflare.Website.Vite(
  "Website",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;

    return {
      rootDir,
      main: "worker.ts",
      env: {
        API: Api,
      },
      assets: {
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/api", "/api/*"],
      },
      ...(stage === "prod" && process.env.CLAIM_PRODUCTION_DOMAIN === "1"
        ? { domain: PRODUCTION_DOMAIN }
        : {}),
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
        include: ["**/*", "../desktop/src/**", "../desktop/public/**", "../../packages/*/src/**"],
        lockfile: true,
      },
    };
  }),
);

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
