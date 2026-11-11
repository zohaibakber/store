import { AuthSigningKeyPair } from "@store/db/auth/infra";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { LOCAL_API_PORT, PRODUCTION_API_HOSTNAME, PRODUCTION_ZONE } from "../../infra/deployment";
import { Api, OrgAuthority } from "./api";
import { AccessTokens } from "./src/auth/access-tokens";
import { OrgAuthorityLive } from "./src/authority/durable-object";
import { makeWorkerFetch } from "./src/http/app";
import { OrgAuthorities, OrganizationAuthority } from "./src/inventory/organization-authority";

const ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE = "2026-07-11";

const OrgAuthoritiesLive = Layer.effect(
  OrgAuthorities,
  Effect.gen(function* () {
    return OrgAuthorities.of(yield* OrgAuthority);
  }),
);

const ApiServicesLive = Layer.mergeAll(OrganizationAuthority.layer, AccessTokens.layer).pipe(
  Layer.provideMerge(OrgAuthoritiesLive),
);

export const ApiLive = Api.make(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const signingKey = yield* AuthSigningKeyPair;
    const worker = {
      main: import.meta.url,
      compatibility: {
        date: ALCHEMY_DEV_WORKERD_COMPATIBILITY_DATE,
        flags: ["nodejs_compat", "enable_request_signal"],
      },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      dev: { port: LOCAL_API_PORT },
      env: { AUTH_JWT_PUBLIC_KEY: signingKey.publicKey },
    };
    if (globalThis.__ALCHEMY_RUNTIME__ || stage !== "prod") return worker;
    return {
      ...worker,
      name: "tabaaq-api-prod-dirryhrx4li46wwh",
      domain: PRODUCTION_API_HOSTNAME,
      routes: [{ pattern: `${PRODUCTION_ZONE}/api/*`, zoneName: PRODUCTION_ZONE }],
      workersDev: false,
    };
  }),
  Effect.gen(function* () {
    const fetch = yield* makeWorkerFetch;
    return { fetch };
  }).pipe(Effect.provide(ApiServicesLive), Effect.provide(OrgAuthorityLive)),
);

export default ApiLive;
