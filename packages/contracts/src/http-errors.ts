import * as Effect from "effect/Effect";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const PublicErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

export const publicErrorSchema = <const Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.tagDefaultOmit(tag),
    error: PublicErrorBody,
  }).pipe(HttpApiSchema.status(status));

export const isAuthStatus = (status: number): boolean => status === 401 || status === 403;

const retryLaterFailure = (response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 300 &&
  !isAuthStatus(response.status) &&
  Option.isSome(Headers.get(response.headers, "retry-after"))
    ? Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({
            request: response.request,
            response,
            description: "The server asked the client to retry later.",
          }),
        }),
      )
    : Effect.succeed(response);

export const honourRetryAfter = HttpClient.transformResponse(Effect.flatMap(retryLaterFailure));
