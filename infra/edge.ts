import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

import {
  EDGE_WAF_ENABLED,
  PRODUCTION_API_HOSTNAME,
  PRODUCTION_AUTH_HOSTNAME,
  PRODUCTION_ZONE,
} from "./deployment.ts";

const API_RATE_LIMIT = {
  period: 10,
  requestsPerPeriod: 50,
  mitigationTimeout: 10,
} as const;

const PATH = "http.request.uri.path";

const quoted = (value: string) => JSON.stringify(value);

const pathOutside = (exact: ReadonlyArray<string>, prefixes: ReadonlyArray<string>) =>
  `not (${[
    `${PATH} in {${exact.map(quoted).join(" ")}}`,
    ...prefixes.map((prefix) => `starts_with(${PATH}, ${quoted(prefix)})`),
  ].join(" or ")})`;

const firewallRules = [
  {
    ref: "tabaaq_api_paths",
    description: "Block API hosts outside /api/",
    action: "block",
    expression: `http.host eq ${quoted(PRODUCTION_API_HOSTNAME)} and ${pathOutside(["/", "/api"], ["/api/"])}`,
  },
  {
    ref: "tabaaq_auth_paths",
    description: "Block auth hosts outside /v1/ and /.well-known/",
    action: "block",
    expression: `http.host eq ${quoted(PRODUCTION_AUTH_HOSTNAME)} and ${pathOutside(
      ["/", "/health"],
      ["/v1/", "/.well-known/"],
    )}`,
  },
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

export const Edge = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
  if (!EDGE_WAF_ENABLED || localDevelopment || stage !== "prod") return undefined;
  const zone = yield* Cloudflare.Zone.Zone("EdgeZone", { name: PRODUCTION_ZONE }).pipe(
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
    zone: PRODUCTION_ZONE,
    firewallRulesetId: firewall.rulesetId,
    rateLimitRulesetId: rateLimit.rulesetId,
  };
});
