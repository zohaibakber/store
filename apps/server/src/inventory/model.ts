export interface InventoryActor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface InventorySyncActor extends InventoryActor {
  readonly authorizationExpiresAt: number;
}

/**
 * A success body already encoded as the endpoint's JSON. The inventory owner
 * splices server-written stored JSON into it, so the HTTP edge sends it
 * without decoding and re-encoding row images.
 */
export interface EncodedJsonBody {
  readonly json: string;
}

/**
 * An encoded snapshot part plus the content hash that names it. The hash is
 * the part's immutable identity, so it doubles as the HTTP entity tag.
 */
export interface EncodedSnapshotPart extends EncodedJsonBody {
  readonly sha256: string;
}
