export interface InventoryActor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface InventorySyncActor extends InventoryActor {
  readonly authorizationExpiresAt: number;
}

export interface EncodedJsonBody {
  readonly json: string;
}

export interface EncodedSnapshotPart extends EncodedJsonBody {
  readonly sha256: string;
}
