export interface InventoryActor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface InventorySyncActor extends InventoryActor {
  readonly authorizationExpiresAt: number;
}
