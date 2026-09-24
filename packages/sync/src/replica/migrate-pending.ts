const INDEXED_DB_REPLICA_NAME_PREFIX = "tabaaq-replica-v1";

export const indexedDbReplicaDatabaseName = (organizationId: string, userId: string): string =>
  `${INDEXED_DB_REPLICA_NAME_PREFIX}:${organizationId}:${userId}`;
