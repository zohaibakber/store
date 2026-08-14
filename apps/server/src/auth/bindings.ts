import type { OrganizationBindingStore } from "@store/auth";

const bindingRow = (row: { clerkOrganizationId: string; storeOrganizationId: string }) => ({
  clerkOrganizationId: row.clerkOrganizationId,
  storeOrganizationId: row.storeOrganizationId,
});

export const makeD1BindingStore = (database: D1Database): OrganizationBindingStore => ({
  getByClerkOrganizationId: async (clerkOrganizationId) => {
    const row = await database
      .prepare(
        `SELECT clerkOrganizationId, storeOrganizationId FROM clerk_org_binding WHERE clerkOrganizationId = ?`,
      )
      .bind(clerkOrganizationId)
      .first<{ clerkOrganizationId: string; storeOrganizationId: string }>();
    return row ? bindingRow(row) : null;
  },
  getByStoreOrganizationId: async (storeOrganizationId) => {
    const row = await database
      .prepare(
        `SELECT clerkOrganizationId, storeOrganizationId FROM clerk_org_binding WHERE storeOrganizationId = ?`,
      )
      .bind(storeOrganizationId)
      .first<{ clerkOrganizationId: string; storeOrganizationId: string }>();
    return row ? bindingRow(row) : null;
  },
  findLegacyStoreOrganizationByEmail: async (email) => {
    const row = await database
      .prepare(
        `SELECT m.organizationId AS storeOrganizationId, o.name AS name, o.slug AS slug, m.role AS role
         FROM user AS u
         INNER JOIN member AS m ON m.userId = u.id
         INNER JOIN organization AS o ON o.id = m.organizationId
         WHERE lower(u.email) = lower(?)
         ORDER BY m.createdAt ASC
         LIMIT 1`,
      )
      .bind(email)
      .first<{ storeOrganizationId: string; name: string; slug: string; role: string }>();
    return row ?? null;
  },
  putBinding: async (input) => {
    await database
      .prepare(
        `INSERT INTO clerk_org_binding (
           clerkOrganizationId, storeOrganizationId, clerkUserId, email, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .bind(input.clerkOrganizationId, input.storeOrganizationId, input.clerkUserId, input.email)
      .run();
  },
});
