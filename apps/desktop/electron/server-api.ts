import { ServerHttpApi, ServerHttpError, serverHttpErrorStatus } from "@store/contracts/server-api";
import { asRequestError, isInvalidResponse, RequestError, SessionHttp } from "@store/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class ServerResponseInvalid extends Schema.TaggedError<ServerResponseInvalid>()(
  "ServerResponseInvalid",
  { operation: Schema.String },
) {
  override get message() {
    return `${this.operation} returned an unexpected response.`;
  }
}

export class ServerApi extends Context.Service<
  ServerApi,
  HttpApiClient.ForApi<typeof ServerHttpApi, RequestError>
>()("@store/desktop/ServerApi") {
  static readonly layer = Layer.effect(
    ServerApi,
    SessionHttp.use((session) =>
      HttpApiClient.makeWith(ServerHttpApi, {
        httpClient: session.http,
        baseUrl: session.apiBaseUrl,
      }),
    ),
  );
}

const isServerHttpError = Schema.is(ServerHttpError);

type ServerFailure =
  | ServerHttpError
  | RequestError
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

export const asServerRequestError =
  (operation: string) =>
  <A, R>(
    effect: Effect.Effect<A, ServerFailure, R>,
  ): Effect.Effect<A, RequestError | ServerResponseInvalid, R> =>
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
      Effect.catchIf(isInvalidResponse, () =>
        Effect.fail(new ServerResponseInvalid({ operation })),
      ),
    );

export const isUnreachable = (error: RequestError) =>
  error.status === 0 && error.code === "NETWORK_ERROR";
