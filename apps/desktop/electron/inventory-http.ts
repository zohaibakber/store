import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";

import type { AuthBroker } from "./auth";
import {
  INVENTORY_HTTP_ABORT_CHANNEL,
  INVENTORY_HTTP_CONFIG_CHANNEL,
  INVENTORY_HTTP_REQUEST_CHANNEL,
  type InventoryHttpBackend,
  type InventoryHttpRequest,
  type InventoryHttpResponse,
} from "./inventory-http-channels";
import { assertTrustedIpcSender } from "./ipc-sender";

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
const LIVE_TICKET_NONCE = /^[0-9a-f]{64}$/u;
const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,200}$/u;
const SNAPSHOT_PART = /^[1-9][0-9]{0,8}$/u;

const inventoryApiPath = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  return (basePath.endsWith("/api") ? basePath : `${basePath}/api`).replace(/^\/\//u, "/");
};

export const INVENTORY_COMMAND_PATHS = ["mutations", "invoices", "imports"] as const;
export const SYNC_COMMAND_PATHS = [
  "replicas",
  "commands",
  "pull",
  "snapshots",
  "live-tickets",
] as const;

export const MAX_INVENTORY_COMMAND_BODY_BYTES = 1_048_576;

export const readInventoryHttpBackend = (
  value = process.env["STORE_INVENTORY_BACKEND"],
): InventoryHttpBackend => {
  if (value === undefined || value === "" || value === "powerSync") {
    return { _tag: "powerSync" };
  }
  if (value === "organizationObject") {
    return { _tag: "organizationObject" };
  }
  throw new Error(`Unsupported inventory backend: ${value}`);
};

export const assertInventoryRequestBodySize = (
  _apiBaseUrl: string,
  request: Pick<InventoryHttpRequest, "url" | "body">,
) => {
  if (!request.body) return;
  if (request.body.byteLength <= MAX_INVENTORY_COMMAND_BODY_BYTES) return;
  throw new Error(
    `The inventory request body exceeds the ${MAX_INVENTORY_COMMAND_BODY_BYTES / 1_048_576} MiB limit.`,
  );
};

const isReceiptPath = (apiPath: string, pathname: string): boolean => {
  const prefix = `${apiPath}/sync/receipts/`;
  if (!pathname.startsWith(prefix)) return false;
  const operationId = pathname.slice(prefix.length);
  return operationId.length > 0 && !operationId.includes("/");
};

const isSnapshotPartPath = (apiPath: string, pathname: string): boolean => {
  const prefix = `${apiPath}/sync/snapshots/`;
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  const [snapshotId, parts, partNumber, ...extra] = rest.split("/");
  if (
    extra.length > 0 ||
    parts !== "parts" ||
    snapshotId === undefined ||
    partNumber === undefined
  ) {
    return false;
  }
  return SNAPSHOT_ID.test(snapshotId) && SNAPSHOT_PART.test(partNumber);
};

const isLiveTicketUpgrade = (apiPath: string, requested: URL, method: string): boolean => {
  if (method !== "GET") return false;
  if (requested.pathname !== `${apiPath}/sync/live`) return false;
  const nonce = requested.searchParams.get("nonce");
  const replicaId = requested.searchParams.get("replicaId");
  const subscription = requested.searchParams.get("subscription");
  const keys = [...requested.searchParams.keys()];
  if (keys.length === 1 && keys[0] === "nonce")
    return nonce !== null && LIVE_TICKET_NONCE.test(nonce);
  if (keys.length !== 3) return false;
  const allowed = new Set(["nonce", "replicaId", "subscription"]);
  if (keys.some((key) => !allowed.has(key))) return false;
  return (
    nonce !== null &&
    LIVE_TICKET_NONCE.test(nonce) &&
    replicaId !== null &&
    replicaId.length > 0 &&
    replicaId.length <= 200 &&
    subscription === "operational"
  );
};

export const validatedInventoryUrl = (
  apiBaseUrl: string,
  request: Pick<InventoryHttpRequest, "method" | "url">,
) => {
  const allowed = new URL(apiBaseUrl);
  const requested = new URL(request.url);
  const apiPath = inventoryApiPath(apiBaseUrl);
  const credentialsPath = `${apiPath}/powersync/credentials`;
  const commandPaths = INVENTORY_COMMAND_PATHS.map((command) => `${apiPath}/inventory/${command}`);
  const syncCommandPaths = SYNC_COMMAND_PATHS.map((command) => `${apiPath}/sync/${command}`);
  const routeAllowed =
    (request.method === "GET" && requested.pathname === credentialsPath) ||
    (request.method === "POST" && commandPaths.includes(requested.pathname)) ||
    (request.method === "POST" && syncCommandPaths.includes(requested.pathname)) ||
    (request.method === "GET" && isReceiptPath(apiPath, requested.pathname)) ||
    (request.method === "GET" && isSnapshotPartPath(apiPath, requested.pathname)) ||
    isLiveTicketUpgrade(apiPath, requested, request.method);
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
  readonly allowedOrigins: () => ReadonlyArray<string>;
  readonly backend?: InventoryHttpBackend;
}) => {
  const backend = options.backend ?? readInventoryHttpBackend();
  const inFlight = new Map<string, AbortController>();
  const assertSender = (event: IpcMainInvokeEvent | IpcMainEvent) =>
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());

  const handleConfig = (event: IpcMainInvokeEvent) => {
    assertSender(event);
    return {
      apiBaseUrl: options.apiBaseUrl,
      deviceId: options.deviceId,
      backend,
    };
  };
  const handleRequest = async (
    event: IpcMainInvokeEvent,
    input: InventoryHttpRequest,
  ): Promise<InventoryHttpResponse> => {
    assertSender(event);
    const request = Schema.decodeUnknownSync(InventoryHttpRequestInput)(input);
    validatedInventoryUrl(options.apiBaseUrl, request);
    assertInventoryRequestBodySize(options.apiBaseUrl, request);
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
    assertSender(event);
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
