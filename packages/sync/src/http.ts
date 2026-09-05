import {
  CatalogBatchResult,
  CatalogLiveTicket,
  CatalogNotification,
  CatalogPullResult,
  CatalogSnapshotResult,
  SYNC_EPOCH,
  type CatalogPullRequest,
  type CatalogSnapshotRequest,
  type CatalogBatchCommand,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Socket from "effect/unstable/socket/Socket";

import { CatalogError } from "./errors";
import { CatalogTransport, type CatalogLiveHint } from "./transport";

export const retryAfterDelay = (value: string | undefined, now = Date.now()) => {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
};

type CatalogRequest =
  | CatalogPullRequest
  | CatalogSnapshotRequest
  | { readonly commands: ReadonlyArray<CatalogBatchCommand> }
  | Record<string, never>;

export const CatalogHttpTransport = (options: {
  readonly apiUrl: string;
  readonly headers: () => HeadersInit;
  readonly fetch?: typeof fetch;
}) =>
  Layer.effect(
    CatalogTransport,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = Effect.fn("CatalogTransport.request")(function* <A, I>(
        path: string,
        body: CatalogRequest,
        schema: Schema.Codec<A, I>,
      ) {
        const request = yield* HttpClientRequest.post(new URL(path, options.apiUrl).href).pipe(
          HttpClientRequest.setHeaders(new Headers(options.headers())),
          HttpClientRequest.bodyJson(body),
          Effect.mapError(
            (error) => new CatalogError({ reason: "rejected", message: error.message }),
          ),
        );
        const response = yield* client.execute(request).pipe(
          Effect.timeout("30 seconds"),
          Effect.mapError(
            (error) => new CatalogError({ reason: "transport", message: error.message }),
          ),
        );
        if (response.status < 200 || response.status >= 300) {
          return yield* new CatalogError({
            reason:
              response.status === 401
                ? "unauthenticated"
                : response.status === 409
                  ? "conflict"
                  : response.status === 408 || response.status === 429 || response.status >= 500
                    ? "transient"
                    : "rejected",
            retryAfterMs: retryAfterDelay(response.headers["retry-after"]),
            message:
              response.status === 401
                ? "Your session expired. Sign in again to sync saved changes."
                : `Catalog request failed (${response.status}).`,
          });
        }
        return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            (error) => new CatalogError({ reason: "rejected", message: error.message }),
          ),
        );
      });

      const live = Stream.callback<CatalogLiveHint, CatalogError>(
        (queue) =>
          Effect.gen(function* () {
            const ticket = yield* request("/api/inventory/live-ticket", {}, CatalogLiveTicket);
            const url = new URL("/api/inventory/live", options.apiUrl);
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            url.searchParams.set("organizationId", ticket.organizationId);
            url.searchParams.set("ticket", ticket.ticket);
            const socket = yield* Socket.makeWebSocket(url.href, { openTimeout: "10 seconds" });
            yield* socket
              .runString(
                (frame) =>
                  Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogNotification))(
                    frame,
                  ).pipe(
                    Effect.flatMap((hint) => Queue.offer(queue, hint)),
                    Effect.mapError(
                      (error) => new CatalogError({ reason: "rejected", message: error.message }),
                    ),
                  ),
                {
                  onOpen: Queue.offer(queue, { epoch: SYNC_EPOCH, cursor: 0 }).pipe(Effect.asVoid),
                },
              )
              .pipe(
                Effect.mapError(
                  (error) => new CatalogError({ reason: "transport", message: error.message }),
                ),
                Effect.catch((error) => Queue.fail(queue, error)),
                Effect.forkScoped,
              );
          }).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal)),
        { bufferSize: 1, strategy: "sliding" },
      );

      return CatalogTransport.of({
        pull: (payload) => request("/api/inventory/pull", payload, CatalogPullResult),
        snapshot: (payload) => request("/api/inventory/snapshot", payload, CatalogSnapshotResult),
        batch: (commands) => request("/api/inventory/batch", { commands }, CatalogBatchResult),
        live,
      });
    }),
  ).pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch ?? globalThis.fetch)),
      ),
    ),
  );
