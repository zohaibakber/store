const inventorySourceId = (apiBaseUrl: string) => {
  const normalized = apiBaseUrl.replace(/\/+$/u, "");
  if (!URL.canParse(normalized)) return normalized || "default";
  return new URL(normalized).origin;
};

export const inventoryReplicaScope = (apiBaseUrl: string, organizationId: string) =>
  `${inventorySourceId(apiBaseUrl)}:${organizationId}`;
