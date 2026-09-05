import { SYNC_EPOCH } from "@store/contracts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const Attachment = Schema.Struct({ userId: Schema.String, expiresAt: Schema.Number });
const decodeAttachment = Schema.decodeUnknownOption(Attachment);

export class CatalogNotifications extends Cloudflare.DurableObject<CatalogNotifications>()(
  "CatalogNotifications",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.sync(() => {
      const closeExpired = Effect.fn("CatalogNotifications.closeExpired")(function* () {
        let nextExpiry: number | undefined;
        for (const socket of yield* state.getWebSockets()) {
          const attachment = decodeAttachment(socket.deserializeAttachment<unknown>());
          if (attachment._tag === "None" || attachment.value.expiresAt <= Date.now()) {
            yield* socket.close(4001, "Authorization expired");
          } else {
            nextExpiry = Math.min(nextExpiry ?? Infinity, attachment.value.expiresAt);
          }
        }
        const tickets = yield* state.storage.list<{ expiresAt: number }>({ prefix: "ticket:" });
        for (const [key, ticket] of tickets) {
          if (ticket.expiresAt <= Date.now()) yield* state.storage.delete(key);
          else nextExpiry = Math.min(nextExpiry ?? Infinity, ticket.expiresAt);
        }
        if (nextExpiry !== undefined) yield* state.storage.setAlarm(nextExpiry);
      });
      return {
        issueTicket: Effect.fn("CatalogNotifications.issueTicket")(function* (
          userId: string,
          sessionExpiry: number,
        ) {
          const ticket = crypto.randomUUID() + crypto.randomUUID();
          const expiresAt = Math.min(sessionExpiry, Date.now() + 15 * 60_000);
          yield* state.storage.put(`ticket:${ticket}`, {
            userId,
            expiresAt: Date.now() + 30_000,
            socketExpiry: expiresAt,
          });
          const alarm = yield* state.storage.getAlarm();
          yield* state.storage.setAlarm(Math.min(alarm ?? Infinity, Date.now() + 30_000));
          return { ticket, expiresAt };
        }),
        notify: Effect.fn("CatalogNotifications.notify")(function* (cursor: number) {
          const latest = yield* state.storage.transaction((tx) =>
            Effect.gen(function* () {
              const next = Math.max((yield* tx.get<number>("cursor")) ?? 0, cursor);
              yield* tx.put("cursor", next);
              return next;
            }),
          );
          for (const socket of yield* state.getWebSockets()) {
            const attachment = decodeAttachment(socket.deserializeAttachment<unknown>());
            if (attachment._tag === "Some" && attachment.value.expiresAt > Date.now()) {
              yield* Effect.try(() =>
                socket.ws.send(JSON.stringify({ epoch: SYNC_EPOCH, cursor: latest })),
              ).pipe(Effect.ignore);
            } else yield* socket.close(4001, "Authorization expired");
          }
        }),
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.upgrade?.toLowerCase() !== "websocket")
            return HttpServerResponse.empty({ status: 426 });
          const ticketKey = `ticket:${new URL(request.url, "https://sync.invalid").searchParams.get("ticket") ?? ""}`;
          const ticket = yield* state.storage.transaction((tx) =>
            Effect.gen(function* () {
              const value = yield* tx.get<{
                userId: string;
                expiresAt: number;
                socketExpiry: number;
              }>(ticketKey);
              if (value) yield* tx.delete(ticketKey);
              return value;
            }),
          );
          if (!ticket || ticket.expiresAt <= Date.now() || ticket.socketExpiry <= Date.now())
            return HttpServerResponse.empty({ status: 401 });
          const [response, socket] = yield* Cloudflare.upgrade();
          socket.serializeAttachment({ userId: ticket.userId, expiresAt: ticket.socketExpiry });
          yield* socket.send(
            JSON.stringify({
              epoch: SYNC_EPOCH,
              cursor: (yield* state.storage.get<number>("cursor")) ?? 0,
            }),
          );
          const alarm = yield* state.storage.getAlarm();
          yield* state.storage.setAlarm(Math.min(alarm ?? Infinity, ticket.socketExpiry));
          return response;
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket) =>
          socket.close(1008, "Notifications are receive-only"),
        webSocketClose: (socket: Cloudflare.WebSocket) => socket.close(1000, "Closed"),
        alarm: () => closeExpired(),
      };
    });
  }),
) {}
