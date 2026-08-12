import { SyncLiveAttachment, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

const decodeAttachment = Schema.decodeUnknownOption(SyncLiveAttachment);
const encodeLiveEvent = Schema.encodeSync(SyncLiveEvent);

const LIVE_ORGANIZATION_HEADER = "x-sync-organization-id";
const LIVE_USER_HEADER = "x-sync-user-id";
const LIVE_DEVICE_HEADER = "x-sync-device-id";
const LIVE_AUTH_EXPIRY_HEADER = "x-sync-authentication-expires-at";

export interface OrganizationStoreShape extends Cloudflare.DurableObjectShape {
  readonly exchange: (
    actor: SyncActor,
    request: SyncRequest,
  ) => Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError, RuntimeContext>;
}

export class OrganizationStore extends Cloudflare.DurableObject<
  OrganizationStore,
  OrganizationStoreShape
>()("OrganizationStore") {}

export const OrganizationStoreLive = OrganizationStore.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.sync(() => {
      const runtime = makeSyncRuntime(state.raw.storage);

      const broadcast = Effect.fn("OrganizationStore.broadcast")(function* (headCursor: number) {
        const encoded = JSON.stringify(
          encodeLiveEvent({ type: "invalidate", protocolVersion: 2, headCursor }),
        );
        for (const socket of yield* state.getWebSockets()) {
          const attachment = decodeAttachment(socket.deserializeAttachment());
          if (Option.isNone(attachment)) {
            yield* socket.close(1008, "Invalid connection metadata").pipe(Effect.ignoreCause);
            continue;
          }
          if (attachment.value.authenticationExpiresAt <= Date.now()) {
            yield* socket.close(1008, "Authentication expired").pipe(Effect.ignoreCause);
            continue;
          }
          yield* socket
            .send(encoded)
            .pipe(
              Effect.catchCause(() =>
                socket.close(1011, "Invalidation delivery failed").pipe(Effect.ignoreCause),
              ),
            );
        }
      });

      const exchange = Effect.fn("OrganizationStore.exchange")(function* (
        actor: SyncActor,
        request: SyncRequest,
      ) {
        const response = yield* Effect.tryPromise({
          try: () => runtime.runSync(actor, request),
          catch: (cause) =>
            cause instanceof SyncProtocolError
              ? cause
              : SyncDatabaseError.make({
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
        });
        if (
          response.acknowledgements.some((acknowledgement) => acknowledgement.status === "applied")
        )
          yield* broadcast(response.headCursor).pipe(
            Effect.ignoreCause({
              log: true,
              message: "Sync invalidation broadcast failed",
            }),
          );
        return response;
      });

      const acceptLive = Effect.fn("OrganizationStore.acceptLive")(function* (request: Request) {
        const organizationId = request.headers.get(LIVE_ORGANIZATION_HEADER);
        const userId = request.headers.get(LIVE_USER_HEADER);
        const deviceId = request.headers.get(LIVE_DEVICE_HEADER);
        const authenticationExpiresAt = Number(request.headers.get(LIVE_AUTH_EXPIRY_HEADER));
        if (
          !organizationId ||
          !userId ||
          !deviceId ||
          !Number.isSafeInteger(authenticationExpiresAt) ||
          authenticationExpiresAt <= Date.now()
        )
          return HttpServerResponse.text("Invalid live synchronization context", { status: 400 });

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
        const headCursor = yield* Effect.promise(() => runtime.headCursor(organizationId));
        yield* socket.send(
          JSON.stringify(encodeLiveEvent({ type: "hello", protocolVersion: 2, headCursor })),
        );
        const connectedSockets = (yield* state.getWebSockets()).length;
        yield* Effect.logInfo("Live synchronization connected").pipe(
          Effect.annotateLogs({
            event: "sync.live_connected",
            organizationId,
            deviceId,
            headCursor,
            connectedSockets,
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
        }),
        exchange,
        webSocketMessage: (socket: Cloudflare.WebSocket) =>
          // This protocol is server-to-client only. Treat client payloads as abuse.
          socket.close(1008, "Client messages are not supported"),
        webSocketClose: () => Effect.void,
      };
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
  // Authentication credentials terminate at the Worker boundary. The
  // organization object receives only identity already authorized by middleware.
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
