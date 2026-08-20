import type { D1Database } from "@cloudflare/workers-types";
import {
  EmailAddress,
  InvitationId,
  OrganizationId,
  OrganizationMember,
  OrganizationRole,
  PasswordHash,
  SessionId,
  UserId,
  type AuthClientKind,
  type EmailAddress as EmailAddressType,
  type InvitationId as InvitationIdType,
  type OrganizationId as OrganizationIdType,
  type OrganizationRole as OrganizationRoleType,
  type PasswordHash as PasswordHashType,
  type SessionId as SessionIdType,
  type UserId as UserIdType,
} from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const UserRecord = Schema.Struct({
  id: UserId,
  email: EmailAddress,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  passwordHash: Schema.NullOr(PasswordHash),
  /** Whether anyone has ever proven they read mail at this address. */
  emailVerified: Schema.Boolean,
});
export interface UserRecord extends Schema.Schema.Type<typeof UserRecord> {}

const MembershipRecord = Schema.Struct({
  organizationId: OrganizationId,
  organizationName: Schema.String,
  organizationSlug: Schema.NullOr(Schema.String),
  role: OrganizationRole,
});
export interface MembershipRecord extends Schema.Schema.Type<typeof MembershipRecord> {}

/**
 * The stored invitation, including the fields that decide whether it can still
 * be redeemed. {@link OrganizationInvitation} is the subset a client sees.
 */
const InvitationRecord = Schema.Struct({
  id: InvitationId,
  organizationId: OrganizationId,
  organizationName: Schema.String,
  organizationSlug: Schema.NullOr(Schema.String),
  email: EmailAddress,
  role: OrganizationRole,
  invitedByUserId: UserId,
  expiresAt: Schema.Number,
  acceptedAt: Schema.NullOr(Schema.Number),
  revokedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
});
export interface InvitationRecord extends Schema.Schema.Type<typeof InvitationRecord> {}

const SessionRecord = Schema.Struct({
  id: SessionId,
  familyId: Schema.String,
  userId: UserId,
  activeOrganizationId: OrganizationId,
  refreshTokenHash: Schema.String,
  clientKind: Schema.Literals(["Browser", "Native"]),
  deviceName: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
  revokedAt: Schema.NullOr(Schema.Number),
  replacedBySessionId: Schema.NullOr(SessionId),
});
export interface SessionRecord extends Schema.Schema.Type<typeof SessionRecord> {}

/** SQLite has no boolean, so verification arrives as `0` or `1`. */
interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly passwordHash: string | null;
  readonly emailVerified: number;
}

interface DecodableUserRow extends Omit<UserRow, "emailVerified"> {
  readonly emailVerified: boolean;
}

interface MembershipRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string | null;
  readonly role: string;
}

interface InvitationRow {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string | null;
  readonly email: string;
  readonly role: string;
  readonly invitedByUserId: string;
  readonly expiresAt: number;
  readonly acceptedAt: number | null;
  readonly revokedAt: number | null;
  readonly createdAt: number;
}

interface SessionRow {
  readonly id: string;
  readonly familyId: string;
  readonly userId: string;
  readonly activeOrganizationId: string;
  readonly refreshTokenHash: string;
  readonly clientKind: string;
  readonly deviceName: string | null;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly replacedBySessionId: string | null;
}

type AuthRow = DecodableUserRow | MembershipRow | InvitationRow | SessionRow;

export class RepositoryError extends Schema.TaggedError<RepositoryError>()("Auth.RepositoryError", {
  operation: Schema.String,
  message: Schema.String,
}) {}

export interface NewSession {
  readonly id: SessionIdType;
  readonly familyId: string;
  readonly userId: UserIdType;
  readonly activeOrganizationId: OrganizationIdType;
  readonly refreshTokenHash: string;
  readonly client: AuthClientKind;
  readonly expiresAt: number;
}

export interface NewInvitation {
  readonly organizationId: OrganizationIdType;
  readonly email: EmailAddressType;
  readonly role: OrganizationRoleType;
  readonly tokenHash: string;
  readonly invitedByUserId: UserIdType;
  readonly expiresAt: number;
  readonly now: number;
}

export interface AuthRepositoryApi {
  readonly findUserByEmail: (
    email: EmailAddressType,
  ) => Effect.Effect<UserRecord | null, RepositoryError>;
  readonly findUserById: (userId: UserIdType) => Effect.Effect<UserRecord | null, RepositoryError>;
  readonly findUserByGoogleId: (
    providerAccountId: string,
  ) => Effect.Effect<UserRecord | null, RepositoryError>;
  readonly createPasswordUser: (input: {
    readonly email: EmailAddressType;
    readonly name: string;
    readonly passwordHash: PasswordHashType;
  }) => Effect.Effect<UserRecord, RepositoryError>;
  readonly createGoogleUser: (input: {
    readonly email: EmailAddressType;
    readonly name: string;
    readonly image: string | null;
    readonly providerAccountId: string;
  }) => Effect.Effect<UserRecord, RepositoryError>;
  /**
   * Links a Google identity that no user holds yet. Answers `false` when the
   * identity already belongs to somebody, because overwriting the owner would
   * hand that account to whoever presented the identity second.
   */
  readonly attachGoogleAccount: (input: {
    readonly userId: UserIdType;
    readonly providerAccountId: string;
  }) => Effect.Effect<boolean, RepositoryError>;
  /**
   * Google proved control of an address that an unverified password account
   * claimed. The account becomes the Google user's: the password is dropped,
   * the address is marked verified, and every session opened with that
   * password is revoked.
   */
  readonly claimUnverifiedPasswordUser: (input: {
    readonly userId: UserIdType;
    readonly providerAccountId: string;
    readonly image: string | null;
    readonly now: number;
  }) => Effect.Effect<boolean, RepositoryError>;
  readonly membershipForUser: (
    userId: UserIdType,
  ) => Effect.Effect<MembershipRecord, RepositoryError>;
  readonly membershipsForUser: (
    userId: UserIdType,
  ) => Effect.Effect<ReadonlyArray<MembershipRecord>, RepositoryError>;
  readonly membershipInOrganization: (input: {
    readonly userId: UserIdType;
    readonly organizationId: OrganizationIdType;
  }) => Effect.Effect<MembershipRecord | null, RepositoryError>;
  readonly createOrganization: (input: {
    readonly name: string;
    readonly ownerUserId: UserIdType;
  }) => Effect.Effect<MembershipRecord, RepositoryError>;
  readonly listMembers: (
    organizationId: OrganizationIdType,
  ) => Effect.Effect<ReadonlyArray<OrganizationMember>, RepositoryError>;
  readonly countRole: (input: {
    readonly organizationId: OrganizationIdType;
    readonly role: OrganizationRoleType;
  }) => Effect.Effect<number, RepositoryError>;
  readonly changeMemberRole: (input: {
    readonly organizationId: OrganizationIdType;
    readonly userId: UserIdType;
    readonly role: OrganizationRoleType;
  }) => Effect.Effect<boolean, RepositoryError>;
  readonly removeMember: (input: {
    readonly organizationId: OrganizationIdType;
    readonly userId: UserIdType;
  }) => Effect.Effect<boolean, RepositoryError>;
  /** Replaces any live invitation for the same address, so the newest token wins. */
  readonly createInvitation: (
    input: NewInvitation,
  ) => Effect.Effect<InvitationRecord, RepositoryError>;
  readonly revokeInvitation: (input: {
    readonly organizationId: OrganizationIdType;
    readonly invitationId: InvitationIdType;
    readonly now: number;
  }) => Effect.Effect<boolean, RepositoryError>;
  readonly findInvitationByTokenHash: (
    tokenHash: string,
  ) => Effect.Effect<InvitationRecord | null, RepositoryError>;
  readonly pendingInvitationsForOrganization: (input: {
    readonly organizationId: OrganizationIdType;
    readonly now: number;
  }) => Effect.Effect<ReadonlyArray<InvitationRecord>, RepositoryError>;
  readonly pendingInvitationsForEmail: (input: {
    readonly email: EmailAddressType;
    readonly now: number;
  }) => Effect.Effect<ReadonlyArray<InvitationRecord>, RepositoryError>;
  /**
   * Marks the invitation redeemed and adds the membership together. Answers
   * `false` when the invitation was already spent, which is how two concurrent
   * redemptions of one token settle on a single winner.
   */
  readonly acceptInvitation: (input: {
    readonly invitation: InvitationRecord;
    readonly userId: UserIdType;
    readonly now: number;
  }) => Effect.Effect<boolean, RepositoryError>;
  readonly createSession: (input: NewSession) => Effect.Effect<void, RepositoryError>;
  readonly findSession: (
    sessionId: SessionIdType,
  ) => Effect.Effect<SessionRecord | null, RepositoryError>;
  readonly rotateSession: (input: {
    readonly currentId: SessionIdType;
    readonly replacement: NewSession;
    readonly now: number;
  }) => Effect.Effect<boolean, RepositoryError>;
  readonly revokeSession: (
    sessionId: SessionIdType,
    now: number,
  ) => Effect.Effect<void, RepositoryError>;
  readonly revokeFamily: (familyId: string, now: number) => Effect.Effect<void, RepositoryError>;
  readonly revokeUser: (userId: UserIdType, now: number) => Effect.Effect<void, RepositoryError>;
}

export class AuthRepository extends Context.Service<AuthRepository, AuthRepositoryApi>()(
  "@store/auth-worker/AuthRepository",
) {}

const repositoryError = (operation: string, cause: unknown) =>
  new RepositoryError({ operation, message: String(cause) });

const decodeNullable = <A>(
  schema: Schema.ConstraintDecoder<A>,
  operation: string,
  value: AuthRow | null,
) => {
  if (value === null) return Effect.succeed(null);
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => repositoryError(operation, cause)),
  );
};

const decodeUser = (operation: string, row: UserRow | null) =>
  decodeNullable(
    UserRecord,
    operation,
    row === null ? null : { ...row, emailVerified: row.emailVerified !== 0 },
  );

const makeId = <A>(schema: Schema.ConstraintDecoder<A>) =>
  Schema.decodeUnknownSync(schema)(crypto.randomUUID());

const seconds = (milliseconds: number) => Math.floor(milliseconds / 1_000);

const USER_COLUMNS = `id, email, name, image, passwordHash,
  CASE WHEN emailVerifiedAt IS NULL THEN 0 ELSE 1 END AS emailVerified`;

const MEMBERSHIP_SELECT = `SELECT
    m.organizationId,
    o.name AS organizationName,
    o.slug AS organizationSlug,
    m.role
  FROM auth_organization_membership m
  JOIN auth_organization o ON o.id = m.organizationId`;

const INVITATION_SELECT = `SELECT
    i.id,
    i.organizationId,
    o.name AS organizationName,
    o.slug AS organizationSlug,
    i.email,
    i.role,
    i.invitedByUserId,
    i.expiresAt * 1000 AS expiresAt,
    i.acceptedAt * 1000 AS acceptedAt,
    i.revokedAt * 1000 AS revokedAt,
    i.createdAt * 1000 AS createdAt
  FROM auth_organization_invitation i
  JOIN auth_organization o ON o.id = i.organizationId`;

/** A live invitation: not spent, not withdrawn, not stale. */
const PENDING_CLAUSE = "i.acceptedAt IS NULL AND i.revokedAt IS NULL AND i.expiresAt > ?";

const insertSession = (database: D1Database, input: NewSession) =>
  database
    .prepare(
      `INSERT INTO auth_session (
        id, familyId, userId, activeOrganizationId, refreshTokenHash,
        clientKind, deviceName, expiresAt, lastUsedAt, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    )
    .bind(
      input.id,
      input.familyId,
      input.userId,
      input.activeOrganizationId,
      input.refreshTokenHash,
      input.client._tag,
      input.client._tag === "Native" ? input.client.deviceName : null,
      Math.floor(input.expiresAt / 1_000),
    );

export const authRepositoryLayer = (database: D1Database) =>
  Layer.succeed(
    AuthRepository,
    AuthRepository.of({
      findUserByEmail: Effect.fn("AuthRepository.findUserByEmail")(function* (email) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(`SELECT ${USER_COLUMNS} FROM auth_user WHERE email = ?`)
              .bind(email)
              .first<UserRow>(),
          catch: (cause) => repositoryError("findUserByEmail", cause),
        });
        return yield* decodeUser("findUserByEmail.decode", row);
      }),
      findUserById: Effect.fn("AuthRepository.findUserById")(function* (userId) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(`SELECT ${USER_COLUMNS} FROM auth_user WHERE id = ?`)
              .bind(userId)
              .first<UserRow>(),
          catch: (cause) => repositoryError("findUserById", cause),
        });
        return yield* decodeUser("findUserById.decode", row);
      }),
      findUserByGoogleId: Effect.fn("AuthRepository.findUserByGoogleId")(
        function* (providerAccountId) {
          const row = yield* Effect.tryPromise({
            try: () =>
              database
                .prepare(
                  `SELECT u.id, u.email, u.name, u.image, u.passwordHash,
                    CASE WHEN u.emailVerifiedAt IS NULL THEN 0 ELSE 1 END AS emailVerified
                 FROM auth_oauth_account a
                 JOIN auth_user u ON u.id = a.userId
                 WHERE a.provider = 'google' AND a.providerAccountId = ?`,
                )
                .bind(providerAccountId)
                .first<UserRow>(),
            catch: (cause) => repositoryError("findUserByGoogleId", cause),
          });
          return yield* decodeUser("findUserByGoogleId.decode", row);
        },
      ),
      createPasswordUser: Effect.fn("AuthRepository.createPasswordUser")(function* (input) {
        const userId = makeId(UserId);
        const organizationId = makeId(OrganizationId);
        const membershipId = crypto.randomUUID();
        const organizationName = `${input.name.trim() || "My"}'s Store`;
        yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `INSERT INTO auth_user (
                    id, email, name, image, passwordHash, emailVerifiedAt, createdAt, updatedAt
                  ) VALUES (?, ?, ?, NULL, ?, NULL, unixepoch(), unixepoch())`,
                )
                .bind(userId, input.email, input.name.trim(), input.passwordHash),
              database
                .prepare(
                  `INSERT INTO auth_organization (
                    id, name, slug, createdAt, updatedAt
                  ) VALUES (?, ?, NULL, unixepoch(), unixepoch())`,
                )
                .bind(organizationId, organizationName),
              database
                .prepare(
                  `INSERT INTO auth_organization_membership (
                    id, organizationId, userId, role, createdAt
                  ) VALUES (?, ?, ?, 'owner', unixepoch())`,
                )
                .bind(membershipId, organizationId, userId),
            ]),
          catch: (cause) => repositoryError("createPasswordUser", cause),
        });
        return UserRecord.make({
          id: userId,
          email: input.email,
          name: input.name.trim(),
          image: null,
          passwordHash: input.passwordHash,
          emailVerified: false,
        });
      }),
      createGoogleUser: Effect.fn("AuthRepository.createGoogleUser")(function* (input) {
        const userId = makeId(UserId);
        const organizationId = makeId(OrganizationId);
        const membershipId = crypto.randomUUID();
        const organizationName = `${input.name.trim() || "My"}'s Store`;
        yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `INSERT INTO auth_user (
                    id, email, name, image, passwordHash, emailVerifiedAt, createdAt, updatedAt
                  ) VALUES (?, ?, ?, ?, NULL, unixepoch(), unixepoch(), unixepoch())`,
                )
                .bind(userId, input.email, input.name.trim(), input.image),
              database
                .prepare(
                  `INSERT INTO auth_organization (
                    id, name, slug, createdAt, updatedAt
                  ) VALUES (?, ?, NULL, unixepoch(), unixepoch())`,
                )
                .bind(organizationId, organizationName),
              database
                .prepare(
                  `INSERT INTO auth_organization_membership (
                    id, organizationId, userId, role, createdAt
                  ) VALUES (?, ?, ?, 'owner', unixepoch())`,
                )
                .bind(membershipId, organizationId, userId),
              database
                .prepare(
                  `INSERT INTO auth_oauth_account (
                    id, userId, provider, providerAccountId, createdAt
                  ) VALUES (?, ?, 'google', ?, unixepoch())`,
                )
                .bind(crypto.randomUUID(), userId, input.providerAccountId),
            ]),
          catch: (cause) => repositoryError("createGoogleUser", cause),
        });
        return UserRecord.make({
          id: userId,
          email: input.email,
          name: input.name.trim(),
          image: input.image,
          passwordHash: null,
          emailVerified: true,
        });
      }),
      attachGoogleAccount: Effect.fn("AuthRepository.attachGoogleAccount")(function* (input) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `INSERT INTO auth_oauth_account (
                  id, userId, provider, providerAccountId, createdAt
                ) VALUES (?, ?, 'google', ?, unixepoch())
                ON CONFLICT(provider, providerAccountId) DO NOTHING`,
              )
              .bind(crypto.randomUUID(), input.userId, input.providerAccountId)
              .run(),
          catch: (cause) => repositoryError("attachGoogleAccount", cause),
        });
        return (result.meta.changes ?? 0) === 1;
      }),
      claimUnverifiedPasswordUser: Effect.fn("AuthRepository.claimUnverifiedPasswordUser")(
        function* (input) {
          // The link is written first and every following statement requires it
          // to name this user, so an identity another account already holds
          // leaves the password and the sessions untouched.
          const ownsIdentity = `EXISTS (
            SELECT 1 FROM auth_oauth_account
            WHERE provider = 'google' AND providerAccountId = ? AND userId = ?
          )`;
          const results = yield* Effect.tryPromise({
            try: () =>
              database.batch([
                database
                  .prepare(
                    `INSERT INTO auth_oauth_account (
                      id, userId, provider, providerAccountId, createdAt
                    ) VALUES (?, ?, 'google', ?, unixepoch())
                    ON CONFLICT(provider, providerAccountId) DO NOTHING`,
                  )
                  .bind(crypto.randomUUID(), input.userId, input.providerAccountId),
                database
                  .prepare(
                    `UPDATE auth_user
                     SET passwordHash = NULL,
                         emailVerifiedAt = ?,
                         image = COALESCE(image, ?),
                         updatedAt = ?
                     WHERE id = ?
                       AND passwordHash IS NOT NULL
                       AND emailVerifiedAt IS NULL
                       AND ${ownsIdentity}`,
                  )
                  .bind(
                    seconds(input.now),
                    input.image,
                    seconds(input.now),
                    input.userId,
                    input.providerAccountId,
                    input.userId,
                  ),
                database
                  .prepare(
                    `UPDATE auth_session SET revokedAt = ?
                     WHERE userId = ? AND revokedAt IS NULL AND ${ownsIdentity}`,
                  )
                  .bind(seconds(input.now), input.userId, input.providerAccountId, input.userId),
              ]),
            catch: (cause) => repositoryError("claimUnverifiedPasswordUser", cause),
          });
          return (results[1]?.meta.changes ?? 0) === 1;
        },
      ),
      membershipForUser: Effect.fn("AuthRepository.membershipForUser")(function* (userId) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(`${MEMBERSHIP_SELECT} WHERE m.userId = ? ORDER BY m.createdAt ASC LIMIT 1`)
              .bind(userId)
              .first<MembershipRow>(),
          catch: (cause) => repositoryError("membershipForUser", cause),
        });
        const membership = yield* decodeNullable(MembershipRecord, "membershipForUser.decode", row);
        if (!membership) {
          return yield* repositoryError(
            "membershipForUser",
            `User ${userId} has no organization membership.`,
          );
        }
        return membership;
      }),
      membershipsForUser: Effect.fn("AuthRepository.membershipsForUser")(function* (userId) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(`${MEMBERSHIP_SELECT} WHERE m.userId = ? ORDER BY m.createdAt ASC`)
              .bind(userId)
              .all<MembershipRow>(),
          catch: (cause) => repositoryError("membershipsForUser", cause),
        });
        return yield* Schema.decodeUnknownEffect(Schema.Array(MembershipRecord))(
          result.results,
        ).pipe(Effect.mapError((cause) => repositoryError("membershipsForUser.decode", cause)));
      }),
      membershipInOrganization: Effect.fn("AuthRepository.membershipInOrganization")(
        function* (input) {
          const row = yield* Effect.tryPromise({
            try: () =>
              database
                .prepare(`${MEMBERSHIP_SELECT} WHERE m.userId = ? AND m.organizationId = ?`)
                .bind(input.userId, input.organizationId)
                .first<MembershipRow>(),
            catch: (cause) => repositoryError("membershipInOrganization", cause),
          });
          return yield* decodeNullable(MembershipRecord, "membershipInOrganization.decode", row);
        },
      ),
      createOrganization: Effect.fn("AuthRepository.createOrganization")(function* (input) {
        const organizationId = makeId(OrganizationId);
        const name = input.name.trim();
        yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `INSERT INTO auth_organization (
                    id, name, slug, createdAt, updatedAt
                  ) VALUES (?, ?, NULL, unixepoch(), unixepoch())`,
                )
                .bind(organizationId, name),
              database
                .prepare(
                  `INSERT INTO auth_organization_membership (
                    id, organizationId, userId, role, createdAt
                  ) VALUES (?, ?, ?, 'owner', unixepoch())`,
                )
                .bind(crypto.randomUUID(), organizationId, input.ownerUserId),
            ]),
          catch: (cause) => repositoryError("createOrganization", cause),
        });
        return MembershipRecord.make({
          organizationId,
          organizationName: name,
          organizationSlug: null,
          role: "owner",
        });
      }),
      listMembers: Effect.fn("AuthRepository.listMembers")(function* (organizationId) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT
                  u.id AS userId,
                  u.name,
                  u.email,
                  u.image,
                  m.role,
                  m.createdAt * 1000 AS joinedAt
                FROM auth_organization_membership m
                JOIN auth_user u ON u.id = m.userId
                WHERE m.organizationId = ?
                ORDER BY m.createdAt ASC`,
              )
              .bind(organizationId)
              .all(),
          catch: (cause) => repositoryError("listMembers", cause),
        });
        return yield* Schema.decodeUnknownEffect(Schema.Array(OrganizationMember))(
          result.results,
        ).pipe(Effect.mapError((cause) => repositoryError("listMembers.decode", cause)));
      }),
      countRole: Effect.fn("AuthRepository.countRole")(function* (input) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT COUNT(*) AS total FROM auth_organization_membership
                 WHERE organizationId = ? AND role = ?`,
              )
              .bind(input.organizationId, input.role)
              .first<{ readonly total: number }>(),
          catch: (cause) => repositoryError("countRole", cause),
        });
        return row?.total ?? 0;
      }),
      changeMemberRole: Effect.fn("AuthRepository.changeMemberRole")(function* (input) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `UPDATE auth_organization_membership SET role = ?
                 WHERE organizationId = ? AND userId = ? AND role <> ?`,
              )
              .bind(input.role, input.organizationId, input.userId, input.role)
              .run(),
          catch: (cause) => repositoryError("changeMemberRole", cause),
        });
        return (result.meta.changes ?? 0) === 1;
      }),
      removeMember: Effect.fn("AuthRepository.removeMember")(function* (input) {
        const results = yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `DELETE FROM auth_organization_membership
                   WHERE organizationId = ? AND userId = ?`,
                )
                .bind(input.organizationId, input.userId),
              // A session naming an organization the user left would keep
              // refreshing into a store they can no longer read.
              database
                .prepare(
                  `UPDATE auth_session SET revokedAt = unixepoch()
                   WHERE userId = ? AND activeOrganizationId = ? AND revokedAt IS NULL`,
                )
                .bind(input.userId, input.organizationId),
            ]),
          catch: (cause) => repositoryError("removeMember", cause),
        });
        return (results[0]?.meta.changes ?? 0) === 1;
      }),
      createInvitation: Effect.fn("AuthRepository.createInvitation")(function* (input) {
        const invitationId = makeId(InvitationId);
        yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `UPDATE auth_organization_invitation SET revokedAt = ?
                   WHERE organizationId = ? AND email = ?
                     AND acceptedAt IS NULL AND revokedAt IS NULL`,
                )
                .bind(seconds(input.now), input.organizationId, input.email),
              database
                .prepare(
                  `INSERT INTO auth_organization_invitation (
                    id, organizationId, email, role, tokenHash,
                    invitedByUserId, expiresAt, acceptedAt, revokedAt, createdAt
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
                )
                .bind(
                  invitationId,
                  input.organizationId,
                  input.email,
                  input.role,
                  input.tokenHash,
                  input.invitedByUserId,
                  seconds(input.expiresAt),
                  seconds(input.now),
                ),
            ]),
          catch: (cause) => repositoryError("createInvitation", cause),
        });
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(`${INVITATION_SELECT} WHERE i.id = ?`)
              .bind(invitationId)
              .first<InvitationRow>(),
          catch: (cause) => repositoryError("createInvitation.read", cause),
        });
        const invitation = yield* decodeNullable(InvitationRecord, "createInvitation.decode", row);
        if (!invitation) {
          return yield* repositoryError("createInvitation", "The invitation was not stored.");
        }
        return invitation;
      }),
      revokeInvitation: Effect.fn("AuthRepository.revokeInvitation")(function* (input) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `UPDATE auth_organization_invitation SET revokedAt = ?
                 WHERE id = ? AND organizationId = ?
                   AND acceptedAt IS NULL AND revokedAt IS NULL`,
              )
              .bind(seconds(input.now), input.invitationId, input.organizationId)
              .run(),
          catch: (cause) => repositoryError("revokeInvitation", cause),
        });
        return (result.meta.changes ?? 0) === 1;
      }),
      findInvitationByTokenHash: Effect.fn("AuthRepository.findInvitationByTokenHash")(
        function* (tokenHash) {
          const row = yield* Effect.tryPromise({
            try: () =>
              database
                .prepare(`${INVITATION_SELECT} WHERE i.tokenHash = ?`)
                .bind(tokenHash)
                .first<InvitationRow>(),
            catch: (cause) => repositoryError("findInvitationByTokenHash", cause),
          });
          return yield* decodeNullable(InvitationRecord, "findInvitationByTokenHash.decode", row);
        },
      ),
      pendingInvitationsForOrganization: Effect.fn(
        "AuthRepository.pendingInvitationsForOrganization",
      )(function* (input) {
        const result = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `${INVITATION_SELECT} WHERE i.organizationId = ? AND ${PENDING_CLAUSE}
                 ORDER BY i.createdAt DESC`,
              )
              .bind(input.organizationId, seconds(input.now))
              .all<InvitationRow>(),
          catch: (cause) => repositoryError("pendingInvitationsForOrganization", cause),
        });
        return yield* Schema.decodeUnknownEffect(Schema.Array(InvitationRecord))(
          result.results,
        ).pipe(
          Effect.mapError((cause) =>
            repositoryError("pendingInvitationsForOrganization.decode", cause),
          ),
        );
      }),
      pendingInvitationsForEmail: Effect.fn("AuthRepository.pendingInvitationsForEmail")(
        function* (input) {
          const result = yield* Effect.tryPromise({
            try: () =>
              database
                .prepare(
                  `${INVITATION_SELECT} WHERE i.email = ? AND ${PENDING_CLAUSE}
                   ORDER BY i.createdAt DESC`,
                )
                .bind(input.email, seconds(input.now))
                .all<InvitationRow>(),
            catch: (cause) => repositoryError("pendingInvitationsForEmail", cause),
          });
          return yield* Schema.decodeUnknownEffect(Schema.Array(InvitationRecord))(
            result.results,
          ).pipe(
            Effect.mapError((cause) => repositoryError("pendingInvitationsForEmail.decode", cause)),
          );
        },
      ),
      acceptInvitation: Effect.fn("AuthRepository.acceptInvitation")(function* (input) {
        const results = yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `UPDATE auth_organization_invitation SET acceptedAt = ?
                   WHERE id = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > ?`,
                )
                .bind(seconds(input.now), input.invitation.id, seconds(input.now)),
              database
                .prepare(
                  `INSERT INTO auth_organization_membership (
                    id, organizationId, userId, role, createdAt
                  ) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(organizationId, userId) DO NOTHING`,
                )
                .bind(
                  crypto.randomUUID(),
                  input.invitation.organizationId,
                  input.userId,
                  input.invitation.role,
                  seconds(input.now),
                ),
            ]),
          catch: (cause) => repositoryError("acceptInvitation", cause),
        });
        if ((results[0]?.meta.changes ?? 0) === 1) return true;
        // D1 rolls a batch back on a failed statement, not on one that matched
        // no row, so a token spent concurrently has to undo its own insert.
        if ((results[1]?.meta.changes ?? 0) === 1) {
          yield* Effect.tryPromise({
            try: () =>
              database
                .prepare(
                  `DELETE FROM auth_organization_membership
                   WHERE organizationId = ? AND userId = ?`,
                )
                .bind(input.invitation.organizationId, input.userId)
                .run(),
            catch: (cause) => repositoryError("acceptInvitation.cleanup", cause),
          });
        }
        return false;
      }),
      createSession: Effect.fn("AuthRepository.createSession")(function* (input) {
        yield* Effect.tryPromise({
          try: () => insertSession(database, input).run(),
          catch: (cause) => repositoryError("createSession", cause),
        });
      }),
      findSession: Effect.fn("AuthRepository.findSession")(function* (sessionId) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT
                  id, familyId, userId, activeOrganizationId, refreshTokenHash,
                  clientKind, deviceName, expiresAt * 1000 AS expiresAt,
                  revokedAt * 1000 AS revokedAt, replacedBySessionId
                FROM auth_session WHERE id = ?`,
              )
              .bind(sessionId)
              .first<SessionRow>(),
          catch: (cause) => repositoryError("findSession", cause),
        });
        return yield* decodeNullable(SessionRecord, "findSession.decode", row);
      }),
      rotateSession: Effect.fn("AuthRepository.rotateSession")(function* (input) {
        const results = yield* Effect.tryPromise({
          try: () =>
            database.batch([
              database
                .prepare(
                  `UPDATE auth_session
                   SET revokedAt = ?, replacedBySessionId = ?, lastUsedAt = ?
                   WHERE id = ? AND revokedAt IS NULL AND expiresAt > ?`,
                )
                .bind(
                  Math.floor(input.now / 1_000),
                  input.replacement.id,
                  Math.floor(input.now / 1_000),
                  input.currentId,
                  Math.floor(input.now / 1_000),
                ),
              insertSession(database, input.replacement),
            ]),
          catch: (cause) => repositoryError("rotateSession", cause),
        });
        if ((results[0]?.meta.changes ?? 0) === 1) return true;
        yield* Effect.tryPromise({
          try: () =>
            database
              .prepare("DELETE FROM auth_session WHERE id = ?")
              .bind(input.replacement.id)
              .run(),
          catch: (cause) => repositoryError("rotateSession.cleanup", cause),
        });
        return false;
      }),
      revokeSession: Effect.fn("AuthRepository.revokeSession")(function* (sessionId, now) {
        yield* Effect.tryPromise({
          try: () =>
            database
              .prepare("UPDATE auth_session SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL")
              .bind(Math.floor(now / 1_000), sessionId)
              .run(),
          catch: (cause) => repositoryError("revokeSession", cause),
        });
      }),
      revokeFamily: Effect.fn("AuthRepository.revokeFamily")(function* (familyId, now) {
        yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                "UPDATE auth_session SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL",
              )
              .bind(Math.floor(now / 1_000), familyId)
              .run(),
          catch: (cause) => repositoryError("revokeFamily", cause),
        });
      }),
      revokeUser: Effect.fn("AuthRepository.revokeUser")(function* (userId, now) {
        yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                "UPDATE auth_session SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL",
              )
              .bind(Math.floor(now / 1_000), userId)
              .run(),
          catch: (cause) => repositoryError("revokeUser", cause),
        });
      }),
    }),
  );

export const decodeSessionId = Schema.decodeUnknownEffect(SessionId);
export const decodeUserId = Schema.decodeUnknownEffect(UserId);
export const decodeEmail = Schema.decodeUnknownEffect(EmailAddress);
export const decodeRole = Schema.decodeUnknownEffect(OrganizationRole);
