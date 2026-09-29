import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { resolveProductionAuthHostname } from "../apps/auth/src/public-hostname.ts";
import {
  productionDomainConfig,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "../apps/server/src/runtime/production-domain.ts";

const API_RATE_LIMIT = {
  period: 10,
  requestsPerPeriod: 50,
  mitigationTimeout: 10,
} as const;

const PATH = "http.request.uri.path";

const quoted = (value: string) => JSON.stringify(value);

const withinZone = (hostname: string, zone: string) => hostname.endsWith(`.${zone}`);

const pathOutside = (exact: ReadonlyArray<string>, prefixes: ReadonlyArray<string>) =>
  `not (${[
    `${PATH} in {${exact.map(quoted).join(" ")}}`,
    ...prefixes.map((prefix) => `starts_with(${PATH}, ${quoted(prefix)})`),
  ].join(" or ")})`;

interface EdgeHostnames {
  readonly zone: string;
  readonly apiHostname: string;
  readonly authHostname: string;
}

const edgeFirewallRules = ({ zone, apiHostname, authHostname }: EdgeHostnames) => [
  ...(withinZone(apiHostname, zone)
    ? [
        {
          ref: "tabaaq_api_paths",
          description: "Block API hosts outside /api/",
          action: "block",
          expression: `http.host eq ${quoted(apiHostname)} and ${pathOutside(["/", "/api"], ["/api/"])}`,
        },
      ]
    : []),
  ...(withinZone(authHostname, zone)
    ? [
        {
          ref: "tabaaq_auth_paths",
          description: "Block auth hosts outside /v1/ and /.well-known/",
          action: "block",
          expression: `http.host eq ${quoted(authHostname)} and ${pathOutside(
            ["/", "/health"],
            ["/v1/", "/.well-known/"],
          )}`,
        },
      ]
    : []),
];

const apiRateLimitRules = [
  {
    ref: "tabaaq_api_rate_limit",
    description: "Rate limit /api/ per IP",
    action: "block",
    expression: `starts_with(${PATH}, "/api/")`,
    ratelimit: {
      characteristics: ["cf.colo.id", "ip.src"],
      ...API_RATE_LIMIT,
    },
  },
];

const resolveEdgeHostnames = Effect.gen(function* () {
  const domains = yield* productionDomainConfig;
  const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
    Config.withDefault(""),
  );
  const zone = resolveProductionHostname(domains);
  const apiHostname = resolveProductionApiHostname(domains);
  const authHostname = resolveProductionAuthHostname({
    productionDomain: domains.PRODUCTION_DOMAIN,
    productionAuthDomain,
  });
  return zone && apiHostname && authHostname
    ? ({ zone, apiHostname, authHostname } satisfies EdgeHostnames)
    : undefined;
});

export const Edge = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
  const enabled = yield* Config.Boolean("EDGE_WAF_ENABLED").pipe(Config.withDefault(false));
  const hostnames = yield* resolveEdgeHostnames;
  if (!enabled || localDevelopment || stage !== "prod" || !hostnames) return undefined;
  const firewallRules = edgeFirewallRules(hostnames);
  if (firewallRules.length === 0) return undefined;
  const zone = yield* Cloudflare.Zone.Zone("EdgeZone", { name: hostnames.zone }).pipe(
    Alchemy.AdoptPolicy.adopt(true),
  );
  const firewall = yield* Cloudflare.Ruleset.Ruleset("EdgeFirewall", {
    zone,
    phase: "http_request_firewall_custom",
    description: "Tabaaq API and auth host path allowlist",
    rules: firewallRules,
  });
  const rateLimit = yield* Cloudflare.Ruleset.Ruleset("EdgeRateLimit", {
    zone,
    phase: "http_ratelimit",
    description: "Tabaaq per-IP API rate limit",
    rules: apiRateLimitRules,
  });
  return {
    zone: hostnames.zone,
    firewallRulesetId: firewall.rulesetId,
    rateLimitRulesetId: rateLimit.rulesetId,
  };
});
