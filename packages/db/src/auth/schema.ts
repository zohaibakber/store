import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = () => integer({ mode: "timestamp" });
const nowDefault = sql`(unixepoch())`;

export const user = sqliteTable(
  "auth_user",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    name: text().notNull(),
    image: text(),
    passwordHash: text(),
    emailVerifiedAt: timestamp(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .default(nowDefault)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("auth_user_email_idx").on(table.email)],
);

export const oauthAccount = sqliteTable(
  "auth_oauth_account",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    createdAt: timestamp().default(nowDefault).notNull(),
  },
  (table) => [
    uniqueIndex("auth_oauth_account_provider_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    index("auth_oauth_account_user_idx").on(table.userId),
  ],
);

export const organization = sqliteTable(
  "auth_organization",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text(),
    createdAt: timestamp().default(nowDefault).notNull(),
    updatedAt: timestamp()
      .default(nowDefault)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("auth_organization_slug_idx").on(table.slug)],
);

export const organizationMembership = sqliteTable(
  "auth_organization_membership",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull(),
    createdAt: timestamp().default(nowDefault).notNull(),
  },
  (table) => [
    uniqueIndex("auth_organization_membership_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("auth_organization_membership_user_idx").on(table.userId),
  ],
);

export const session = sqliteTable(
  "auth_session",
  {
    id: text().primaryKey(),
    familyId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    refreshTokenHash: text().notNull(),
    clientKind: text().notNull(),
    deviceName: text(),
    expiresAt: timestamp().notNull(),
    lastUsedAt: timestamp().default(nowDefault).notNull(),
    revokedAt: timestamp(),
    replacedBySessionId: text(),
    createdAt: timestamp().default(nowDefault).notNull(),
  },
  (table) => [
    index("auth_session_user_idx").on(table.userId),
    index("auth_session_family_idx").on(table.familyId),
    index("auth_session_expiry_idx").on(table.expiresAt),
  ],
);
