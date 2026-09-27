import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { Auth } from "../auth/infra.ts";
import { Api } from "../server/infra.ts";
import {
  productionDomainConfig,
  requireProductionHostname,
} from "../server/src/runtime/production-domain.ts";

/**
 * The browser host: this workspace's renderer as a static SPA on the
 * `PRODUCTION_DOMAIN` apex. `Cloudflare.Website.Vite` runs the Vite build
 * during `alchemy deploy`; `vite.config.ts` selects the web build from
 * Alchemy's injection flag, since the resource cannot pass `--mode web`.
 * Deep links fall back to `index.html` for the client router.
 *
 * Only published stages declare it. They are the only stages whose site
 * origin auth and the API trust, and the refresh cookie needs the SPA and
 * `auth.<domain>` to be same-site. Locally, `vp run dev:web` serves the
 * renderer on `http://localhost:5174` against the dev Workers.
 */
export const Website = Cloudflare.Website.Vite(
  "Website",
  Effect.gen(function* () {
    const api = yield* Api;
    const auth = yield* Auth;
    const siteHostname = requireProductionHostname(yield* productionDomainConfig);
    return {
      rootDir: import.meta.dirname,
      domain: siteHostname,
      env: {
        VITE_API_URL: Output.interpolate`${api.url}`,
        VITE_AUTH_URL: Output.interpolate`${auth.url}`,
      },
      assets: { notFoundHandling: "single-page-application" as const },
      compatibility: { date: "2026-07-11" },
      observability: { enabled: true },
      memo: {
        include: ["**/*", "../../packages/*/src/**"],
        lockfile: true,
      },
    };
  }).pipe(Effect.orDie),
);
