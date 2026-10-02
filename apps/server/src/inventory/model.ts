export interface InventoryActor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface EncodedJsonBody {
  readonly json: string;
}

export interface EncodedSnapshotPart extends EncodedJsonBody {
  readonly sha256: string;
}

export interface CommitFanout {
  readonly epoch: string;
  readonly horizon: string;
  readonly group: string;
  readonly byteLength: number;
  readonly originReplicaId: string;
}

export interface EncodedCommit extends EncodedJsonBody {
  readonly fanout: CommitFanout | null;
}
