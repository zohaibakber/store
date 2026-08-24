import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";

import type { AuthBroker } from "./auth";
import {
  INVENTORY_HTTP_ABORT_CHANNEL,
  INVENTORY_HTTP_CONFIG_CHANNEL,
  INVENTORY_HTTP_REQUEST_CHANNEL,
  type InventoryHttpRequest,
  type InventoryHttpResponse,
} from "./inventory-http-channels";

const InventoryHttpRequestInput = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192)),
  method: Schema.Literals(["GET", "POST"]),
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])).check(Schema.isMaxLength(64)),
  body: Schema.NullOr(Schema.instanceOf(ArrayBuffer)),
});

const requestKey = (senderId: number, requestId: string) => `${senderId}:${requestId}`;
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "cache-control",
  "content-type",
  "if-modified-since",
  "if-none-match",
]);

const inventoryApiPath = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  return (basePath.endsWith("/api") ? basePath : `${basePath}/api`).replace(/^\/\//u, "/");
};

const INVENTORY_COMMAND_PATHS = ["mutations", "invoices", "imports"] as const;

const validatedInventoryUrl = (
  apiBaseUrl: string,
  request: Pick<InventoryHttpRequest, "method" | "url">,
) => {
  const allowed = new URL(apiBaseUrl);
  const requested = new URL(request.url);
  const apiPath = inventoryApiPath(apiBaseUrl);
  const credentialsPath = `${apiPath}/powersync/credentials`;
  const commandPaths = INVENTORY_COMMAND_PATHS.map((command) => `${apiPath}/inventory/${command}`);
  const routeAllowed =
    (request.method === "GET" && requested.pathname === credentialsPath) ||
    (request.method === "POST" && commandPaths.includes(requested.pathname));
  if (
    requested.username ||
    requested.password ||
    requested.origin !== allowed.origin ||
    !routeAllowed
  ) {
    throw new Error("The inventory request is outside the configured inventory API.");
  }
  return requested.href;
};

const sanitizedRequestHeaders = (entries: ReadonlyArray<readonly [string, string]>): Headers => {
  const headers = new Headers();
  for (const [name, value] of entries) {
    if (ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }
  return headers;
};

export const registerInventoryHttpIpc = (options: {
  readonly apiBaseUrl: string;
  readonly auth: AuthBroker;
  readonly deviceId: string;
  readonly ipcMain: IpcMain;
}) => {
  const inFlight = new Map<string, AbortController>();

  const handleConfig = () => ({
    apiBaseUrl: options.apiBaseUrl,
    deviceId: options.deviceId,
  });
  const handleRequest = async (
    event: IpcMainInvokeEvent,
    input: InventoryHttpRequest,
  ): Promise<InventoryHttpResponse> => {
    const request = Schema.decodeUnknownSync(InventoryHttpRequestInput)(input);
    if (request.body && request.body.byteLength > 1_048_576) {
      throw new Error("The inventory request body exceeds the 1 MiB limit.");
    }
    const key = requestKey(event.sender.id, request.requestId);
    if (inFlight.has(key)) throw new Error("The inventory request ID is already in use.");

    const controller = new AbortController();
    inFlight.set(key, controller);
    try {
      const response = await options.auth.apiFetch(
        validatedInventoryUrl(options.apiBaseUrl, request),
        {
          method: request.method,
          headers: sanitizedRequestHeaders(request.headers),
          body: request.body,
          redirect: "error",
          signal: controller.signal,
        },
      );
      return {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()].filter(
          ([name]) => name.toLowerCase() !== "set-cookie",
        ),
        body: await response.arrayBuffer(),
      };
    } finally {
      inFlight.delete(key);
    }
  };
  const abortRequest = (event: IpcMainEvent, input: string) => {
    const requestId = Schema.decodeUnknownSync(Schema.String)(input);
    inFlight.get(requestKey(event.sender.id, requestId))?.abort();
  };

  options.ipcMain.handle(INVENTORY_HTTP_CONFIG_CHANNEL, handleConfig);
  options.ipcMain.handle(INVENTORY_HTTP_REQUEST_CHANNEL, handleRequest);
  options.ipcMain.on(INVENTORY_HTTP_ABORT_CHANNEL, abortRequest);

  return () => {
    options.ipcMain.removeHandler(INVENTORY_HTTP_CONFIG_CHANNEL);
    options.ipcMain.removeHandler(INVENTORY_HTTP_REQUEST_CHANNEL);
    options.ipcMain.off(INVENTORY_HTTP_ABORT_CHANNEL, abortRequest);
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
  };
};
