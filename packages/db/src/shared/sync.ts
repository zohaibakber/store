export const syncEntities = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
] as const;
export type SyncEntity = (typeof syncEntities)[number];

export const syncActions = ["upsert", "delete"] as const;
export type SyncAction = (typeof syncActions)[number];

export interface SyncEntityChangePayload {
  readonly entity: SyncEntity;
  readonly action: SyncAction;
  readonly entityId: string;
  readonly rowVersion: number;
  readonly row: unknown;
}
