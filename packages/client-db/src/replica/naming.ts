export const REPLICA_STORAGE_PREFIX = "tabaaq-replica-v2";

export const sqliteReplicaFileName = (key: string): string =>
  `${REPLICA_STORAGE_PREFIX}-${key}.sqlite`;
