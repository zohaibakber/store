export type SyncCredentials = {
  organizationId: string;
  url: string;
  authToken: string;
  expiresAt: string;
};

const renderTemplate = (template: string, values: Record<string, string>) =>
  template.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? "");

const ensureTursoDatabase = async (
  platformToken: string,
  tursoOrganization: string,
  databaseName: string,
) => {
  const endpoint = new URL(
    `/v1/organizations/${encodeURIComponent(tursoOrganization)}/databases/${encodeURIComponent(databaseName)}`,
    "https://api.turso.tech",
  );
  const headers = { Authorization: `Bearer ${platformToken}`, "Content-Type": "application/json" };
  const existing = await fetch(endpoint, { headers });
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error("SYNC_DATABASE_LOOKUP_FAILED");
  const createEndpoint = new URL(
    `/v1/organizations/${encodeURIComponent(tursoOrganization)}/databases`,
    "https://api.turso.tech",
  );
  const created = await fetch(createEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: databaseName,
      group: process.env.TURSO_DATABASE_GROUP?.trim() || "default",
    }),
  });
  if (!created.ok && created.status !== 409) throw new Error("SYNC_DATABASE_CREATE_FAILED");
};

export const issueTursoCredentials = async (organizationId: string): Promise<SyncCredentials> => {
  const platformToken = process.env.TURSO_PLATFORM_API_TOKEN?.trim();
  const tursoOrganization = process.env.TURSO_ORGANIZATION_SLUG?.trim();
  const nameTemplate = process.env.TURSO_DATABASE_NAME_TEMPLATE?.trim() || "store-{organizationId}";
  const urlTemplate = process.env.TURSO_DATABASE_URL_TEMPLATE?.trim();
  if (!platformToken || !tursoOrganization || !urlTemplate) {
    throw new Error("SYNC_NOT_CONFIGURED");
  }

  const databaseName = renderTemplate(nameTemplate, { organizationId }).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(databaseName)) {
    throw new Error("SYNC_DATABASE_NAME_INVALID");
  }

  await ensureTursoDatabase(platformToken, tursoOrganization, databaseName);

  const expiration = "15m";
  const endpoint = new URL(
    `/v1/organizations/${encodeURIComponent(tursoOrganization)}/databases/${encodeURIComponent(databaseName)}/auth/tokens`,
    "https://api.turso.tech",
  );
  endpoint.searchParams.set("expiration", expiration);
  endpoint.searchParams.set("authorization", "full-access");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${platformToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error("SYNC_TOKEN_ISSUE_FAILED");
  const payload = (await response.json()) as { jwt?: unknown };
  if (typeof payload.jwt !== "string" || !payload.jwt) throw new Error("SYNC_TOKEN_INVALID");

  return {
    organizationId,
    url: renderTemplate(urlTemplate, { databaseName, organizationId, tursoOrganization }),
    authToken: payload.jwt,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
};
