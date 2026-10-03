import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CurrentOrganization } from "../auth/organization";
import { normalizeGlobalSearchQuery } from "../global-search/cache";
import { GlobalSearchPayloadErrors, StoreApi } from "../http/api";
import { badGateway, badRequest, retryAfter, tooManyRequests } from "../http/errors";
import { RATE_LIMITS, ServerRuntime } from "../http/runtime";

const GlobalSearchPayloadErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
  GlobalSearchPayloadErrors,
  () =>
    Effect.fail(badRequest("INVALID_GLOBAL_SEARCH", "Search with between 2 and 80 characters.")),
);

export const GlobalSearchHandlers = HttpApiBuilder.group(
  StoreApi,
  "globalSearch",
  Effect.fn("GlobalSearchHandlers.make")(function* (handlers) {
    const runtime = yield* ServerRuntime;

    return handlers.handle(
      "search",
      Effect.fn("GlobalSearchHandlers.search")(function* ({ payload }) {
        const identity = yield* CurrentOrganization;
        const query = normalizeGlobalSearchQuery(payload.query);
        const cached = yield* runtime.globalSearchCache.get(query);
        if (Option.isSome(cached)) return cached.value;

        const rateLimit = yield* runtime
          .limitGlobalSearch(`${identity.organizationId}:${identity.userId}`)
          .pipe(Effect.orDie);
        if (!rateLimit.success) {
          yield* retryAfter(RATE_LIMITS.globalSearch.period * 1_000);
          return yield* Effect.fail(
            tooManyRequests(
              "GLOBAL_SEARCH_RATE_LIMITED",
              "Too many searches. Try again in a minute.",
            ),
          );
        }

        const { result, extracted } = yield* runtime.searchGlobalProducts(query).pipe(
          Effect.tapError((error) =>
            Effect.logError("Global product search failed").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(Cause.fail(error)) }),
            ),
          ),
          Effect.mapError(() =>
            badGateway("GLOBAL_SEARCH_FAILED", "Could not search the web. Try again."),
          ),
        );
        if (extracted) yield* runtime.globalSearchCache.put(query, result);
        return result;
      }),
    );
  }),
).pipe(Layer.provide(GlobalSearchPayloadErrorsLive));
