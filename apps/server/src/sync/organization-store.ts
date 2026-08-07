import { SyncLiveAttachment, SyncLiveEvent, SyncRequest, SyncResponse } from "@store/contracts";
import { DurableObject } from "cloudflare:workers";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

// No env type parameter on purpose. This class never reads `this.env`, and
// `apps/server/infra.ts` types the ORGANIZATION_STORE binding from this class —
// naming the Worker's env here would make that a circular type reference.
export class OrganizationStore extends DurableObject {
  readonly #runtime = makeSyncRuntime(this.ctx.storage);

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket")
      return this.#acceptLive(request);

    const payload = decodePayload(await request.json());
    try {
      const response = await this.#runtime.runSync(payload.actor, payload.request);
      if (response.acknowledgements.some((acknowledgement) => acknowledgement.status === "applied"))
        this.#broadcast(response.headCursor);
      return Response.json(encodeResult({ _tag: "Success", response }));
    } catch (cause) {
      if (cause instanceof SyncProtocolError)
        return Response.json(
          encodeResult({ _tag: "ProtocolFailure", code: cause.code, message: cause.message }),
        );
      const message = cause instanceof Error ? cause.message : String(cause);
      return Response.json(encodeResult({ _tag: "DatabaseFailure", message }));
    }
  }

  async #acceptLive(request: Request): Promise<Response> {
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
      return new Response("Invalid live synchronization context", { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment(
      SyncLiveAttachment.make({
        organizationId,
        userId,
        deviceId,
        connectionId: crypto.randomUUID(),
        protocolVersion: 2,
        authenticationExpiresAt,
      }),
    );
    this.ctx.acceptWebSocket(server);
    const headCursor = await this.#runtime.headCursor(organizationId);
    server.send(JSON.stringify(encodeLiveEvent({ type: "hello", protocolVersion: 2, headCursor })));
    console.info(
      JSON.stringify({
        event: "sync.live_connected",
        organizationId,
        deviceId,
        headCursor,
        connectedSockets: this.ctx.getWebSockets().length,
      }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  #broadcast(headCursor: number) {
    const encoded = JSON.stringify(
      encodeLiveEvent({ type: "invalidate", protocolVersion: 2, headCursor }),
    );
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = decodeAttachment(socket.deserializeAttachment());
      if (Option.isNone(attachment)) {
        socket.close(1008, "Invalid connection metadata");
        continue;
      }
      if (attachment.value.authenticationExpiresAt <= Date.now()) {
        socket.close(1008, "Authentication expired");
        continue;
      }
      try {
        socket.send(encoded);
      } catch {
        socket.close(1011, "Invalidation delivery failed");
      }
    }
  }

  override webSocketMessage(socket: WebSocket, _message: string | ArrayBuffer): void {
    // This protocol is server-to-client only. Treat client payloads as abuse.
    socket.close(1008, "Client messages are not supported");
  }

  override webSocketClose(
    _socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {}

  override webSocketError(socket: WebSocket, _error: unknown): void {
    socket.close(1011, "Live synchronization error");
  }
}

const decodeResult = Schema.decodeUnknownSync(SyncExchangeResult);
const encodePayload = Schema.encodeSync(SyncExchangePayload);

export const exchangeWithOrganizationStore = async (
  namespace: DurableObjectNamespace<OrganizationStore>,
  actor: SyncActor,
  request: SyncRequest,
): Promise<SyncResponse> => {
  const stub = namespace.getByName(actor.organizationId);
  const response = await stub.fetch("https://organization-store/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(encodePayload({ actor, request })),
  });
  const result = decodeResult(await response.json());
  if (result._tag === "ProtocolFailure")
    throw SyncProtocolError.make({ code: result.code, message: result.message });
  if (result._tag === "DatabaseFailure") throw SyncDatabaseError.make({ message: result.message });
  return result.response;
};

export const connectWithOrganizationStore = (
  namespace: DurableObjectNamespace<OrganizationStore>,
  input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly authenticationExpiresAt: number;
  },
): Promise<Response> => {
  // Authentication credentials terminate at the Worker boundary. The
  // organization object receives only identity already authorized by middleware.
  const headers = new Headers({ Upgrade: "websocket" });
  headers.set(LIVE_ORGANIZATION_HEADER, input.organizationId);
  headers.set(LIVE_USER_HEADER, input.userId);
  headers.set(LIVE_DEVICE_HEADER, input.deviceId);
  headers.set(LIVE_AUTH_EXPIRY_HEADER, String(input.authenticationExpiresAt));
  return namespace.getByName(input.organizationId).fetch("https://organization-store/live", {
    headers,
  });
};
