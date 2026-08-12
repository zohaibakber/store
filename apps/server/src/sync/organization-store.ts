import { SyncLiveAttachment, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { SyncDatabaseError, SyncProtocolCode, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { makeSyncRuntime } from "./runtime";

// Schema classes and typed errors do not survive structured clone.
export const SyncExchangePayload = Schema.Struct({
  actor: Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
  request: SyncRequest,
});

export const SyncExchangeResult = Schema.Union([
  Schema.TaggedStruct("Success", { response: SyncResponse }),
  Schema.TaggedStruct("ProtocolFailure", { code: SyncProtocolCode, message: Schema.String }),
  Schema.TaggedStruct("DatabaseFailure", { message: Schema.String }),
]);

const decodePayload = Schema.decodeUnknownSync(SyncExchangePayload);
const encodeResult = Schema.encodeSync(SyncExchangeResult);
const decodeAttachment = Schema.decodeUnknownOption(SyncLiveAttachment);
const encodeLiveEvent = Schema.encodeSync(SyncLiveEvent);

const LIVE_ORGANIZATION_HEADER = "x-sync-organization-id";
const LIVE_USER_HEADER = "x-sync-user-id";
const LIVE_DEVICE_HEADER = "x-sync-device-id";
const LIVE_AUTH_EXPIRY_HEADER = "x-sync-authentication-expires-at";

export class OrganizationStore extends Cloudflare.DurableObject<
  OrganizationStore,
  Cloudflare.DurableObjectShape
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
            yield* socket.close(1008, "Invalid connection metadata");
            continue;
          }
          if (attachment.value.authenticationExpiresAt <= Date.now()) {
            yield* socket.close(1008, "Authentication expired");
            continue;
          }
          yield* socket.send(encoded);
        }
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
          if (webRequest.headers.get("Upgrade")?.toLowerCase() === "websocket")
            return yield* acceptLive(webRequest);

          const payload = decodePayload(yield* Effect.promise(() => webRequest.json()));
          const result = yield* Effect.result(
            Effect.tryPromise({
              try: () => runtime.runSync(payload.actor, payload.request),
              catch: (cause) => cause,
            }),
          );
          if (result._tag === "Success") {
            const response = result.success;
            if (
              response.acknowledgements.some(
                (acknowledgement) => acknowledgement.status === "applied",
              )
            )
              yield* broadcast(response.headCursor);
            return HttpServerResponse.fromWeb(
              Response.json(encodeResult({ _tag: "Success", response })),
            );
          }
          const cause = result.failure;
          if (cause instanceof SyncProtocolError)
            return HttpServerResponse.fromWeb(
              Response.json(
                encodeResult({
                  _tag: "ProtocolFailure",
                  code: cause.code,
                  message: cause.message,
                }),
              ),
            );
          const message = cause instanceof Error ? cause.message : String(cause);
          return HttpServerResponse.fromWeb(
            Response.json(encodeResult({ _tag: "DatabaseFailure", message })),
          );
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket) =>
          // This protocol is server-to-client only. Treat client payloads as abuse.
          socket.close(1008, "Client messages are not supported"),
        webSocketClose: () => Effect.void,
      };
    });
  }),
);

const encodePayload = Schema.encodeSync(SyncExchangePayload);

export type OrganizationStoreNamespace = Effect.Success<typeof OrganizationStore>;

export const exchangeWithOrganizationStore = Effect.fn("OrganizationStore.exchange")(function* (
  namespace: OrganizationStoreNamespace,
  actor: SyncActor,
  request: SyncRequest,
): Effect.fn.Return<SyncResponse, SyncProtocolError | SyncDatabaseError> {
  const stub = namespace.getByName(actor.organizationId);
  const response = yield* stub
    .fetch(
      HttpServerRequest.fromWeb(
        new Request("https://organization-store/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(encodePayload({ actor, request })),
        }),
      ),
    )
    .pipe(Effect.orDie);
  const webResponse = HttpServerResponse.toWeb(response);
  const body = yield* Effect.promise(() => webResponse.json());
  const result = yield* Schema.decodeUnknownEffect(SyncExchangeResult)(body).pipe(Effect.orDie);
  if (result._tag === "ProtocolFailure")
    return yield* Effect.fail(
      SyncProtocolError.make({ code: result.code, message: result.message }),
    );
  if (result._tag === "DatabaseFailure")
    return yield* Effect.fail(SyncDatabaseError.make({ message: result.message }));
  return result.response;
});

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
