import type { GlobalProductSearchResult } from "@store/contracts/server-api.schema";
import type { RequestError, SessionHttp } from "@store/workspace";
import * as Effect from "effect/Effect";

import { asServerRequestError, serverApi } from "./server-api";

export const searchGlobalProducts = Effect.fn("searchGlobalProducts")(function* (
  query: string,
): Effect.fn.Return<GlobalProductSearchResult, Error | RequestError, SessionHttp> {
  const api = yield* serverApi;
  return yield* api.globalSearch
    .search({ payload: { query } })
    .pipe(asServerRequestError("Web search returned an unexpected response."));
});
