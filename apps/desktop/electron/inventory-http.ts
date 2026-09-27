import type { IpcMain, IpcMainInvokeEvent } from "electron";

import { INVENTORY_HTTP_CONFIG_CHANNEL } from "./inventory-http-channels";
import { assertTrustedIpcSender } from "./ipc-sender";
import type { ReplicaSyncApiRequest } from "./replica-ipc";

type InventoryHttpRequest = {
  readonly method: "GET" | "POST";
  readonly url: string;
};

const LIVE_TICKET_NONCE = /^[0-9a-f]{64}$/u;
const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,200}$/u;
const SNAPSHOT_PART = /^[1-9][0-9]{0,8}$/u;

const inventoryApiPath = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  return (basePath.endsWith("/api") ? basePath : `${basePath}/api`).replace(/^\/\//u, "/");
};

export const SYNC_COMMAND_PATHS = [
  "replicas",
  "commands",
  "pull",
  "snapshots",
  "live-tickets",
] as const;

export const MAX_INVENTORY_COMMAND_BODY_BYTES = 1_048_576;

export const assertInventoryRequestBodySize = (body: string | null) => {
  if (!body) return;
  if (Buffer.byteLength(body, "utf8") <= MAX_INVENTORY_COMMAND_BODY_BYTES) return;
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
  const allowed = new Set(["nonce", "replicaId", "subscription", "afterHorizon", "waitMs"]);
  if (keys.some((key) => !allowed.has(key))) return false;
  if (
    nonce === null ||
    !LIVE_TICKET_NONCE.test(nonce) ||
    replicaId === null ||
    replicaId.length === 0 ||
    replicaId.length > 200 ||
    subscription !== "operational"
  ) {
    return false;
  }
  const afterHorizon = requested.searchParams.get("afterHorizon");
  if (afterHorizon !== null && !/^[0-9]+$/u.test(afterHorizon)) return false;
  const waitMs = requested.searchParams.get("waitMs");
  if (waitMs !== null && !/^[1-9][0-9]{0,5}$/u.test(waitMs)) return false;
  return true;
};

export const validatedInventoryUrl = (apiBaseUrl: string, request: InventoryHttpRequest) => {
  const allowed = new URL(apiBaseUrl);
  const requested = new URL(request.url);
  const apiPath = inventoryApiPath(apiBaseUrl);
  const syncCommandPaths = SYNC_COMMAND_PATHS.map((command) => `${apiPath}/sync/${command}`);
  const routeAllowed =
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

export const makeReplicaSyncApiRequest =
  (
    apiBaseUrl: string,
    apiFetch: (url: string, init: RequestInit) => Promise<Response>,
  ): ReplicaSyncApiRequest =>
  async (pathname, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ?? null;
    const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    const url = validatedInventoryUrl(apiBaseUrl, { method, url: new URL(pathname, base).href });
    assertInventoryRequestBodySize(body);
    const response = await apiFetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ?? undefined,
    });
    return { ok: response.ok, status: response.status, bodyText: await response.text() };
  };

export const registerInventoryHttpIpc = (options: {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  readonly allowedOrigins: () => ReadonlyArray<string>;
}) => {
  const handleConfig = (event: Pick<IpcMainInvokeEvent, "senderFrame">) => {
    assertTrustedIpcSender(event.senderFrame, options.allowedOrigins());
    return {
      apiBaseUrl: options.apiBaseUrl,
      deviceId: options.deviceId,
    };
  };

  options.ipcMain.handle(INVENTORY_HTTP_CONFIG_CHANNEL, handleConfig);

  return () => {
    options.ipcMain.removeHandler(INVENTORY_HTTP_CONFIG_CHANNEL);
  };
};
