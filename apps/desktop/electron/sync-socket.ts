import {
  openSyncSocket,
  syncSocketFromHandle,
  type SyncSocket,
  SyncTransportError,
} from "@store/persistence";
import type * as Effect from "effect/Effect";
import { WebSocket as NodeWebSocket, type RawData } from "ws";

const textFromNodeMessage = (data: RawData): string => {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data;
};

export const openDesktopSyncSocket = (input: {
  readonly baseUrl: string;
  readonly organizationId: string;
  readonly deviceId: string;
  readonly getAccessToken: () => string | null;
  readonly electronOrigin: string;
}): Effect.Effect<SyncSocket, SyncTransportError> =>
  openSyncSocket({
    baseUrl: input.baseUrl,
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    failureMessage: "Couldn't connect to live sync.",
    connect: (url) => {
      const token = input.getAccessToken();
      const socket = new NodeWebSocket(url, {
        headers: token
          ? {
              "electron-origin": input.electronOrigin,
              authorization: `Bearer ${token}`,
            }
          : { "electron-origin": input.electronOrigin },
      });
      return syncSocketFromHandle({
        send: (payload) => socket.send(payload),
        close: (code, reason) => socket.close(code, reason),
        listen: (handlers) => {
          const onMessage = (data: RawData) => handlers.message(textFromNodeMessage(data));
          const onError = (cause: Error) => handlers.error(cause);
          const onClose = (code: number, reason: Buffer) => handlers.close(code, reason.toString());
          socket.on("message", onMessage);
          socket.on("error", onError);
          socket.on("close", onClose);
          return () => {
            socket.off("message", onMessage);
            socket.off("error", onError);
            socket.off("close", onClose);
          };
        },
      });
    },
  });
