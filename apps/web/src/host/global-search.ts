import { GlobalProductSearchResult } from "@store/contracts/server-api.schema";
import {
  SessionHttp,
  asRequestError,
  decodeResponse,
  isInvalidResponse,
  type RequestError,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";

export const searchGlobalProducts = Effect.fn("searchGlobalProducts")(function* (
  query: string,
): Effect.fn.Return<GlobalProductSearchResult, Error | RequestError, SessionHttp> {
  const session = yield* SessionHttp;
  const response = yield* asRequestError(
    session.http.post(`${session.apiBaseUrl}/api/global-search`, {
      body: HttpBody.jsonUnsafe({ query }),
    }),
  );
  return yield* decodeResponse(GlobalProductSearchResult)(response).pipe(
    Effect.catchIf(isInvalidResponse, () =>
      Effect.fail(new Error("Web search returned an unexpected response.")),
    ),
  );
});
