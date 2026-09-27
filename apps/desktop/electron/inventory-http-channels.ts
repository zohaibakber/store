export const INVENTORY_HTTP_CONFIG_CHANNEL = "inventory:http-config";

export interface InventoryHttpConfig {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
}

export interface InventoryHttpBridge {
  readonly getConfig: () => Promise<InventoryHttpConfig>;
}
