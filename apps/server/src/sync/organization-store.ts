import {
  SyncClientFrame,
  SyncLiveAttachment,
  SyncLiveEvent,
  SyncRequest,
  SyncResponse,
  SyncServerFrame,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime, syncRuntimeExchange, syncRuntimeHeadCursor } from "./runtime";

const decodeAttachment = Schema.decodeUnknownOption(SyncLiveAttachment);
const encodeLiveEvent = Schema.encodeSync(SyncLiveEvent);
const encodeServerFrame = Schema.encodeSync(SyncServerFrame);
const decodeClientFrame = Schema.decodeUnknownOption(SyncClientFrame);

const LIVE_ORGANIZATION_HEADER = "x-sync-organization-id";
const LIVE_USER_HEADER = "x-sync-user-id";
const LIVE_DEVICE_HEADER = "x-sync-device-id";
const LIVE_AUTH_EXPIRY_HEADER = "x-sync-authentication-expires-at";

export interface OrganizationStoreContract {
  readonly exchange: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError, RuntimeContext>;
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Cloudflare.DurableObjectState | RuntimeContext
  >;
  readonly webSocketMessage: (
    socket: Cloudflare.WebSocket,
    message: string | ArrayBuffer,
  ) => Effect.Effect<void>;
  readonly webSocketClose: () => Effect.Effect<void>;
}

export class OrganizationStore extends Cloudflare.DurableObject<
  OrganizationStore,
  OrganizationStoreContract
>()("ORGANIZATION_STORE") {}

const socketText = (message: string | ArrayBuffer) =>
  message instanceof ArrayBuffer ? new TextDecoder().decode(message) : message;

const ignoreNonInterruptCause =
  (message?: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | void, E, R> =>
    effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
        return message
          ? Effect.logError(message).pipe(Effect.annotateLogs({ cause: Cause.pretty(cause) }))
          : Effect.void;
      }),
    );

export const OrganizationStoreLive = OrganizationStore.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      yield* Effect.void;
      const runtime = makeSyncRuntime(state.raw.storage);

      const broadcast = Effect.fn("OrganizationStore.broadcast")(function* (
        headCursor: number,
        exceptConnectionId?: string,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const encoded = JSON.stringify(
          encodeLiveEvent({ type: "invalidate", protocolVersion: 2, headCursor }),
        );
        for (const socket of state.raw.getWebSockets().map(Cloudflare.fromWebSocket)) {
          const attachment = decodeAttachment(socket.deserializeAttachment());
          if (Option.isNone(attachment)) {
            yield* socket
              .close(1008, "Invalid connection metadata")
              .pipe(ignoreNonInterruptCause());
            continue;
          }
          if (exceptConnectionId && attachment.value.connectionId === exceptConnectionId) continue;
          if (attachment.value.authenticationExpiresAt <= now) {
            yield* socket.close(1008, "Authentication expired").pipe(ignoreNonInterruptCause());
            continue;
          }
          yield* socket.send(encoded).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
              return socket
                .close(1011, "Invalidation delivery failed")
                .pipe(ignoreNonInterruptCause());
            }),
          );
        }
      });

      const runExchange = Effect.fn("OrganizationStore.runExchange")(function* (
        actor: SyncActor,
        request: SyncRequest,
        exceptConnectionId?: string,
      ) {
        const response = yield* syncRuntimeExchange(runtime, actor, request);
        if (
          response.acknowledgements.some((acknowledgement) => acknowledgement.status === "applied")
        )
          yield* broadcast(response.headCursor, exceptConnectionId).pipe(
            ignoreNonInterruptCause("Sync invalidation broadcast failed"),
          );
        return response;
      });

      const exchange = Effect.fn("OrganizationStore.exchange")(function* (
        actor: SyncActor,
        request: SyncRequest,
      ) {
        return yield* runExchange(actor, request);
      });

      const acceptLive = Effect.fn("OrganizationStore.acceptLive")(function* (request: Request) {
        const now = yield* Clock.currentTimeMillis;
        const organizationId = request.headers.get(LIVE_ORGANIZATION_HEADER);
        const userId = request.headers.get(LIVE_USER_HEADER);
        const deviceId = request.headers.get(LIVE_DEVICE_HEADER);
        const authenticationExpiresAt = Number(request.headers.get(LIVE_AUTH_EXPIRY_HEADER));
        if (
          !organizationId ||
          !userId ||
          !deviceId ||
          !Number.isSafeInteger(authenticationExpiresAt) ||
          authenticationExpiresAt <= now
        )
          return HttpServerResponse.text("Invalid live sync context", { status: 400 });

        const headCursor = yield* syncRuntimeHeadCursor(runtime, organizationId);
        const [response, socket] = yield* Cloudflare.upgrade();
        socket.serializeAttachment(
          SyncLiveAttachment.make({
            organizationId,
            userId,
            deviceId,
            connectionId: crypto.randomUUID(),
            protocolVersion: 2,
            authenticationExpiresAt,
          }),
        );
        yield* socket.send(
          JSON.stringify(encodeLiveEvent({ type: "hello", protocolVersion: 2, headCursor })),
        );
        yield* Effect.logInfo("Live sync connected").pipe(
          Effect.annotateLogs({
            event: "sync.live_connected",
            organizationId,
            deviceId,
            headCursor,
            connectedSockets: state.raw.getWebSockets().length,
          }),
        );
        return response;
      });

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
          return webRequest.headers.get("Upgrade")?.toLowerCase() === "websocket"
            ? yield* acceptLive(webRequest)
            : HttpServerResponse.text("Not found", { status: 404 });
        }).pipe(
          Effect.catchTag("SyncDatabaseError", (error) =>
            Effect.logError("Live sync connection failed", error).pipe(
              Effect.as(
                HttpServerResponse.text("Live sync is temporarily unavailable", { status: 503 }),
              ),
            ),
          ),
        ),
        exchange,
        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const attachment = decodeAttachment(socket.deserializeAttachment());
            if (Option.isNone(attachment))
              return yield* socket.close(1008, "Invalid connection metadata");
            if (attachment.value.authenticationExpiresAt <= now)
              return yield* socket.close(1008, "Authentication expired");

            let parsed: unknown;
            try {
              parsed = JSON.parse(socketText(message));
            } catch {
              return yield* socket.close(1002, "Malformed live frame");
            }
            const frame = decodeClientFrame(parsed);
            if (Option.isNone(frame)) return yield* socket.close(1008, "Unsupported live frame");

            if (frame.value.type === "ping") {
              yield* socket.send(
                JSON.stringify(
                  encodeServerFrame({ type: "pong", requestId: frame.value.requestId }),
                ),
              );
              return;
            }

            const result = yield* runExchange(
              { organizationId: attachment.value.organizationId, userId: attachment.value.userId },
              frame.value.request,
              attachment.value.connectionId,
            ).pipe(Effect.result);
            if (result._tag === "Success") {
              yield* socket.send(
                JSON.stringify(
                  encodeServerFrame({
                    type: "exchange-result",
                    requestId: frame.value.requestId,
                    response: result.success,
                  }),
                ),
              );
              return;
            }
            const error = result.failure;
            const protocol = error instanceof SyncProtocolError ? error : undefined;
            yield* socket.send(
              JSON.stringify(
                encodeServerFrame({
                  type: "exchange-error",
                  requestId: frame.value.requestId,
                  code: protocol?.code ?? "SYNC_UNAVAILABLE",
                  message:
                    protocol?.message ?? (error instanceof Error ? error.message : "Sync failed."),
                  retryable: protocol === undefined,
                }),
              ),
            );
          }),
        webSocketClose: () => Effect.void,
      } satisfies OrganizationStoreContract;
    });
  }),
);

export type OrganizationStoreNamespace = Effect.Success<typeof OrganizationStore>;

export const connectWithOrganizationStore = Effect.fn("OrganizationStore.connectLive")(function* (
  namespace: OrganizationStoreNamespace,
  input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly authenticationExpiresAt: number;
  },
): Effect.fn.Return<HttpServerResponse.HttpServerResponse> {
  const headers = new Headers({ Upgrade: "websocket" });
  headers.set(LIVE_ORGANIZATION_HEADER, input.organizationId);
  headers.set(LIVE_USER_HEADER, input.userId);
  headers.set(LIVE_DEVICE_HEADER, input.deviceId);
  headers.set(LIVE_AUTH_EXPIRY_HEADER, String(input.authenticationExpiresAt));
  return yield* namespace
    .getByName(input.organizationId)
    .fetch(HttpServerRequest.fromWeb(new Request("https://organization-store/live", { headers })))
    .pipe(Effect.orDie);
});
