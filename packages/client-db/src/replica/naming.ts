export const REPLICA_STORAGE_PREFIX = "tabaaq-replica-v2";

export const indexedDbReplicaDatabaseName = (organizationId: string, userId: string): string =>
  `${REPLICA_STORAGE_PREFIX}:${organizationId}:${userId}`;

export const sqliteReplicaFileName = (key: string): string =>
  `${REPLICA_STORAGE_PREFIX}-${key}.sqlite`;

const inventorySourceId = (apiBaseUrl: string) => {
  const normalized = apiBaseUrl.replace(/\/+$/u, "");
  if (!URL.canParse(normalized)) return normalized || "default";
  return new URL(normalized).origin;
};

export const inventoryReplicaScope = (apiBaseUrl: string, organizationId: string) =>
  `${inventorySourceId(apiBaseUrl)}:${organizationId}`;
