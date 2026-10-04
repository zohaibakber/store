import { SYNC_REQUEST_TIMEOUT_MILLIS, SyncTransportService } from "@store/sync";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";

export type SyncProxyRequest = {
  readonly method: "GET" | "POST";
  readonly pathname: string;
  readonly bodyText: string | null;
  readonly timeoutMillis: number;
};

export type SyncProxyResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly bodyText: string;
  readonly retryAfter?: string;
};

type SyncProxyFetch<E> = (request: SyncProxyRequest) => Effect.Effect<SyncProxyResponse, E>;

const PROXY_ORIGIN = "http://sync-proxy.invalid";

const PROXY_TIMEOUT_MILLIS = Math.max(...Object.values(SYNC_REQUEST_TIMEOUT_MILLIS));

const BODILESS_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

const utf8 = new TextDecoder();

const unsendable = (request: HttpClientRequest.HttpClientRequest, description: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.EncodeError({ request, description }),
  });

const unreachable = (
  request: HttpClientRequest.HttpClientRequest,
  description: string,
  cause: unknown,
) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description, cause }),
  });

const proxyRequestOf = (
  request: HttpClientRequest.HttpClientRequest,
  url: URL,
): Effect.Effect<SyncProxyRequest, HttpClientError.HttpClientError> => {
  if (request.method !== "GET" && request.method !== "POST") {
    return Effect.fail(unsendable(request, "The sync proxy carries GET and POST requests only."));
  }
  const route = {
    method: request.method,
    pathname: `${url.pathname}${url.search}`,
    timeoutMillis: PROXY_TIMEOUT_MILLIS,
  };
  switch (request.body._tag) {
    case "Empty":
      return Effect.succeed({ ...route, bodyText: null });
    case "Uint8Array":
      return Effect.succeed({ ...route, bodyText: utf8.decode(request.body.body) });
    default:
      return Effect.fail(unsendable(request, "The sync proxy carries text bodies only."));
  }
};

const responseOf = (request: HttpClientRequest.HttpClientRequest, reply: SyncProxyResponse) =>
  Effect.try({
    try: () =>
      HttpClientResponse.fromWeb(
        request,
        new Response(BODILESS_STATUSES.has(reply.status) ? null : reply.bodyText, {
          status: reply.status,
          headers:
            reply.retryAfter === undefined
              ? { "content-type": "application/json" }
              : { "content-type": "application/json", "retry-after": reply.retryAfter },
        }),
      ),
    catch: (cause) =>
      unreachable(request, "The sync proxy answered with a status HTTP cannot carry.", cause),
  });

const makeProxyHttpClient = <E>(proxyFetch: SyncProxyFetch<E>): HttpClient.HttpClient =>
  HttpClient.make((request, url) =>
    proxyRequestOf(request, url).pipe(
      Effect.flatMap((proxied) =>
        Effect.mapError(proxyFetch(proxied), (cause) =>
          unreachable(request, "The sync proxy did not carry the request.", cause),
        ),
      ),
      Effect.flatMap((reply) => responseOf(request, reply)),
    ),
  );

export const layerProxySyncTransport = <E>(
  proxyFetch: SyncProxyFetch<E>,
): Layer.Layer<SyncTransportService> =>
  SyncTransportService.layer(PROXY_ORIGIN).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, makeProxyHttpClient(proxyFetch))),
  );
