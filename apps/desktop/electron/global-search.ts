import type { GlobalProductSearchResult } from "@store/contracts/server-api.schema";
import type { RequestError } from "@store/workspace";
import * as Effect from "effect/Effect";

import { asServerRequestError, ServerApi, type ServerResponseInvalid } from "./server-api";

export const searchGlobalProducts = Effect.fn("ServerApi.searchGlobalProducts")(function* (
  query: string,
): Effect.fn.Return<GlobalProductSearchResult, RequestError | ServerResponseInvalid, ServerApi> {
  const api = yield* ServerApi;
  return yield* api.globalSearch
    .search({ payload: { query } })
    .pipe(asServerRequestError("Web search"));
});
