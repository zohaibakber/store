export const INVENTORY_HTTP_CONFIG_CHANNEL = "inventory:http-config";
export const INVENTORY_HTTP_REQUEST_CHANNEL = "inventory:http-request";
export const INVENTORY_HTTP_ABORT_CHANNEL = "inventory:http-abort";

export interface InventoryHttpConfig {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
}

export interface InventoryHttpRequest {
  readonly requestId: string;
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ArrayBuffer | null;
}

export interface InventoryHttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ArrayBuffer;
}

export interface InventoryHttpBridge {
  readonly getConfig: () => Promise<InventoryHttpConfig>;
  readonly request: (request: InventoryHttpRequest) => Promise<InventoryHttpResponse>;
  readonly abort: (requestId: string) => void;
}
