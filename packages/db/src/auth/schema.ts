import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = () => integer({ mode: "timestamp" });
const nowDefault = sql`(unixepoch())`;

/**
 * Cutover-only data from the hosted auth era. The first-party runtime never
 * reads this table. Keep it until production accounts have been linked to
 * first-party users and organizations, then remove it in a dedicated migration.
 */
export const legacyOrganizationBinding = sqliteTable(
  "clerk_org_binding",
  {
    legacyOrganizationId: text("clerkOrganizationId").primaryKey(),
    storeOrganizationId: text().notNull(),
    legacyUserId: text("clerkUserId").notNull(),
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
    uniqueIndex("auth_oauth_account_provider_idx").on(table.provider, table.providerAccountId),
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
    uniqueIndex("auth_organization_membership_org_user_idx").on(table.organizationId, table.userId),
    index("auth_organization_membership_user_idx").on(table.userId),
  ],
);

/**
 * A pending invitation is the authority for joining an existing organization.
 * Only the hash of the token secret is stored, so a leaked row cannot be
 * redeemed. The partial unique index keeps one live invitation per email and
 * organization while allowing the same address to be invited again after a
 * revoke or an accept.
 */
export const organizationInvitation = sqliteTable(
  "auth_organization_invitation",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().notNull(),
    tokenHash: text().notNull(),
    invitedByUserId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp().notNull(),
    acceptedAt: timestamp(),
    revokedAt: timestamp(),
    createdAt: timestamp().default(nowDefault).notNull(),
  },
  (table) => [
    uniqueIndex("auth_organization_invitation_token_idx").on(table.tokenHash),
    uniqueIndex("auth_organization_invitation_pending_idx")
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index("auth_organization_invitation_email_idx").on(table.email),
    index("auth_organization_invitation_org_idx").on(table.organizationId),
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

/**
 * Login, OTP, invitation, and Google identity throttles. One statement both
 * counts and decides, because D1 has no transactions and KV get-then-put
 * races. `expiresAt` is milliseconds, matching `Clock.currentTimeMillis`.
 */
export const rateLimit = sqliteTable("auth_rate_limit", {
  key: text().primaryKey(),
  count: integer().notNull(),
  expiresAt: integer().notNull(),
});
