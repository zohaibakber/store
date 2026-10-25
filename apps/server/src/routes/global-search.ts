import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as Layer from "effect/Layer";

import { CurrentOrganization } from "../auth/organization";
import { GlobalSearch } from "../global-search/service";
import { GlobalSearchPayloadErrors, StoreApi } from "../http/api";
import { badGateway, badRequest, retryAfter, tooManyRequests } from "../http/errors";

const GlobalSearchPayloadErrorsLive = HttpApiMiddleware.layerSchemaErrorTransform(
  GlobalSearchPayloadErrors,
  () =>
    Effect.fail(badRequest("INVALID_GLOBAL_SEARCH", "Search with between 2 and 80 characters.")),
);

export const GlobalSearchHandlers = HttpApiBuilder.group(
  StoreApi,
  "globalSearch",
  Effect.fn("GlobalSearchHandlers.make")(function* (handlers) {
    const globalSearch = yield* GlobalSearch;

    return handlers.handle(
      "search",
      Effect.fn("GlobalSearchHandlers.search")(function* ({ payload }) {
        const identity = yield* CurrentOrganization;
        return yield* globalSearch.search(identity, payload.query).pipe(
          Effect.catchTags({
            GlobalSearchRateLimited: (limited) =>
              retryAfter(limited.retryAfterMillis).pipe(
                Effect.andThen(
                  Effect.fail(
                    tooManyRequests(
                      "GLOBAL_SEARCH_RATE_LIMITED",
                      "Too many searches. Try again in a minute.",
                    ),
                  ),
                ),
              ),
            GlobalSearchFailed: () =>
              Effect.fail(
                badGateway("GLOBAL_SEARCH_FAILED", "Could not search the web. Try again."),
              ),
          }),
        );
      }),
    );
  }),
).pipe(Layer.provide(GlobalSearchPayloadErrorsLive));
