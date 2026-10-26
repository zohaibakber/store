import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { workerRuntimeServices } from "../runtime/isolate";

const GATEWAY_CACHE_SECONDS = 7 * 24 * 60 * 60;

export class AiGateway extends Context.Service<
  AiGateway,
  {
    readonly raw: Effect.Effect<Ai>;
    readonly id: Effect.Effect<string>;
  }
>()("@store/server/AiGateway") {
  static readonly layer = Layer.effect(
    AiGateway,
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      const gateway = yield* Cloudflare.AI.Gateway("GlobalSearchGateway", {
        id: stage === "prod" ? "tabaaq-globalsearchgateway-prod-ckap43plh4qg4zku" : undefined,
        cacheTtl: GATEWAY_CACHE_SECONDS,
        rateLimitingInterval: 60,
        rateLimitingLimit: 120,
        rateLimitingTechnique: "sliding",
        spendLimits: {
          enabled: true,
          rules: [{ limitType: "cost", limit: 100, window: "1 day" }],
        },
      });
      const client = yield* Cloudflare.AI.QueryGateway(gateway);
      const runtime = yield* workerRuntimeServices;
      return AiGateway.of({
        raw: Effect.provideContext(client.raw, runtime),
        id: Effect.provideContext(client.id, runtime),
      });
    }),
  );
}
