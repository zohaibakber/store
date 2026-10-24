import { SyncTransportService } from "@store/sync";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export const MAX_REQUEST_BODY_BYTES = 1_048_576;

export const REQUEST_CONCURRENCY = 4;

export const SNAPSHOT_DOWNLOAD_CONCURRENCY = 2;

const LIVE_TOKEN_LIMIT = Duration.seconds(30);

export const RequestDeadline = Context.Reference<Duration.Duration>(
  "@store/client-db/PinnedHttp/RequestDeadline",
  { defaultValue: () => Duration.seconds(30) },
);

type Held = {
  readonly _tag: "held";
  readonly token: Redacted.Redacted<string>;
  readonly version: number;
};

type Absent = { readonly _tag: "absent"; readonly version: number };

type Settled = Held | Absent;

type TokenState =
  | { readonly _tag: "pending"; readonly version: number }
  | { readonly _tag: "refreshing"; readonly version: number }
  | Settled;

const isSettled = (state: TokenState): state is Settled =>
  state._tag === "held" || state._tag === "absent";

const SNAPSHOT_PART = /\/api\/sync\/snapshots\/[^/]+\/parts\/\d+$/u;

const isSnapshotDownload = (request: HttpClientRequest.HttpClientRequest) =>
  request.method === "GET" && SNAPSHOT_PART.test(request.url);

const isRedirect = (status: number) => status >= 300 && status < 400;

const unsendable = (request: HttpClientRequest.HttpClientRequest, description: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.EncodeError({ request, description }),
  });

const admitBody = (request: HttpClientRequest.HttpClientRequest) => {
  switch (request.body._tag) {
    case "Empty":
      return Effect.void;
    case "Uint8Array":
      return request.body.body.byteLength <= MAX_REQUEST_BODY_BYTES
        ? Effect.void
        : Effect.fail(
            unsendable(
              request,
              `The request body exceeds the ${MAX_REQUEST_BODY_BYTES / 1_048_576} MiB limit.`,
            ),
          );
    default:
      return Effect.fail(unsendable(request, "The API client carries buffered bodies only."));
  }
};

export type PinnedHttp = {
  readonly client: HttpClient.HttpClient;
  readonly syncTransport: Layer.Layer<SyncTransportService>;
  readonly setToken: (token: Redacted.Redacted<string> | null) => Effect.Effect<void>;
  readonly refreshing: Stream.Stream<boolean>;
  readonly liveAccessToken: (options: { readonly force: boolean }) => Effect.Effect<string | null>;
};

export const makePinnedHttp = Effect.fn("PinnedHttp.make")(function* (apiBaseUrl: string) {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const inner = yield* HttpClient.HttpClient;
  const state = yield* SubscriptionRef.make<TokenState>({ _tag: "pending", version: 0 });
  const turns = yield* Semaphore.make(REQUEST_CONCURRENCY);
  const snapshotTurns = yield* Semaphore.make(SNAPSHOT_DOWNLOAD_CONCURRENCY);

  const settled = SubscriptionRef.changes(state).pipe(
    Stream.filter(isSettled),
    Stream.runHead,
    Effect.flatMap(
      Option.match({ onNone: () => Effect.never, onSome: (held) => Effect.succeed(held) }),
    ),
  );

  const expire = (version: number | undefined) =>
    SubscriptionRef.update(state, (current) =>
      current._tag === "held" && (version === undefined || current.version === version)
        ? { _tag: "refreshing" as const, version: current.version }
        : current,
    );

  const pinnedFetch =
    (base: typeof fetch, held: Settled): typeof fetch =>
    (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== apiOrigin || url.username !== "" || url.password !== "") {
        return Promise.reject(
          new TypeError("The request is outside the configured API origin and was not sent."),
        );
      }
      const headers = new Headers(init?.headers);
      headers.delete("authorization");
      if (held._tag === "held") {
        headers.set("authorization", `Bearer ${Redacted.value(held.token)}`);
      }
      return base(url, { ...init, headers, credentials: "omit", redirect: "manual" });
    };

  const attempt = Effect.fnUntraced(function* <E, R>(
    send: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
    request: HttpClientRequest.HttpClientRequest,
    held: Settled,
  ) {
    const base = yield* FetchHttpClient.Fetch;
    const response = yield* turns.withPermits(1)(
      Effect.provideService(send, FetchHttpClient.Fetch, pinnedFetch(base, held)),
    );
    if (isRedirect(response.status)) {
      return yield* new HttpClientError.HttpClientError({
        reason: new HttpClientError.StatusCodeError({
          request,
          response,
          description: "The API answered with a redirect, which this client never follows.",
        }),
      });
    }
    return response;
  });

  const exchange = Effect.fnUntraced(function* <E, R>(
    send: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const held = yield* settled;
    const first = yield* attempt(send, request, held);
    if (first.status !== 401 || held._tag !== "held") return first;
    yield* expire(held.version);
    const renewed = yield* settled;
    if (renewed._tag !== "held") return first;
    yield* Effect.ignore(first.text);
    return yield* attempt(send, request, renewed);
  });

  const client = HttpClient.transform(
    inner,
    Effect.fnUntraced(function* (send, request) {
      yield* admitBody(request);
      const deadline = yield* RequestDeadline;
      const exchanged = exchange(send, request);
      return yield* Effect.timeoutOrElse(
        isSnapshotDownload(request) ? snapshotTurns.withPermits(1)(exchanged) : exchanged,
        {
          duration: deadline,
          orElse: () =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  description: `The API did not answer within ${Duration.toMillis(deadline)} ms.`,
                }),
              }),
            ),
        },
      );
    }),
  );

  return {
    client,
    syncTransport: SyncTransportService.layer(apiOrigin).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
    setToken: (token) =>
      SubscriptionRef.update(state, (current): TokenState =>
        token === null
          ? { _tag: "absent", version: current.version + 1 }
          : { _tag: "held", token, version: current.version + 1 },
      ),
    refreshing: SubscriptionRef.changes(state).pipe(
      Stream.map((current) => current._tag === "refreshing"),
      Stream.changes,
    ),
    liveAccessToken: ({ force }) =>
      (force ? expire(undefined) : Effect.void).pipe(
        Effect.andThen(Effect.timeoutOption(settled, LIVE_TOKEN_LIMIT)),
        Effect.map((current) =>
          Option.isSome(current) && current.value._tag === "held"
            ? Redacted.value(current.value.token)
            : null,
        ),
      ),
  } satisfies PinnedHttp;
}, Effect.provide(FetchHttpClient.layer));
