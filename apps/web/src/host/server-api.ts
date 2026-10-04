import { ServerHttpApi, ServerHttpError, serverHttpErrorStatus } from "@store/contracts/server-api";
import { asRequestError, isInvalidResponse, RequestError, SessionHttp } from "@store/workspace";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as Schema from "effect/Schema";

export const serverApi = SessionHttp.use((session) =>
  HttpApiClient.makeWith(ServerHttpApi, {
    httpClient: session.http,
    baseUrl: session.apiBaseUrl,
  }),
);

const isServerHttpError = Schema.is(ServerHttpError);

type ServerFailure =
  | ServerHttpError
  | RequestError
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

export const asServerRequestError =
  (unexpected: string) =>
  <A, R>(effect: Effect.Effect<A, ServerFailure, R>): Effect.Effect<A, Error | RequestError, R> =>
    effect.pipe(
      Effect.catchIf(isServerHttpError, (failure) =>
        Effect.fail(
          new RequestError({
            message: failure.error.message,
            status: serverHttpErrorStatus(failure._tag),
            code: failure.error.code,
          }),
        ),
      ),
      asRequestError,
      Effect.catchIf(isInvalidResponse, () => Effect.fail(new Error(unexpected))),
    );
