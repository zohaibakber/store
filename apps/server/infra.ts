import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Api, OrgAuthority, OrgHub } from "./api";
import { AiGateway } from "./src/ai/gateway";
import { workersAiLanguageModel } from "./src/ai/language-model";
import { AccessTokens } from "./src/auth/access-tokens";
import { OrgAuthorityLive } from "./src/authority/durable-object";
import { PageImagesLive } from "./src/global-search/page-images";
import { GlobalSearch } from "./src/global-search/service";
import { cloudflareWebSearch } from "./src/global-search/web-search";
import { makeWorkerFetch } from "./src/http/app";
import { OrgAuthorities, OrganizationAuthority } from "./src/inventory/organization-authority";
import { LiveFanout } from "./src/live/fanout";
import { OrgHubLive } from "./src/live/org-hub";
import { OrgHubs } from "./src/live/org-hubs";
import {
  productionDomainConfig,
  requireProductionApiHostname,
  requireProductionHostname,
} from "./src/runtime/production-domain";

const ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE = "2026-07-11";

const OrgHubsLive = Layer.effect(
  OrgHubs,
  Effect.gen(function* () {
    return OrgHubs.of(yield* OrgHub);
  }),
);

const OrgAuthoritiesLive = Layer.effect(
  OrgAuthorities,
  Effect.gen(function* () {
    return OrgAuthorities.of(yield* OrgAuthority);
  }),
);

const SearchBackendsLive = Layer.mergeAll(
  cloudflareWebSearch,
  workersAiLanguageModel,
  PageImagesLive,
).pipe(Layer.provide(AiGateway.layer));

const ApiServicesLive = Layer.mergeAll(
  OrganizationAuthority.layer.pipe(Layer.provide(OrgAuthoritiesLive)),
  LiveFanout.layer,
  GlobalSearch.layer.pipe(Layer.provide(SearchBackendsLive)),
  AccessTokens.layer,
).pipe(Layer.provideMerge(OrgHubsLive));

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const published = stage === "prod";
    const domains =
      !globalThis.__ALCHEMY_RUNTIME__ && published ? yield* productionDomainConfig : undefined;
    const worker = {
      main: import.meta.url,
      compatibility: {
        date: ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE,
        flags: ["nodejs_compat", "enable_request_signal"],
      },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      dev: { port: 8787 },
    };
    if (domains === undefined) return worker;
    const siteHostname = requireProductionHostname(domains);
    return {
      ...worker,
      name: "tabaaq-api-prod-dirryhrx4li46wwh",
      domain: requireProductionApiHostname(domains),
      routes: [{ pattern: `${siteHostname}/api/*`, zoneName: siteHostname }],
      workersDev: false,
    };
  }),
  Effect.gen(function* () {
    const fetch = yield* makeWorkerFetch;
    return { fetch };
  }).pipe(
    Effect.provide(ApiServicesLive),
    Effect.provide(OrgHubLive),
    Effect.provide(OrgAuthorityLive),
    Effect.provide(Cloudflare.Workers.AIBinding),
    Effect.provide(Cloudflare.AI.QueryGatewayBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default ApiLive;
