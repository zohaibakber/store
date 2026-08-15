import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = () => integer({ mode: "timestamp" });
const nowDefault = sql`(unixepoch())`;

/**
 * Maps a Clerk organization to the Durable Object / local sqlite key.
 *
 * Inventory lives in `ORGANIZATION_STORE` instances named by
 * `storeOrganizationId`. Existing Better Auth organization ids must keep
 * naming those instances, or every catalog and sync log would look empty. The
 * migration binding is permanent; Better Auth's identity, session, and
 * membership tables are not.
 */
export const clerkOrgBinding = sqliteTable(
  "clerk_org_binding",
  {
    clerkOrganizationId: text().primaryKey(),
    storeOrganizationId: text().notNull(),
    clerkUserId: text().notNull(),
    email: text().notNull(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .default(nowDefault)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("clerk_org_binding_store_organization_id_idx").on(table.storeOrganizationId),
    index("clerk_org_binding_email_idx").on(table.email),
  ],
);
