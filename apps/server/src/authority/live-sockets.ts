import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  compareDecimalSequence,
  LIVE_SOCKET_CLOSE,
  LIVE_SOCKET_PING,
  LIVE_SOCKET_PONG,
  LIVE_SOCKET_PROTOCOL,
  OPERATIONAL_SUBSCRIPTION,
  SYNC_SCHEMA_VERSION,
  type SyncProtocolCode,
} from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { publicError } from "../http/errors";
import { SYNC_STATUS } from "../http/sync-errors";
import type { Actor } from "./engine";
import type { AuthorityReply, LiveHorizonReply } from "./facade";
import type { CommitFanout } from "./frames";

export const LiveAttachment = Schema.Struct({
  replicaId: Schema.String,
  userId: Schema.String,
  expiresAt: Schema.Number,
  maxBytes: Schema.NullOr(Schema.Number),
  epoch: Schema.String,
});
export type LiveAttachment = typeof LiveAttachment.Type;

const decodeLiveAttachment = Schema.decodeUnknownOption(LiveAttachment);

interface LiveCursor {
  readonly epoch: string;
  readonly horizon: string;
}

interface LiveSocket {
  readonly attachment: () => LiveAttachment | undefined;
  readonly remember: (attachment: LiveAttachment) => void;
  readonly send: (text: string) => void;
  readonly close: (code: number, reason: string) => void;
}

const ADMISSION_HEADERS = {
  organizationId: "x-tabaaq-live-organization",
  replicaId: "x-tabaaq-live-replica",
  userId: "x-tabaaq-live-user",
  expiresAt: "x-tabaaq-live-expires",
  maxBytes: "x-tabaaq-live-max-bytes",
} as const;

export interface LiveAdmission {
  readonly organizationId: string;
  readonly replicaId: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly maxBytes: number | null;
}

const NonEmpty = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const WholeNumber = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

const AdmissionHeaders = Schema.Struct({
  [ADMISSION_HEADERS.organizationId]: NonEmpty,
  [ADMISSION_HEADERS.replicaId]: NonEmpty,
  [ADMISSION_HEADERS.userId]: NonEmpty,
  [ADMISSION_HEADERS.expiresAt]: WholeNumber,
  [ADMISSION_HEADERS.maxBytes]: WholeNumber,
});

const decodeAdmissionHeaders = Schema.decodeUnknownOption(AdmissionHeaders);

export const admissionHeaders = (admission: LiveAdmission) => ({
  [ADMISSION_HEADERS.organizationId]: admission.organizationId,
  [ADMISSION_HEADERS.replicaId]: admission.replicaId,
  [ADMISSION_HEADERS.userId]: admission.userId,
  [ADMISSION_HEADERS.expiresAt]: String(admission.expiresAt),
  [ADMISSION_HEADERS.maxBytes]: String(admission.maxBytes ?? 0),
});

const admissionFromHeaders = (
  headers: Readonly<Record<string, string | undefined>>,
): LiveAdmission | undefined =>
  decodeAdmissionHeaders(headers).pipe(
    Option.map((value) => ({
      organizationId: value[ADMISSION_HEADERS.organizationId],
      replicaId: value[ADMISSION_HEADERS.replicaId],
      userId: value[ADMISSION_HEADERS.userId],
      expiresAt: value[ADMISSION_HEADERS.expiresAt],
      maxBytes: value[ADMISSION_HEADERS.maxBytes] === 0 ? null : value[ADMISSION_HEADERS.maxBytes],
    })),
    Option.getOrUndefined,
  );

export const withoutAdmissionHeaders = (headers: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => !name.startsWith("x-tabaaq-live-")),
  );

const replicaTag = (replicaId: string) => `replica:${replicaId}`;

const json = (value: string) => JSON.stringify(value);

const helloFrame = (cursor: LiveCursor) =>
  `{"_tag":"hello","epoch":${json(cursor.epoch)},"horizon":${json(cursor.horizon)}}`;

const wakeFrame = (cursor: LiveCursor) =>
  `{"_tag":"wake","epoch":${json(cursor.epoch)},"horizon":${json(cursor.horizon)}}`;

const resumeFrame = (cursor: LiveCursor) =>
  `{"_tag":"resume","epoch":${json(cursor.epoch)},"reason":"epoch_changed","fromCommitSequence":"0"}`;

const transactionsFrame = (publish: CommitFanout) =>
  `{"_tag":"transactions","epoch":${json(publish.epoch)},"subscription":${json(OPERATIONAL_SUBSCRIPTION)},"schemaVersion":${SYNC_SCHEMA_VERSION},"fromCommitSequence":${json(publish.horizon)},"toCommitSequence":${json(publish.horizon)},"transactions":[${publish.group}]}`;

const carriesGroup = (publish: CommitFanout, attachment: LiveAttachment): boolean =>
  publish.group !== "" &&
  (attachment.maxBytes === null || publish.byteLength <= attachment.maxBytes);

const advanceCursor = (current: LiveCursor | undefined, next: LiveCursor): LiveCursor =>
  current === undefined ||
  current.epoch !== next.epoch ||
  compareDecimalSequence(next.horizon, current.horizon) > 0
    ? next
    : current;

const trySilentClose = (socket: LiveSocket, code: number, reason: string) => {
  try {
    socket.close(code, reason);
  } catch {
    return;
  }
};

const trySend = (socket: LiveSocket, text: string) => {
  try {
    socket.send(text);
  } catch {
    trySilentClose(socket, LIVE_SOCKET_CLOSE.normal, "send failed");
  }
};

const closeIfExpired = (socket: LiveSocket, now: number): boolean => {
  const attachment = socket.attachment();
  if (attachment !== undefined && attachment.expiresAt > now) return false;
  trySilentClose(socket, LIVE_SOCKET_CLOSE.tokenExpired, "token expired");
  return true;
};

const closeExpiredSockets = (
  sockets: ReadonlyArray<LiveSocket>,
  now: number,
): number | undefined => {
  let earliest: number | undefined;
  for (const socket of sockets) {
    if (closeIfExpired(socket, now)) continue;
    const expiresAt = socket.attachment()?.expiresAt;
    if (expiresAt !== undefined && (earliest === undefined || expiresAt < earliest)) {
      earliest = expiresAt;
    }
  }
  return earliest;
};

const publishToSockets = (
  sockets: ReadonlyArray<LiveSocket>,
  publish: CommitFanout,
  now: number,
): number => {
  const cursor = { epoch: publish.epoch, horizon: publish.horizon };
  let frame: string | undefined;
  let wake: string | undefined;
  let delivered = 0;
  for (const socket of sockets) {
    if (closeIfExpired(socket, now)) continue;
    const attachment = socket.attachment();
    if (attachment === undefined) continue;
    if (attachment.epoch !== publish.epoch) {
      socket.remember({ ...attachment, epoch: publish.epoch });
    }
    if (attachment.replicaId === publish.originReplicaId) continue;
    if (attachment.epoch !== publish.epoch) {
      trySend(socket, resumeFrame(cursor));
    } else if (carriesGroup(publish, attachment)) {
      frame ??= transactionsFrame(publish);
      trySend(socket, frame);
    } else {
      wake ??= wakeFrame(cursor);
      trySend(socket, wake);
    }
    delivered += 1;
  }
  return delivered;
};

const closeSockets = (sockets: ReadonlyArray<LiveSocket>, code: number, reason: string) => {
  for (const socket of sockets) trySilentClose(socket, code, reason);
  return sockets.length;
};

const liveSocket = (socket: Cloudflare.WebSocket): LiveSocket => ({
  attachment: () => Option.getOrUndefined(decodeLiveAttachment(socket.deserializeAttachment())),
  remember: (attachment) => socket.serializeAttachment<LiveAttachment>(attachment),
  send: (text) => socket.ws.send(text),
  close: (code, reason) => socket.ws.close(code, reason),
});

const refuse = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe(publicError(code, message), { status });

const liveStatus = (code: SyncProtocolCode) =>
  code === "ORGANIZATION_MISMATCH" ? 409 : SYNC_STATUS[code];

export interface LivePlatform {
  readonly autoResponse: () => WebSocketRequestResponsePair;
  readonly pair: () => { readonly client: WebSocket; readonly server: Cloudflare.WebSocket };
  readonly upgrade: (client: WebSocket) => HttpServerResponse.HttpServerResponse;
}

const workerdLivePlatform: LivePlatform = {
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

export type LiveState = Pick<
  Cloudflare.DurableObjectState["Service"],
  "acceptWebSocket" | "getWebSockets" | "setWebSocketAutoResponse"
>;

export const makeLiveSockets = Effect.fnUntraced(function* (
  state: LiveState,
  scheduleBy: (at: number) => Effect.Effect<void>,
  platform: LivePlatform = workerdLivePlatform,
) {
  yield* state.setWebSocketAutoResponse(platform.autoResponse());
  const cursor = yield* Ref.make<LiveCursor | undefined>(undefined);
  const advance = (next: LiveCursor) =>
    Ref.modify(cursor, (current) => {
      const advanced = advanceCursor(current, next);
      return [advanced, advanced];
    });
  const socketsTagged = (tag?: string) =>
    state.getWebSockets(tag).pipe(Effect.map((sockets) => sockets.map(liveSocket)));

  const admit = (
    horizonOf: (actor: Actor, replicaId: string) => Effect.Effect<AuthorityReply<LiveHorizonReply>>,
  ) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const admission = admissionFromHeaders(request.headers);
      if (admission === undefined || request.headers.upgrade?.toLowerCase() !== "websocket") {
        return refuse(400, "INVALID_LIVE_ADMISSION", "The live admission is invalid.");
      }
      const horizon = yield* horizonOf(
        { organizationId: admission.organizationId, userId: admission.userId },
        admission.replicaId,
      );
      switch (horizon._tag) {
        case "refused":
          return refuse(liveStatus(horizon.code), horizon.code, horizon.message);
        case "malformed":
          return refuse(503, "SYNC_UNAVAILABLE", "Organization sync is temporarily unavailable.");
        case "ok":
          break;
      }
      closeSockets(
        yield* socketsTagged(replicaTag(admission.replicaId)),
        LIVE_SOCKET_CLOSE.normal,
        "replaced",
      );
      const { client, server } = platform.pair();
      yield* state.acceptWebSocket(server, [replicaTag(admission.replicaId)]);
      server.serializeAttachment<LiveAttachment>({
        replicaId: admission.replicaId,
        userId: admission.userId,
        expiresAt: admission.expiresAt,
        maxBytes: admission.maxBytes,
        epoch: horizon.value.epoch,
      });
      yield* scheduleBy(admission.expiresAt);
      const greeting = yield* advance(horizon.value);
      server.ws.send(helloFrame(greeting));
      return platform.upgrade(client);
    }).pipe(Effect.withSpan("LiveSockets.admit"));

  const publish = Effect.fn("LiveSockets.publish")(function* (input: CommitFanout) {
    const now = yield* Clock.currentTimeMillis;
    yield* advance({ epoch: input.epoch, horizon: input.horizon });
    return publishToSockets(yield* socketsTagged(), input, now);
  });

  const sweep = Effect.fn("LiveSockets.sweep")(function* () {
    const now = yield* Clock.currentTimeMillis;
    const earliest = closeExpiredSockets(yield* socketsTagged(), now);
    if (earliest !== undefined) yield* scheduleBy(Math.max(earliest, now + 1));
  });

  const webSocketMessage = (socket: Cloudflare.WebSocket) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        closeIfExpired(liveSocket(socket), now);
      }),
    );

  const webSocketClose = (socket: Cloudflare.WebSocket) =>
    Effect.sync(() => {
      closeSockets([liveSocket(socket)], LIVE_SOCKET_CLOSE.normal, "closed");
    });

  return { admit, publish, sweep, webSocketMessage, webSocketClose };
});

export type LiveSockets = Effect.Success<ReturnType<typeof makeLiveSockets>>;
