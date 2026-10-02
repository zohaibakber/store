import {
  decodeSyncLiveServerFrame,
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PATH,
  LIVE_SOCKET_PING,
  LIVE_SOCKET_PONG,
  LIVE_SOCKET_PROTOCOL,
  liveBearerProtocol,
  type SyncLiveServerFrame,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Socket from "effect/unstable/socket/Socket";

export type LiveNetworkSignal = {
  readonly isOnline: () => boolean;
  readonly subscribe: (listener: (online: boolean) => void) => () => void;
};

export type LiveSocketHost = {
  readonly apiBaseUrl: string;
  readonly replicaId: string;
  readonly accessToken: (options: { readonly force: boolean }) => Promise<string | null>;
  readonly webSocket?: Socket.WebSocketConstructor["Service"];
  readonly network?: LiveNetworkSignal;
};

type LiveSocketHandlers = {
  readonly onFrame: (frame: SyncLiveServerFrame) => Effect.Effect<void>;
  readonly setConnected: (connected: boolean) => Effect.Effect<void>;
  readonly maxBytes: Effect.Effect<number | undefined>;
};

type LiveSocket = {
  readonly run: Effect.Effect<never>;
  readonly nudge: Effect.Effect<void>;
};

const LIVE_SOCKET_POLICY = {
  openTimeoutMillis: 15_000,
  keepaliveMillis: 30_000,
  pongTimeoutMillis: 10_000,
  renewBeforeExpiryMillis: 2 * 60_000,
  backoffMillis: [1_000, 2_000, 5_000, 15_000, 30_000, 60_000],
} as const;

class LiveSocketStale extends Schema.TaggedError<LiveSocketStale>()("LiveSocketStale", {
  message: Schema.String,
}) {}

class LiveSocketOffline extends Schema.TaggedError<LiveSocketOffline>()("LiveSocketOffline", {
  message: Schema.String,
}) {}

const JwtClaims = Schema.Struct({ exp: Schema.optionalKey(Schema.Number) });
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(JwtClaims));

const accessTokenExpiresAt = (token: string): number | undefined => {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  const json = Encoding.decodeBase64UrlString(payload);
  if (Result.isFailure(json)) return undefined;
  const claims = decodeClaims(json.success);
  return Option.isSome(claims) && claims.value.exp !== undefined
    ? claims.value.exp * 1_000
    : undefined;
};

const liveSocketUrl = (
  apiBaseUrl: string,
  replicaId: string,
  maxBytes: number | undefined,
): string => {
  const root = apiBaseUrl.replace(/\/+$/u, "");
  const origin = root.endsWith("/api") ? root.slice(0, -"/api".length) : root;
  const url = new URL(`${origin}${LIVE_SOCKET_PATH}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("replicaId", replicaId);
  if (maxBytes !== undefined) url.searchParams.set("maxBytes", String(maxBytes));
  return url.href;
};

const browserNetworkSignal = (): LiveNetworkSignal | undefined => {
  if (!("addEventListener" in globalThis) || !("navigator" in globalThis)) return undefined;
  const navigator = globalThis.navigator;
  if (!("onLine" in navigator)) return undefined;
  return {
    isOnline: () => navigator.onLine,
    subscribe: (listener) => {
      const online = () => listener(true);
      const offline = () => listener(false);
      globalThis.addEventListener("online", online);
      globalThis.addEventListener("offline", offline);
      return () => {
        globalThis.removeEventListener("online", online);
        globalThis.removeEventListener("offline", offline);
      };
    },
  };
};

const sleepJittered = (millis: number): Effect.Effect<void> =>
  Effect.void.pipe(Effect.schedule(Schedule.jittered(Schedule.duration(Duration.millis(millis)))));

const textOf = (data: string | Uint8Array): string =>
  data instanceof Uint8Array ? new TextDecoder().decode(data) : data;

type SessionEnd = "renew" | "closed" | "reauthenticate" | "refused";

const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([
  LIVE_SOCKET_CLOSE.tokenExpired,
  LIVE_SOCKET_CLOSE.revoked,
]);

type SessionFailure = Socket.SocketError | LiveSocketStale | LiveSocketOffline;

const endOf = (error: SessionFailure): SessionEnd => {
  if (error._tag !== "SocketError") return "closed";
  const reason = error.reason;
  if (reason._tag === "SocketCloseError" && AUTH_CLOSE_CODES.has(reason.code)) {
    return "reauthenticate";
  }
  return reason._tag === "SocketOpenError" && reason.kind === "Unknown" ? "refused" : "closed";
};

export const makeLiveSocket = (
  host: LiveSocketHost,
  handlers: LiveSocketHandlers,
): Effect.Effect<LiveSocket> =>
  Effect.gen(function* () {
    const nudges = yield* Queue.sliding<void>(1);
    const attempts = yield* Ref.make(0);
    const forceRefresh = yield* Ref.make(false);
    const refusalRefreshSpent = yield* Ref.make(false);
    const network = host.network ?? browserNetworkSignal();
    const online = yield* SubscriptionRef.make(network?.isOnline() ?? true);
    const webSocketLayer =
      host.webSocket === undefined
        ? Socket.layerWebSocketConstructorGlobal
        : Layer.succeed(Socket.WebSocketConstructor, host.webSocket);

    const waitUntil = (wanted: boolean) =>
      SubscriptionRef.changes(online).pipe(
        Stream.filter((value) => value === wanted),
        Stream.runHead,
        Effect.asVoid,
      );

    const nearExpiry = (token: string) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((now) => {
          const expiresAt = accessTokenExpiresAt(token);
          return (
            expiresAt !== undefined && expiresAt - now <= LIVE_SOCKET_POLICY.renewBeforeExpiryMillis
          );
        }),
      );

    const backOff = Effect.gen(function* () {
      const attempt = yield* Ref.getAndUpdate(attempts, (n) => n + 1);
      const ladder = LIVE_SOCKET_POLICY.backoffMillis;
      const delay = ladder[Math.min(attempt, ladder.length - 1)] ?? 60_000;
      yield* Effect.raceFirst(sleepJittered(delay), Queue.take(nudges));
    });

    const session = (token: string) =>
      Effect.gen(function* () {
        const maxBytes = yield* handlers.maxBytes;
        const socket = yield* Socket.makeWebSocket(
          liveSocketUrl(host.apiBaseUrl, host.replicaId, maxBytes),
          {
            protocols: [LIVE_SOCKET_PROTOCOL, liveBearerProtocol(token)],
            openTimeout: Duration.millis(LIVE_SOCKET_POLICY.openTimeoutMillis),
          },
        );
        const reader = yield* socket.reader;
        const writer = yield* socket.writer;
        const heardAt = yield* Ref.make(yield* Clock.currentTimeMillis);
        yield* Ref.set(attempts, 0);
        yield* handlers.setConnected(true);

        const receive = (data: string | Uint8Array) =>
          Effect.gen(function* () {
            yield* Ref.set(heardAt, yield* Clock.currentTimeMillis);
            yield* Ref.set(refusalRefreshSpent, false);
            const text = textOf(data);
            if (text === LIVE_SOCKET_PONG) return;
            const frame = decodeSyncLiveServerFrame(text);
            if (Option.isSome(frame)) yield* handlers.onFrame(frame.value);
          });

        const probe = Effect.gen(function* () {
          const sentAt = yield* Clock.currentTimeMillis;
          yield* writer.write(LIVE_SOCKET_PING);
          yield* Effect.sleep(Duration.millis(LIVE_SOCKET_POLICY.pongTimeoutMillis));
          if ((yield* Ref.get(heardAt)) < sentAt) {
            return yield* Effect.fail(
              LiveSocketStale.make({ message: "The live socket stopped answering pings." }),
            );
          }
        });

        const reading: Effect.Effect<SessionEnd, Socket.SocketError> = Effect.forever(
          reader.pull.pipe(Effect.flatMap((chunk) => Effect.forEach(chunk, receive))),
        );
        const keepalive: Effect.Effect<SessionEnd, Socket.SocketError | LiveSocketStale> =
          Effect.forever(
            Effect.sleep(Duration.millis(LIVE_SOCKET_POLICY.keepaliveMillis)).pipe(
              Effect.andThen(probe),
            ),
          );
        const probes: Effect.Effect<SessionEnd, Socket.SocketError | LiveSocketStale> =
          Effect.forever(Queue.take(nudges).pipe(Effect.andThen(probe)));
        const offline = waitUntil(false).pipe(
          Effect.andThen(
            Effect.fail(LiveSocketOffline.make({ message: "The network is offline." })),
          ),
        );
        const expiresAt = accessTokenExpiresAt(token);
        const now = yield* Clock.currentTimeMillis;
        const renewIn =
          expiresAt === undefined
            ? undefined
            : expiresAt - now - LIVE_SOCKET_POLICY.renewBeforeExpiryMillis;
        const renewal: Effect.Effect<SessionEnd> =
          renewIn === undefined || renewIn <= 0
            ? Effect.never
            : Effect.sleep(Duration.millis(renewIn)).pipe(Effect.as("renew" as const));

        return yield* Effect.raceAllFirst([reading, keepalive, probes, offline, renewal]);
      }).pipe(
        Effect.scoped,
        Effect.provide(webSocketLayer),
        Effect.ensuring(handlers.setConnected(false)),
      );

    const pass = Effect.gen(function* () {
      if (!(yield* SubscriptionRef.get(online))) yield* waitUntil(true);
      const force = yield* Ref.getAndSet(forceRefresh, false);
      const requestToken = (refresh: boolean) =>
        Effect.tryPromise(() => host.accessToken({ force: refresh })).pipe(
          Effect.orElseSucceed(() => null),
        );
      const offered = yield* requestToken(force);
      const token =
        offered !== null && !force && (yield* nearExpiry(offered))
          ? yield* requestToken(true)
          : offered;
      if (token === null) return yield* backOff;
      const ended = yield* session(token).pipe(
        Effect.catch((error) => Effect.succeed(endOf(error))),
      );
      if (ended === "renew") return;
      if (ended === "reauthenticate") yield* Ref.set(forceRefresh, true);
      if (ended === "refused" && !(yield* Ref.getAndSet(refusalRefreshSpent, true))) {
        yield* Ref.set(forceRefresh, true);
      }
      yield* backOff;
    });

    const networkChanges =
      network === undefined
        ? Effect.void
        : Stream.callback<boolean>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => network.subscribe((value) => Queue.offerUnsafe(queue, value))),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ).pipe(
            Stream.runForEach((value) =>
              SubscriptionRef.set(online, value).pipe(
                Effect.andThen(value ? Queue.offer(nudges, undefined) : Effect.void),
              ),
            ),
            Effect.forkScoped,
          );

    const run = Effect.gen(function* () {
      yield* networkChanges;
      return yield* Effect.forever(pass);
    }).pipe(Effect.scoped);

    return {
      run,
      nudge: Queue.offer(nudges, undefined).pipe(Effect.asVoid),
    };
  });
