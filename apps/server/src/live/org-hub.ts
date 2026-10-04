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
import * as HttpBody from "effect/http/HttpBody";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { OrgHub, type OrgHubContract } from "../../api";
import type { CommitFanout } from "../inventory/model";
import {
  admissionFromHeaders,
  advanceCursor,
  closeExpiredSockets,
  closeIfExpired,
  closeSockets,
  decodeHubAttachment,
  helloFrame,
  publishToSockets,
  replicaTag,
  userTag,
  type HubAttachment,
  type HubCursor,
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
> & {
  readonly storage: Pick<Cloudflare.DurableObjectStorage, "getAlarm" | "setAlarm" | "deleteAlarm">;
};

export const makeOrgHub = Effect.fnUntraced(function* (
  state: HubState,
  platform: HubPlatform = workerdHubPlatform,
): Effect.fn.Return<OrgHubContract, never, RuntimeContext> {
  yield* state.setWebSocketAutoResponse(platform.autoResponse());
  const cursor = yield* Ref.make<HubCursor | undefined>(undefined);
  const advance = (next: HubCursor) =>
    Ref.modify(cursor, (current) => {
      const advanced = advanceCursor(current, next);
      return [advanced, advanced];
    });
  const socketsTagged = (tag?: string) =>
    state.getWebSockets(tag).pipe(Effect.map((sockets) => sockets.map(hubSocket)));
  const alarmBy = Effect.fn("OrgHub.alarmBy")(function* (expiresAt: number) {
    const scheduled = yield* state.storage.getAlarm();
    if (scheduled === null || scheduled > expiresAt) {
      yield* state.storage.setAlarm(expiresAt);
    }
  });

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
      yield* alarmBy(admission.expiresAt);
      const greeting = yield* advance({ epoch: admission.epoch, horizon: admission.horizon });
      server.ws.send(helloFrame(greeting));
      return platform.upgrade(client);
    }),
    publish: Effect.fnUntraced(function* (input: CommitFanout) {
      const now = yield* Clock.currentTimeMillis;
      yield* advance({ epoch: input.epoch, horizon: input.horizon });
      return publishToSockets(yield* socketsTagged(), input, now);
    }),
    revoke: (userId: string) =>
      socketsTagged(userTag(userId)).pipe(
        Effect.map((sockets) =>
          closeSockets(sockets, LIVE_SOCKET_CLOSE.revoked, "membership revoked"),
        ),
      ),
    alarm: Effect.fn("OrgHub.alarm")(function* () {
      const now = yield* Clock.currentTimeMillis;
      const earliest = closeExpiredSockets(yield* socketsTagged(), now);
      if (earliest === undefined) {
        yield* state.storage.deleteAlarm();
      } else {
        yield* state.storage.setAlarm(Math.max(earliest, now + 1));
      }
    }),
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
