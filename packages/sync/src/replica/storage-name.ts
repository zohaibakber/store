export const REPLICA_STORAGE_PREFIX = "tabaaq-replica-v2";

export const indexedDbReplicaDatabaseName = (organizationId: string, userId: string): string =>
  `${REPLICA_STORAGE_PREFIX}:${organizationId}:${userId}`;

export const sqliteReplicaFileName = (key: string): string =>
  `${REPLICA_STORAGE_PREFIX}-${key}.sqlite`;
