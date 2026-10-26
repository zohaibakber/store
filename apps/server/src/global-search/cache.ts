import { GlobalProductSearchResult } from "@store/contracts";
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

const cacheKey = (query: string) => `${CACHE_KEY_PREFIX}${encodeURIComponent(query)}`;

export const readCachedSearch = Effect.fn("GlobalSearchCache.get")(
  function* (query: string) {
    const body = yield* Effect.tryPromise(async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(cacheKey(query));
      return response === undefined ? Option.none<string>() : Option.some(await response.text());
    });
    if (Option.isNone(body)) return Option.none<GlobalProductSearchResult>();
    return Option.some(yield* decodeCachedResult(body.value));
  },
  (effect) =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logWarning("global_search.cache_read_failed").pipe(
          Effect.annotateLogs({ error: String(error) }),
        ),
      ),
      Effect.orElseSucceed(() => Option.none<GlobalProductSearchResult>()),
    ),
);

export const writeCachedSearch = Effect.fn("GlobalSearchCache.put")(
  function* (query: string, result: GlobalProductSearchResult) {
    const body = yield* encodeCachedResult(result);
    yield* Effect.tryPromise(async () => {
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
    });
  },
  (effect) => Effect.ignore(effect),
);
