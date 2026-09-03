export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
}
