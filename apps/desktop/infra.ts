import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { Auth } from "../auth/infra.ts";
import { Api } from "../server/api.ts";
import {
  productionDomainConfig,
  requireProductionHostname,
} from "../server/src/runtime/production-domain.ts";

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
