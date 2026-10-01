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

export interface ImportedCatalog extends EncodedJsonBody {
  readonly fanout: CommitFanout | null;
}

export interface SubmittedCommand {
  readonly body: string;
  readonly fanout: CommitFanout | null;
}
