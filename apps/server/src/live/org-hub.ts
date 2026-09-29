import {
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PING,
  LIVE_SOCKET_PONG,
  LIVE_SOCKET_PROTOCOL,
} from "@store/contracts";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { OrgHub, type OrgHubContract } from "../../api";
import {
  admissionFromHeaders,
  advanceCursor,
  closeIfExpired,
  closeSockets,
  decodeHubAttachment,
  helloFrame,
  publishToSockets,
  replicaTag,
  userTag,
  type HubAttachment,
  type HubCursor,
  type HubPublish,
  type HubSocket,
} from "./hub-core";

const hubSocket = (socket: Cloudflare.WebSocket): HubSocket => ({
  attachment: () => Option.getOrUndefined(decodeHubAttachment(socket.deserializeAttachment())),
  remember: (attachment) => socket.serializeAttachment<HubAttachment>(attachment),
  send: (text) => socket.ws.send(text),
  close: (code, reason) => socket.ws.close(code, reason),
});

const badAdmission = () =>
  HttpServerResponse.text("The live hub admission is invalid.", { status: 400 });

export interface HubPlatform {
  readonly autoResponse: () => WebSocketRequestResponsePair;
  readonly pair: () => { readonly client: WebSocket; readonly server: Cloudflare.WebSocket };
  readonly upgrade: (client: WebSocket) => HttpServerResponse.HttpServerResponse;
}

const workerdHubPlatform: HubPlatform = {
  autoResponse: () => new WebSocketRequestResponsePair(LIVE_SOCKET_PING, LIVE_SOCKET_PONG),
  pair: () => {
    const pair = new WebSocketPair();
    return {
      client: pair[0],
      // SAFETY: lib.webworker's WebSocket declaration shadows @cloudflare/workers-types here; workerd hands back its own socket.
      server: Cloudflare.fromWebSocket(pair[1] as Cloudflare.RawWebSocket),
    };
  },
  upgrade: (client) =>
    HttpServerResponse.setBody(
      HttpServerResponse.empty({ status: 101 }),
      HttpBody.raw(
        new Response(null, {
          status: 101,
          webSocket: client,
          headers: { "sec-websocket-protocol": LIVE_SOCKET_PROTOCOL },
        }),
      ),
    ),
};

export type HubState = Pick<
  Cloudflare.DurableObjectState["Service"],
  "acceptWebSocket" | "getWebSockets" | "setWebSocketAutoResponse"
>;

export const makeOrgHub = (
  state: HubState,
  platform: HubPlatform = workerdHubPlatform,
): Effect.Effect<OrgHubContract, never, RuntimeContext> =>
  Effect.gen(function* () {
    yield* state.setWebSocketAutoResponse(platform.autoResponse());
    let cursor: HubCursor | undefined;
    const socketsTagged = (tag?: string) =>
      state.getWebSockets(tag).pipe(Effect.map((sockets) => sockets.map(hubSocket)));

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const admission = admissionFromHeaders(request.headers);
        if (admission === undefined || request.headers.upgrade?.toLowerCase() !== "websocket") {
          return badAdmission();
        }
        closeSockets(
          yield* socketsTagged(replicaTag(admission.replicaId)),
          LIVE_SOCKET_CLOSE.normal,
          "replaced",
        );
        const { client, server } = platform.pair();
        yield* state.acceptWebSocket(server, [
          replicaTag(admission.replicaId),
          userTag(admission.userId),
        ]);
        server.serializeAttachment<HubAttachment>({
          replicaId: admission.replicaId,
          userId: admission.userId,
          expiresAt: admission.expiresAt,
          maxBytes: admission.maxBytes,
          epoch: admission.epoch,
        });
        cursor = advanceCursor(cursor, { epoch: admission.epoch, horizon: admission.horizon });
        server.ws.send(helloFrame(cursor));
        return platform.upgrade(client);
      }),
      publish: (input: HubPublish) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          cursor = advanceCursor(cursor, { epoch: input.epoch, horizon: input.horizon });
          return publishToSockets(yield* socketsTagged(), input, now);
        }),
      revoke: (userId: string) =>
        socketsTagged(userTag(userId)).pipe(
          Effect.map((sockets) =>
            closeSockets(sockets, LIVE_SOCKET_CLOSE.revoked, "membership revoked"),
          ),
        ),
      webSocketMessage: (socket: Cloudflare.WebSocket) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            closeIfExpired(hubSocket(socket), now);
          }),
        ),
      webSocketClose: (socket: Cloudflare.WebSocket) =>
        Effect.sync(() => {
          closeSockets([hubSocket(socket)], LIVE_SOCKET_CLOSE.normal, "closed");
        }),
    } satisfies OrgHubContract;
  });

export const OrgHubLive = OrgHub.make(Effect.map(Cloudflare.DurableObjectState, makeOrgHub));
