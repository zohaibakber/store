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
