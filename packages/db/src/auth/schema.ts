import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Better Auth expects camelCase columns and timestamp-mode Date values.
const timestamp = () => integer({ mode: "timestamp" });
const nowDefault = sql`(unixepoch())`;

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).default(false).notNull(),
  image: text(),
  createdAt: timestamp().default(nowDefault).notNull(),
  updatedAt: timestamp()
    .default(nowDefault)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp().notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text(),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(),
    refreshTokenExpiresAt: timestamp(),
    scope: text(),
    password: text(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .default(nowDefault)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = sqliteTable(
  "organization",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    createdAt: timestamp().notNull(),
    metadata: text(),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = sqliteTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().default("member").notNull(),
    createdAt: timestamp().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

/**
 * Maps a Clerk organization to the Durable Object / local sqlite key.
 *
 * Inventory lives in `ORGANIZATION_STORE` instances named by
 * `storeOrganizationId`. Existing Better Auth organization ids must keep
 * naming those instances, or every catalog and sync log would look empty.
 * The first Clerk org for an email is bound to that legacy id; later Clerk
 * orgs get their own store ids (new empty DOs).
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

export const invitation = sqliteTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().default(nowDefault).notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);
