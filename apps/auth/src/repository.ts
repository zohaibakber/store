import {
  EmailAddress,
  OrganizationId,
  OrganizationRole,
  PasswordHash,
  SessionId,
  UserId,
  type AuthClientKind,
  type EmailAddress as EmailAddressType,
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
});
export interface UserRecord extends Schema.Schema.Type<typeof UserRecord> {}

const MembershipRecord = Schema.Struct({
  organizationId: OrganizationId,
  organizationName: Schema.String,
  organizationSlug: Schema.NullOr(Schema.String),
  role: OrganizationRole,
});
export interface MembershipRecord extends Schema.Schema.Type<typeof MembershipRecord> {}

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

export class RepositoryError extends Schema.TaggedErrorClass<RepositoryError>()(
  "Auth.RepositoryError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export interface NewSession {
  readonly id: SessionIdType;
  readonly familyId: string;
  readonly userId: UserIdType;
  readonly activeOrganizationId: OrganizationIdType;
  readonly refreshTokenHash: string;
  readonly client: AuthClientKind;
  readonly expiresAt: number;
}

export interface AuthRepositoryApi {
  readonly findUserByEmail: (
    email: EmailAddressType,
  ) => Effect.Effect<UserRecord | null, RepositoryError>;
  readonly findUserById: (
    userId: UserIdType,
  ) => Effect.Effect<UserRecord | null, RepositoryError>;
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
  readonly attachGoogleAccount: (input: {
    readonly userId: UserIdType;
    readonly providerAccountId: string;
  }) => Effect.Effect<void, RepositoryError>;
  readonly membershipForUser: (
    userId: UserIdType,
  ) => Effect.Effect<MembershipRecord, RepositoryError>;
  readonly membershipsForUser: (
    userId: UserIdType,
  ) => Effect.Effect<ReadonlyArray<MembershipRecord>, RepositoryError>;
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
  readonly revokeFamily: (
    familyId: string,
    now: number,
  ) => Effect.Effect<void, RepositoryError>;
  readonly revokeUser: (
    userId: UserIdType,
    now: number,
  ) => Effect.Effect<void, RepositoryError>;
}

export class AuthRepository extends Context.Service<AuthRepository, AuthRepositoryApi>()(
  "@store/auth-worker/AuthRepository",
) {}

const repositoryError = (operation: string, cause: unknown) =>
  new RepositoryError({ operation, message: String(cause) });

const decodeNullable = <A, I>(
  schema: Schema.Schema<A, I, never>,
  operation: string,
  value: unknown,
) => {
  if (value === null) return Effect.succeed(null);
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => repositoryError(operation, cause)),
  );
};

const makeId = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownSync(schema)(crypto.randomUUID());

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
              .prepare(
                `SELECT id, email, name, image, passwordHash
                 FROM auth_user WHERE email = ?`,
              )
              .bind(email)
              .first(),
          catch: (cause) => repositoryError("findUserByEmail", cause),
        });
        return yield* decodeNullable(UserRecord, "findUserByEmail.decode", row);
      }),
      findUserById: Effect.fn("AuthRepository.findUserById")(function* (userId) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT id, email, name, image, passwordHash
                 FROM auth_user WHERE id = ?`,
              )
              .bind(userId)
              .first(),
          catch: (cause) => repositoryError("findUserById", cause),
        });
        return yield* decodeNullable(UserRecord, "findUserById.decode", row);
      }),
      findUserByGoogleId: Effect.fn("AuthRepository.findUserByGoogleId")(function* (
        providerAccountId,
      ) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT u.id, u.email, u.name, u.image, u.passwordHash
                 FROM auth_oauth_account a
                 JOIN auth_user u ON u.id = a.userId
                 WHERE a.provider = 'google' AND a.providerAccountId = ?`,
              )
              .bind(providerAccountId)
              .first(),
          catch: (cause) => repositoryError("findUserByGoogleId", cause),
        });
        return yield* decodeNullable(UserRecord, "findUserByGoogleId.decode", row);
      }),
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
        });
      }),
      attachGoogleAccount: Effect.fn("AuthRepository.attachGoogleAccount")(function* (input) {
        yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `INSERT INTO auth_oauth_account (
                  id, userId, provider, providerAccountId, createdAt
                ) VALUES (?, ?, 'google', ?, unixepoch())
                ON CONFLICT(provider, providerAccountId) DO UPDATE SET userId = excluded.userId`,
              )
              .bind(crypto.randomUUID(), input.userId, input.providerAccountId)
              .run(),
          catch: (cause) => repositoryError("attachGoogleAccount", cause),
        });
      }),
      membershipForUser: Effect.fn("AuthRepository.membershipForUser")(function* (userId) {
        const row = yield* Effect.tryPromise({
          try: () =>
            database
              .prepare(
                `SELECT
                  m.organizationId,
                  o.name AS organizationName,
                  o.slug AS organizationSlug,
                  m.role
                FROM auth_organization_membership m
                JOIN auth_organization o ON o.id = m.organizationId
                WHERE m.userId = ?
                ORDER BY m.createdAt ASC LIMIT 1`,
              )
              .bind(userId)
              .first(),
          catch: (cause) => repositoryError("membershipForUser", cause),
        });
        const membership = yield* decodeNullable(
          MembershipRecord,
          "membershipForUser.decode",
          row,
        );
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
              .prepare(
                `SELECT
                  m.organizationId,
                  o.name AS organizationName,
                  o.slug AS organizationSlug,
                  m.role
                FROM auth_organization_membership m
                JOIN auth_organization o ON o.id = m.organizationId
                WHERE m.userId = ?
                ORDER BY m.createdAt ASC`,
              )
              .bind(userId)
              .all(),
          catch: (cause) => repositoryError("membershipsForUser", cause),
        });
        return yield* Schema.decodeUnknownEffect(Schema.Array(MembershipRecord))(
          result.results,
        ).pipe(
          Effect.mapError((cause) => repositoryError("membershipsForUser.decode", cause)),
        );
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
              .first(),
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
