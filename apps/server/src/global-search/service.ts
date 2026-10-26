import type { GlobalProductSearchResult } from "@store/contracts";
import { PageImages, searchGlobalProducts, WebSearch } from "@store/services";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { LanguageModel } from "effect/ai/LanguageModel";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { Actor } from "../authority/engine";
import { readCachedSearch, writeCachedSearch } from "./cache";

const RATE_LIMIT = { limit: 10, period: 60 } as const;

export class GlobalSearchRateLimited extends Schema.TaggedError<GlobalSearchRateLimited>()(
  "GlobalSearchRateLimited",
  { retryAfterMillis: Schema.Number },
) {}

export class GlobalSearchFailed extends Schema.TaggedError<GlobalSearchFailed>()(
  "GlobalSearchFailed",
  { cause: Schema.Defect() },
) {}

const normalizeQuery = (query: string) => query.trim().toLowerCase().replace(/\s+/g, " ");

export class GlobalSearch extends Context.Service<
  GlobalSearch,
  {
    readonly search: (
      actor: Actor,
      query: string,
    ) => Effect.Effect<
      GlobalProductSearchResult,
      GlobalSearchRateLimited | GlobalSearchFailed,
      RuntimeContext
    >;
  }
>()("@store/server/GlobalSearch") {
  static readonly layer = Layer.effect(
    GlobalSearch,
    Effect.gen(function* () {
      const rateLimit = yield* Cloudflare.RateLimit("GLOBAL_SEARCH_RATE_LIMIT", {
        namespaceId: 1003,
        simple: RATE_LIMIT,
      });
      const execution = yield* Cloudflare.WorkerExecutionContext;
      const backends = yield* Effect.context<WebSearch | PageImages | LanguageModel>();

      const search = Effect.fn("GlobalSearch.search")(function* (actor: Actor, rawQuery: string) {
        const query = normalizeQuery(rawQuery);
        const cached = yield* readCachedSearch(query);
        if (Option.isSome(cached)) return cached.value;

        const admitted = yield* rateLimit
          .limit({ key: `${actor.organizationId}:${actor.userId}` })
          .pipe(Effect.orDie);
        if (!admitted.success) {
          return yield* new GlobalSearchRateLimited({
            retryAfterMillis: RATE_LIMIT.period * 1_000,
          });
        }

        const { result, extracted } = yield* searchGlobalProducts(query).pipe(
          Effect.provideContext(backends),
          Effect.tapError((error) =>
            Effect.logError("Global product search failed").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(Cause.fail(error)) }),
            ),
          ),
          Effect.mapError((cause) => new GlobalSearchFailed({ cause })),
        );
        if (extracted) yield* execution.waitUntil(writeCachedSearch(query, result));
        return result;
      });

      return GlobalSearch.of({ search });
    }),
  );
}
