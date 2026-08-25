import type { D1Database } from "@cloudflare/workers-types";
import * as D1Client from "@effect/sql-d1/D1Client";
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
  type OrganizationSlug as OrganizationSlugType,
  type PasswordHash as PasswordHashType,
  type SessionId as SessionIdType,
  type UserId as UserIdType,
} from "@store/auth";
import {
  oauthAccount,
  organization,
  organizationInvitation,
  organizationMembership,
  rateLimit,
  session,
  user,
} from "@store/db/auth.schema";
import { and, asc, count, desc, eq, exists, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as D1Drizzle from "drizzle-orm/effect-d1";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import type { RateLimitAttempt } from "./rate-limit";

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

export class RepositoryError extends Schema.TaggedError<RepositoryError>()("Auth.RepositoryError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
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
  readonly membershipInOrganization: (input: {
    readonly userId: UserIdType;
    readonly organizationId: OrganizationIdType;
  }) => Effect.Effect<MembershipRecord | null, RepositoryError>;
  /**
   * Renames the organization in place. Answers `null` when the handle is
   * taken, which the unique index is what actually decides.
   */
  readonly updateOrganization: (input: {
    readonly organizationId: OrganizationIdType;
    readonly name: string;
    readonly slug: OrganizationSlugType | null;
    readonly role: OrganizationRoleType;
  }) => Effect.Effect<MembershipRecord | null, RepositoryError>;
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
  /**
   * Points a live session at the organization an invitation was for. The
   * access token still names the old one until the session is refreshed.
   */
  readonly moveSession: (input: {
    readonly sessionId: SessionIdType;
    readonly organizationId: OrganizationIdType;
  }) => Effect.Effect<void, RepositoryError>;
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
  /**
   * Increments `key` when the window still has room. Empty RETURNING is a
   * denial, so two concurrent attempts cannot both slip under the cap.
   */
  readonly allowRateLimit: (input: RateLimitAttempt) => Effect.Effect<boolean, RepositoryError>;
}

export class AuthRepository extends Context.Service<AuthRepository, AuthRepositoryApi>()(
  "@store/auth-worker/AuthRepository",
) {}

const repositoryError = (operation: string, cause: unknown) =>
  new RepositoryError({ operation, message: String(cause), cause });

const makeId = <A>(schema: Schema.ConstraintDecoder<A>) =>
  Schema.decodeUnknownSync(schema)(crypto.randomUUID());

const at = (milliseconds: number) => /* @__PURE__ */ new Date(milliseconds);
const millis = (value: Date | null) => (value === null ? null : value.getTime());

type AuthDrizzle = Effect.Success<ReturnType<typeof D1Drizzle.makeWithDefaults>>;

interface Compilable {
  readonly toSQL: () => { readonly sql: string; readonly params: ReadonlyArray<unknown> };
}

interface ReturnedId {
  readonly id: string;
}

const isHandleTaken = (cause: unknown) =>
  cause instanceof EffectDrizzleQueryError &&
  cause.cause instanceof SqlError &&
  cause.cause.reason instanceof UniqueViolation;

const userColumns = {
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image,
  passwordHash: user.passwordHash,
  emailVerifiedAt: user.emailVerifiedAt,
};

interface UserColumns {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly passwordHash: string | null;
  readonly emailVerifiedAt: Date | null;
}

const membershipColumns = {
  organizationId: organizationMembership.organizationId,
  organizationName: organization.name,
  organizationSlug: organization.slug,
  role: organizationMembership.role,
};

const invitationColumns = {
  id: organizationInvitation.id,
  organizationId: organizationInvitation.organizationId,
  organizationName: organization.name,
  organizationSlug: organization.slug,
  email: organizationInvitation.email,
  role: organizationInvitation.role,
  invitedByUserId: organizationInvitation.invitedByUserId,
  expiresAt: organizationInvitation.expiresAt,
  acceptedAt: organizationInvitation.acceptedAt,
  revokedAt: organizationInvitation.revokedAt,
  createdAt: organizationInvitation.createdAt,
};

interface InvitationColumns {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string | null;
  readonly email: string;
  readonly role: string;
  readonly invitedByUserId: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

const sessionColumns = {
  id: session.id,
  familyId: session.familyId,
  userId: session.userId,
  activeOrganizationId: session.activeOrganizationId,
  refreshTokenHash: session.refreshTokenHash,
  clientKind: session.clientKind,
  deviceName: session.deviceName,
  expiresAt: session.expiresAt,
  revokedAt: session.revokedAt,
  replacedBySessionId: session.replacedBySessionId,
};

const decode =
  <A>(schema: Schema.ConstraintDecoder<A>, operation: string) =>
  <Row>(row: Row) =>
    Schema.decodeUnknownEffect(schema)(row).pipe(
      Effect.mapError((cause) => repositoryError(operation, cause)),
    );

const asUser = (row: UserColumns | undefined, operation: string) =>
  row === undefined
    ? Effect.succeed(null)
    : decode(
        UserRecord,
        operation,
      )({
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image,
        passwordHash: row.passwordHash,
        emailVerified: row.emailVerifiedAt !== null,
      });

const asInvitation = (row: InvitationColumns, operation: string) =>
  decode(
    InvitationRecord,
    operation,
  )({
    ...row,
    expiresAt: row.expiresAt.getTime(),
    acceptedAt: millis(row.acceptedAt),
    revokedAt: millis(row.revokedAt),
    createdAt: row.createdAt.getTime(),
  });

const stillPending = (now: number) =>
  and(
    isNull(organizationInvitation.acceptedAt),
    isNull(organizationInvitation.revokedAt),
    gt(organizationInvitation.expiresAt, at(now)),
  );

const sessionValues = (input: NewSession) => ({
  id: input.id,
  familyId: input.familyId,
  userId: input.userId,
  activeOrganizationId: input.activeOrganizationId,
  refreshTokenHash: input.refreshTokenHash,
  clientKind: input.client._tag,
  deviceName: input.client._tag === "Native" ? input.client.deviceName : null,
  expiresAt: at(input.expiresAt),
});

const ownerMembership = (organizationId: OrganizationIdType, userId: UserIdType) => ({
  id: crypto.randomUUID(),
  organizationId,
  userId,
  role: "owner" as const,
});

const startingOrganization = (name: string) => ({
  id: makeId(OrganizationId),
  name: `${name || "My"}'s Store`,
});

export const makeAuthRepository = (database: AuthDrizzle): AuthRepositoryApi => {
  const client = database.$client;
  const fail = (operation: string) =>
    Effect.mapError((cause: unknown) => repositoryError(operation, cause));

  /**
   * D1 has no transactions, only atomic batches, so every statement a guard
   * depends on is compiled from its query builder and sent as one request.
   * `RETURNING` is what reports whether a guarded statement matched, because a
   * batch answers with rows rather than with an affected-row count.
   */
  const batch = (operation: string, queries: ReadonlyArray<Compilable>) =>
    client
      .batch(
        queries.map((query) => {
          const compiled = query.toSQL();
          return client.unsafe<ReturnedId>(compiled.sql, compiled.params);
        }),
      )
      .pipe(fail(operation));

  const invitationById = (invitationId: string) =>
    database
      .select(invitationColumns)
      .from(organizationInvitation)
      .innerJoin(organization, eq(organization.id, organizationInvitation.organizationId))
      .where(eq(organizationInvitation.id, invitationId));

  const membershipOf = (userId: UserIdType, organizationId: OrganizationIdType) =>
    database
      .select(membershipColumns)
      .from(organizationMembership)
      .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
      .where(
        and(
          eq(organizationMembership.userId, userId),
          eq(organizationMembership.organizationId, organizationId),
        ),
      );

  const findUserWhere = Effect.fn("AuthRepository.findUserWhere")(function* (
    operation: string,
    rows: Effect.Effect<ReadonlyArray<UserColumns>, unknown>,
  ) {
    const [row] = yield* rows.pipe(fail(operation));
    return yield* asUser(row, `${operation}.decode`);
  });

  return {
    findUserByEmail: (email) =>
      findUserWhere(
        "findUserByEmail",
        database.select(userColumns).from(user).where(eq(user.email, email)),
      ),
    findUserById: (userId) =>
      findUserWhere(
        "findUserById",
        database.select(userColumns).from(user).where(eq(user.id, userId)),
      ),
    findUserByGoogleId: (providerAccountId) =>
      findUserWhere(
        "findUserByGoogleId",
        database
          .select(userColumns)
          .from(oauthAccount)
          .innerJoin(user, eq(user.id, oauthAccount.userId))
          .where(
            and(
              eq(oauthAccount.provider, "google"),
              eq(oauthAccount.providerAccountId, providerAccountId),
            ),
          ),
      ),
    createPasswordUser: Effect.fn("AuthRepository.createPasswordUser")(function* (input) {
      const userId = makeId(UserId);
      const name = input.name.trim();
      const store = startingOrganization(name);
      yield* batch("createPasswordUser", [
        database.insert(user).values({
          id: userId,
          email: input.email,
          name,
          image: null,
          passwordHash: input.passwordHash,
          emailVerifiedAt: null,
        }),
        database.insert(organization).values({ id: store.id, name: store.name, slug: null }),
        database.insert(organizationMembership).values(ownerMembership(store.id, userId)),
      ]);
      return UserRecord.make({
        id: userId,
        email: input.email,
        name,
        image: null,
        passwordHash: input.passwordHash,
        emailVerified: false,
      });
    }),
    createGoogleUser: Effect.fn("AuthRepository.createGoogleUser")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const userId = makeId(UserId);
      const name = input.name.trim();
      const store = startingOrganization(name);
      yield* batch("createGoogleUser", [
        database.insert(user).values({
          id: userId,
          email: input.email,
          name,
          image: input.image,
          passwordHash: null,
          emailVerifiedAt: at(now),
        }),
        database.insert(organization).values({ id: store.id, name: store.name, slug: null }),
        database.insert(organizationMembership).values(ownerMembership(store.id, userId)),
        database.insert(oauthAccount).values({
          id: crypto.randomUUID(),
          userId,
          provider: "google",
          providerAccountId: input.providerAccountId,
        }),
      ]);
      return UserRecord.make({
        id: userId,
        email: input.email,
        name,
        image: input.image,
        passwordHash: null,
        emailVerified: true,
      });
    }),
    attachGoogleAccount: Effect.fn("AuthRepository.attachGoogleAccount")(function* (input) {
      const linked = yield* database
        .insert(oauthAccount)
        .values({
          id: crypto.randomUUID(),
          userId: input.userId,
          provider: "google",
          providerAccountId: input.providerAccountId,
        })
        .onConflictDoNothing({
          target: [oauthAccount.provider, oauthAccount.providerAccountId],
        })
        .returning({ id: oauthAccount.id })
        .pipe(fail("attachGoogleAccount"));
      return linked.length === 1;
    }),
    claimUnverifiedPasswordUser: Effect.fn("AuthRepository.claimUnverifiedPasswordUser")(
      function* (input) {
        // The link is written first and every following statement requires it
        // to name this user, so an identity another account already holds
        // leaves the password and the sessions untouched.
        const ownsIdentity = exists(
          database
            .select({ id: oauthAccount.id })
            .from(oauthAccount)
            .where(
              and(
                eq(oauthAccount.provider, "google"),
                eq(oauthAccount.providerAccountId, input.providerAccountId),
                eq(oauthAccount.userId, input.userId),
              ),
            ),
        );
        const results = yield* batch("claimUnverifiedPasswordUser", [
          database
            .insert(oauthAccount)
            .values({
              id: crypto.randomUUID(),
              userId: input.userId,
              provider: "google",
              providerAccountId: input.providerAccountId,
            })
            .onConflictDoNothing({
              target: [oauthAccount.provider, oauthAccount.providerAccountId],
            }),
          database
            .update(user)
            .set({
              passwordHash: null,
              emailVerifiedAt: at(input.now),
              image: sql`coalesce(${user.image}, ${input.image})`,
            })
            .where(
              and(
                eq(user.id, input.userId),
                isNotNull(user.passwordHash),
                isNull(user.emailVerifiedAt),
                ownsIdentity,
              ),
            )
            .returning({ id: user.id }),
          database
            .update(session)
            .set({ revokedAt: at(input.now) })
            .where(and(eq(session.userId, input.userId), isNull(session.revokedAt), ownsIdentity)),
        ]);
        return (results[1]?.length ?? 0) === 1;
      },
    ),
    membershipForUser: Effect.fn("AuthRepository.membershipForUser")(function* (userId) {
      const [row] = yield* database
        .select(membershipColumns)
        .from(organizationMembership)
        .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
        .where(eq(organizationMembership.userId, userId))
        .orderBy(asc(organizationMembership.createdAt))
        .limit(1)
        .pipe(fail("membershipForUser"));
      if (!row) {
        return yield* repositoryError(
          "membershipForUser",
          `User ${userId} has no organization membership.`,
        );
      }
      return yield* decode(MembershipRecord, "membershipForUser.decode")(row);
    }),
    membershipInOrganization: Effect.fn("AuthRepository.membershipInOrganization")(
      function* (input) {
        const [row] = yield* membershipOf(input.userId, input.organizationId).pipe(
          fail("membershipInOrganization"),
        );
        if (!row) return null;
        return yield* decode(MembershipRecord, "membershipInOrganization.decode")(row);
      },
    ),
    updateOrganization: Effect.fn("AuthRepository.updateOrganization")(function* (input) {
      const updated = yield* database
        .update(organization)
        .set({ name: input.name, slug: input.slug })
        .where(eq(organization.id, input.organizationId))
        .returning({ id: organization.id, name: organization.name, slug: organization.slug })
        .pipe(
          Effect.map((rows) => rows[0]),
          Effect.catchIf(isHandleTaken, () => Effect.succeed(undefined)),
          fail("updateOrganization"),
        );
      if (!updated) return null;
      return yield* decode(
        MembershipRecord,
        "updateOrganization.decode",
      )({
        organizationId: updated.id,
        organizationName: updated.name,
        organizationSlug: updated.slug,
        role: input.role,
      });
    }),
    listMembers: Effect.fn("AuthRepository.listMembers")(function* (organizationId) {
      const rows = yield* database
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: organizationMembership.role,
          joinedAt: organizationMembership.createdAt,
        })
        .from(organizationMembership)
        .innerJoin(user, eq(user.id, organizationMembership.userId))
        .where(eq(organizationMembership.organizationId, organizationId))
        .orderBy(asc(organizationMembership.createdAt))
        .pipe(fail("listMembers"));
      return yield* decode(
        Schema.Array(OrganizationMember),
        "listMembers.decode",
      )(rows.map((row) => ({ ...row, joinedAt: row.joinedAt.getTime() })));
    }),
    countRole: Effect.fn("AuthRepository.countRole")(function* (input) {
      const [row] = yield* database
        .select({ total: count() })
        .from(organizationMembership)
        .where(
          and(
            eq(organizationMembership.organizationId, input.organizationId),
            eq(organizationMembership.role, input.role),
          ),
        )
        .pipe(fail("countRole"));
      return row?.total ?? 0;
    }),
    changeMemberRole: Effect.fn("AuthRepository.changeMemberRole")(function* (input) {
      const changed = yield* database
        .update(organizationMembership)
        .set({ role: input.role })
        .where(
          and(
            eq(organizationMembership.organizationId, input.organizationId),
            eq(organizationMembership.userId, input.userId),
            ne(organizationMembership.role, input.role),
          ),
        )
        .returning({ id: organizationMembership.id })
        .pipe(fail("changeMemberRole"));
      return changed.length === 1;
    }),
    removeMember: Effect.fn("AuthRepository.removeMember")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const results = yield* batch("removeMember", [
        database
          .delete(organizationMembership)
          .where(
            and(
              eq(organizationMembership.organizationId, input.organizationId),
              eq(organizationMembership.userId, input.userId),
            ),
          )
          .returning({ id: organizationMembership.id }),
        // A session naming an organization the user left would keep refreshing
        // into a store they can no longer read.
        database
          .update(session)
          .set({ revokedAt: at(now) })
          .where(
            and(
              eq(session.userId, input.userId),
              eq(session.activeOrganizationId, input.organizationId),
              isNull(session.revokedAt),
            ),
          ),
      ]);
      return (results[0]?.length ?? 0) === 1;
    }),
    createInvitation: Effect.fn("AuthRepository.createInvitation")(function* (input) {
      const invitationId = makeId(InvitationId);
      yield* batch("createInvitation", [
        database
          .update(organizationInvitation)
          .set({ revokedAt: at(input.now) })
          .where(
            and(
              eq(organizationInvitation.organizationId, input.organizationId),
              eq(organizationInvitation.email, input.email),
              isNull(organizationInvitation.acceptedAt),
              isNull(organizationInvitation.revokedAt),
            ),
          ),
        database.insert(organizationInvitation).values({
          id: invitationId,
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: input.tokenHash,
          invitedByUserId: input.invitedByUserId,
          expiresAt: at(input.expiresAt),
          acceptedAt: null,
          revokedAt: null,
          createdAt: at(input.now),
        }),
      ]);
      const [row] = yield* invitationById(invitationId).pipe(fail("createInvitation.read"));
      if (!row) {
        return yield* repositoryError("createInvitation", "The invitation was not stored.");
      }
      return yield* asInvitation(row, "createInvitation.decode");
    }),
    revokeInvitation: Effect.fn("AuthRepository.revokeInvitation")(function* (input) {
      const revoked = yield* database
        .update(organizationInvitation)
        .set({ revokedAt: at(input.now) })
        .where(
          and(
            eq(organizationInvitation.id, input.invitationId),
            eq(organizationInvitation.organizationId, input.organizationId),
            isNull(organizationInvitation.acceptedAt),
            isNull(organizationInvitation.revokedAt),
          ),
        )
        .returning({ id: organizationInvitation.id })
        .pipe(fail("revokeInvitation"));
      return revoked.length === 1;
    }),
    findInvitationByTokenHash: Effect.fn("AuthRepository.findInvitationByTokenHash")(
      function* (tokenHash) {
        const [row] = yield* database
          .select(invitationColumns)
          .from(organizationInvitation)
          .innerJoin(organization, eq(organization.id, organizationInvitation.organizationId))
          .where(eq(organizationInvitation.tokenHash, tokenHash))
          .pipe(fail("findInvitationByTokenHash"));
        if (!row) return null;
        return yield* asInvitation(row, "findInvitationByTokenHash.decode");
      },
    ),
    pendingInvitationsForOrganization: Effect.fn(
      "AuthRepository.pendingInvitationsForOrganization",
    )(function* (input) {
      const rows = yield* database
        .select(invitationColumns)
        .from(organizationInvitation)
        .innerJoin(organization, eq(organization.id, organizationInvitation.organizationId))
        .where(
          and(
            eq(organizationInvitation.organizationId, input.organizationId),
            stillPending(input.now),
          ),
        )
        .orderBy(desc(organizationInvitation.createdAt))
        .pipe(fail("pendingInvitationsForOrganization"));
      return yield* Effect.forEach(rows, (row) =>
        asInvitation(row, "pendingInvitationsForOrganization.decode"),
      );
    }),
    acceptInvitation: Effect.fn("AuthRepository.acceptInvitation")(function* (input) {
      const results = yield* batch("acceptInvitation", [
        database
          .update(organizationInvitation)
          .set({ acceptedAt: at(input.now) })
          .where(and(eq(organizationInvitation.id, input.invitation.id), stillPending(input.now)))
          .returning({ id: organizationInvitation.id }),
        database
          .insert(organizationMembership)
          .values({
            id: crypto.randomUUID(),
            organizationId: input.invitation.organizationId,
            userId: input.userId,
            role: input.invitation.role,
            createdAt: at(input.now),
          })
          .onConflictDoNothing({
            target: [organizationMembership.organizationId, organizationMembership.userId],
          })
          .returning({ id: organizationMembership.id }),
      ]);
      if ((results[0]?.length ?? 0) === 1) return true;
      // A batch rolls back on a failed statement, not on one that matched no
      // row, so a token spent concurrently has to undo its own insert.
      if ((results[1]?.length ?? 0) === 1) {
        yield* database
          .delete(organizationMembership)
          .where(
            and(
              eq(organizationMembership.organizationId, input.invitation.organizationId),
              eq(organizationMembership.userId, input.userId),
            ),
          )
          .pipe(fail("acceptInvitation.cleanup"));
      }
      return false;
    }),
    createSession: Effect.fn("AuthRepository.createSession")(function* (input) {
      yield* database.insert(session).values(sessionValues(input)).pipe(fail("createSession"));
    }),
    findSession: Effect.fn("AuthRepository.findSession")(function* (sessionId) {
      const [row] = yield* database
        .select(sessionColumns)
        .from(session)
        .where(eq(session.id, sessionId))
        .pipe(fail("findSession"));
      if (!row) return null;
      return yield* decode(
        SessionRecord,
        "findSession.decode",
      )({
        ...row,
        expiresAt: row.expiresAt.getTime(),
        revokedAt: millis(row.revokedAt),
      });
    }),
    moveSession: Effect.fn("AuthRepository.moveSession")(function* (input) {
      yield* database
        .update(session)
        .set({ activeOrganizationId: input.organizationId })
        .where(and(eq(session.id, input.sessionId), isNull(session.revokedAt)))
        .pipe(fail("moveSession"));
    }),
    rotateSession: Effect.fn("AuthRepository.rotateSession")(function* (input) {
      const results = yield* batch("rotateSession", [
        database
          .update(session)
          .set({
            revokedAt: at(input.now),
            replacedBySessionId: input.replacement.id,
            lastUsedAt: at(input.now),
          })
          .where(
            and(
              eq(session.id, input.currentId),
              isNull(session.revokedAt),
              gt(session.expiresAt, at(input.now)),
            ),
          )
          .returning({ id: session.id }),
        database.insert(session).values(sessionValues(input.replacement)),
      ]);
      if ((results[0]?.length ?? 0) === 1) return true;
      yield* database
        .delete(session)
        .where(eq(session.id, input.replacement.id))
        .pipe(fail("rotateSession.cleanup"));
      return false;
    }),
    revokeSession: Effect.fn("AuthRepository.revokeSession")(function* (sessionId, now) {
      yield* database
        .update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.id, sessionId), isNull(session.revokedAt)))
        .pipe(fail("revokeSession"));
    }),
    revokeFamily: Effect.fn("AuthRepository.revokeFamily")(function* (familyId, now) {
      yield* database
        .update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.familyId, familyId), isNull(session.revokedAt)))
        .pipe(fail("revokeFamily"));
    }),
    revokeUser: Effect.fn("AuthRepository.revokeUser")(function* (userId, now) {
      yield* database
        .update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.userId, userId), isNull(session.revokedAt)))
        .pipe(fail("revokeUser"));
    }),
    allowRateLimit: Effect.fn("AuthRepository.allowRateLimit")(function* (input) {
      const expiresAt = input.now + input.windowSeconds * 1_000;
      const granted = yield* database
        .insert(rateLimit)
        .values({
          key: input.key,
          count: 1,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: rateLimit.key,
          set: {
            count: sql`CASE WHEN ${rateLimit.expiresAt} <= ${input.now} THEN 1 WHEN ${rateLimit.count} < ${input.limit} THEN ${rateLimit.count} + 1 ELSE ${rateLimit.count} END`,
            expiresAt: sql`CASE WHEN ${rateLimit.expiresAt} <= ${input.now} THEN excluded.expiresAt ELSE ${rateLimit.expiresAt} END`,
          },
          setWhere: sql`${rateLimit.expiresAt} <= ${input.now} OR ${rateLimit.count} < ${input.limit}`,
        })
        .returning({ count: rateLimit.count })
        .pipe(fail("allowRateLimit"));
      return granted.length === 1;
    }),
  };
};

export const authRepositoryLayer = (database: D1Database) =>
  Layer.effect(
    AuthRepository,
    Effect.map(D1Drizzle.makeWithDefaults({}), (drizzle) =>
      AuthRepository.of(makeAuthRepository(drizzle)),
    ),
  ).pipe(Layer.provide(D1Client.layer({ db: database })));
