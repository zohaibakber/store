import { openElectronIpcReplicaHandle } from "@store/client-db";
import * as Schema from "effect/Schema";

import type { InventoryHost } from "@/lib/inventory-host";

type InventoryHttpBridge = NonNullable<Window["inventoryHttp"]>;

const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});

const aborted = (signal: AbortSignal) => {
  if (signal.reason) throw signal.reason;
  throw new DOMException("The inventory request was aborted.", "AbortError");
};

const electronAuthenticatedFetch =
  (bridge: InventoryHttpBridge): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET" && request.method !== "POST") {
      throw new Error(`Unsupported inventory request method: ${request.method}`);
    }
    if (request.signal.aborted) aborted(request.signal);

    const requestId = crypto.randomUUID();
    const abort = () => bridge.abort(requestId);
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await bridge.request({
        requestId,
        url: request.url,
        method: request.method,
        headers: [...request.headers.entries()],
        body: request.method === "POST" ? await request.arrayBuffer() : null,
      });
      if (request.signal.aborted) aborted(request.signal);
      return new Response(response.body.byteLength === 0 ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers.map(([name, value]): [string, string] => [name, value]),
      });
    } catch (cause) {
      if (request.signal.aborted) aborted(request.signal);
      throw cause;
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  };

export const createElectronInventoryHost = async (): Promise<InventoryHost | undefined> => {
  const http = window.inventoryHttp;
  const replica = window.replica;
  if (!http || !replica) return undefined;
  const config = Schema.decodeUnknownSync(InventoryHttpConfig)(await http.getConfig());
  return {
    apiBaseUrl: config.apiBaseUrl,
    authenticatedFetch: electronAuthenticatedFetch(http),
    deviceId: config.deviceId,
    openReplicaSqlite: async (_databaseName, identity) =>
      openElectronIpcReplicaHandle(replica, identity),
  };
};
