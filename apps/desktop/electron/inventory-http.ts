import { ImportId, ImportPartNumber } from "@store/contracts";
import * as Schema from "effect/Schema";
import type { IpcMain, IpcMainInvokeEvent } from "electron";

import { INVENTORY_HTTP_CONFIG_CHANNEL } from "./inventory-http-channels";
import { assertTrustedIpcSender } from "./ipc-sender";
import type { ReplicaSyncApiRequest } from "./replica-ipc";

type InventoryHttpRequest = {
  readonly method: "GET" | "POST";
  readonly url: string;
};

const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,200}$/u;
const SNAPSHOT_PART = /^[1-9][0-9]{0,8}$/u;

const isImportId = Schema.is(ImportId);
const isImportPartNumber = Schema.is(ImportPartNumber);

const inventoryApiPath = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  return (basePath.endsWith("/api") ? basePath : `${basePath}/api`).replace(/^\/\//u, "/");
};

const SYNC_COMMAND_PATHS = ["replicas", "commands", "pull", "snapshots"] as const;

const MAX_INVENTORY_COMMAND_BODY_BYTES = 1_048_576;

const assertInventoryRequestBodySize = (body: string | null) => {
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

const isImportPath = (apiPath: string, pathname: string): boolean => {
  const prefix = `${apiPath}/sync/imports/`;
  if (!pathname.startsWith(prefix)) return false;
  const [importId, step, partNumber, ...extra] = pathname.slice(prefix.length).split("/");
  if (extra.length > 0 || !isImportId(importId)) return false;
  if (step === "commit") return partNumber === undefined;
  return (
    step === "parts" &&
    partNumber !== undefined &&
    SNAPSHOT_PART.test(partNumber) &&
    isImportPartNumber(Number(partNumber))
  );
};

const validatedInventoryUrl = (apiBaseUrl: string, request: InventoryHttpRequest) => {
  const allowed = new URL(apiBaseUrl);
  const requested = new URL(request.url);
  const apiPath = inventoryApiPath(apiBaseUrl);
  const syncCommandPaths = SYNC_COMMAND_PATHS.map((command) => `${apiPath}/sync/${command}`);
  const routeAllowed =
    (request.method === "POST" && syncCommandPaths.includes(requested.pathname)) ||
    (request.method === "POST" && isImportPath(apiPath, requested.pathname)) ||
    (request.method === "GET" && isReceiptPath(apiPath, requested.pathname)) ||
    (request.method === "GET" && isSnapshotPartPath(apiPath, requested.pathname));
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

const DEFAULT_SYNC_REQUEST_TIMEOUT_MILLIS = 30_000;

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
    const deadline = AbortSignal.timeout(
      init?.timeoutMillis ?? DEFAULT_SYNC_REQUEST_TIMEOUT_MILLIS,
    );
    const response = await apiFetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ?? undefined,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
    const retryAfter = response.headers.get("retry-after");
    const bodyText = await response.text();
    return retryAfter === null
      ? { ok: response.ok, status: response.status, bodyText }
      : { ok: response.ok, status: response.status, bodyText, retryAfter: retryAfter.slice(0, 64) };
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
