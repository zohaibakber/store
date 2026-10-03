import { GlobalProductSearchResult } from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CACHE_NAME = "global-search";
const CACHE_KEY_PREFIX = "https://global-search.cache.internal/v2/";
const FOUND_TTL_SECONDS = 7 * 24 * 60 * 60;
const EMPTY_TTL_SECONDS = 24 * 60 * 60;

const CachedResult = Schema.fromJsonString(GlobalProductSearchResult);
const decodeCachedResult = Schema.decodeUnknownEffect(CachedResult);
const encodeCachedResult = Schema.encodeUnknownEffect(CachedResult);

export const normalizeGlobalSearchQuery = (query: string) =>
  query.trim().toLowerCase().replace(/\s+/g, " ");

const cacheKey = (query: string) => `${CACHE_KEY_PREFIX}${encodeURIComponent(query)}`;

export interface GlobalSearchCacheContract {
  readonly get: (query: string) => Effect.Effect<Option.Option<GlobalProductSearchResult>>;
  readonly put: (
    query: string,
    result: GlobalProductSearchResult,
  ) => Effect.Effect<void, never, RuntimeContext>;
}

export const makeGlobalSearchCache = (
  waitUntil: (effect: Effect.Effect<void>) => Effect.Effect<void, never, RuntimeContext>,
): GlobalSearchCacheContract => ({
  get: Effect.fn("GlobalSearchCache.get")((query: string) =>
    Effect.tryPromise(async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(cacheKey(query));
      return response === undefined ? Option.none<string>() : Option.some(await response.text());
    }).pipe(Effect.flatMap(Effect.fromOption), Effect.flatMap(decodeCachedResult), Effect.option),
  ),
  put: (query, result) =>
    waitUntil(
      encodeCachedResult(result).pipe(
        Effect.flatMap((body) =>
          Effect.tryPromise(async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(
              cacheKey(query),
              new Response(body, {
                headers: {
                  "content-type": "application/json",
                  "cache-control": `public, max-age=${result.products.length > 0 ? FOUND_TTL_SECONDS : EMPTY_TTL_SECONDS}`,
                },
              }),
            );
          }),
        ),
        Effect.ignore,
        Effect.withSpan("GlobalSearchCache.put"),
      ),
    ),
});
