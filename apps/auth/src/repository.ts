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
import {
  oauthAccount,
  organization,
  organizationInvitation,
  organizationMembership,
  session,
  user,
} from "@store/db/auth.schema";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuthCrypto } from "./crypto";
import { AuthD1, bound, runD1Batch, type AuthDrizzle, type CompilableQuery } from "./d1";
import { storageFailureMessage } from "./errors";

const UserRecord = Schema.Struct({
  id: UserId,
  email: EmailAddress,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  passwordHash: Schema.NullOr(PasswordHash),
  emailVerified: Schema.Boolean,
});
export interface UserRecord extends Schema.Schema.Type<typeof UserRecord> {}

const MembershipRecord = Schema.Struct({
  organizationId: OrganizationId,
  organizationName: Schema.String,
  role: OrganizationRole,
});
export interface MembershipRecord extends Schema.Schema.Type<typeof MembershipRecord> {}

const InvitationRecord = Schema.Struct({
  id: InvitationId,
  organizationId: OrganizationId,
  organizationName: Schema.String,
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

export interface RefreshContext {
  readonly session: SessionRecord;
  readonly user: UserRecord | null;
  readonly activeMembership: MembershipRecord | null;
}

export class RepositoryError extends Schema.TaggedError<RepositoryError>()("Auth.RepositoryError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

interface NewSession {
  readonly id: SessionIdType;
  readonly familyId: string;
  readonly userId: UserIdType;
  readonly activeOrganizationId: OrganizationIdType;
  readonly refreshTokenHash: string;
  readonly client: AuthClientKind;
  readonly expiresAt: number;
}

interface NewInvitation {
  readonly organizationId: OrganizationIdType;
  readonly email: EmailAddressType;
  readonly role: OrganizationRoleType;
  readonly tokenHash: string;
  readonly invitedByUserId: UserIdType;
  readonly expiresAt: number;
  readonly now: number;
}

export class AuthRepository extends Context.Service<
  AuthRepository,
  {
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
    readonly replacePasswordHash: (input: {
      readonly userId: UserIdType;
      readonly previous: PasswordHashType;
      readonly next: PasswordHashType;
    }) => Effect.Effect<void, RepositoryError>;
    readonly createGoogleUser: (input: {
      readonly email: EmailAddressType;
      readonly name: string;
      readonly image: string | null;
      readonly providerAccountId: string;
    }) => Effect.Effect<UserRecord, RepositoryError>;
    readonly attachGoogleAccount: (input: {
      readonly userId: UserIdType;
      readonly providerAccountId: string;
    }) => Effect.Effect<boolean, RepositoryError>;
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
    readonly updateOrganization: (input: {
      readonly organizationId: OrganizationIdType;
      readonly name: string;
      readonly role: OrganizationRoleType;
    }) => Effect.Effect<MembershipRecord | null, RepositoryError>;
    readonly listMembers: (
      organizationId: OrganizationIdType,
    ) => Effect.Effect<ReadonlyArray<OrganizationMember>, RepositoryError>;
    readonly changeMemberRole: (input: {
      readonly organizationId: OrganizationIdType;
      readonly userId: UserIdType;
      readonly role: OrganizationRoleType;
    }) => Effect.Effect<boolean, RepositoryError>;
    readonly removeMember: (input: {
      readonly organizationId: OrganizationIdType;
      readonly userId: UserIdType;
    }) => Effect.Effect<boolean, RepositoryError>;
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
    readonly acceptInvitation: (input: {
      readonly invitation: InvitationRecord;
      readonly userId: UserIdType;
      readonly sessionId: SessionIdType;
      readonly now: number;
    }) => Effect.Effect<boolean, RepositoryError>;
    readonly createSession: (input: NewSession) => Effect.Effect<void, RepositoryError>;
    readonly findSession: (
      sessionId: SessionIdType,
    ) => Effect.Effect<SessionRecord | null, RepositoryError>;
    readonly findRefreshContext: (
      sessionId: SessionIdType,
    ) => Effect.Effect<RefreshContext | null, RepositoryError>;
    readonly pruneExpiredSessions: (input: {
      readonly expiredBefore: number;
      readonly limit: number;
    }) => Effect.Effect<number, RepositoryError>;
    readonly rotateSession: (input: {
      readonly currentId: SessionIdType;
      readonly replacement: NewSession;
      readonly now: number;
    }) => Effect.Effect<boolean, RepositoryError>;
    readonly revokeFamily: (familyId: string, now: number) => Effect.Effect<void, RepositoryError>;
  }
>()("@store/auth-worker/AuthRepository") {
  static readonly layer = Layer.effect(
    AuthRepository,
    Effect.gen(function* () {
      const database = yield* AuthD1;
      const crypto = yield* AuthCrypto;
      return AuthRepository.of(makeAuthRepository(database, crypto));
    }),
  );
}

const repositoryError = (operation: string, cause: unknown) =>
  new RepositoryError({ operation, message: storageFailureMessage(cause), cause });

const at = (milliseconds: number) => new Date(milliseconds);

const millis = (value: Date | null) => (value === null ? null : value.getTime());

interface ReturnedId {
  readonly id: string;
}

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
  role: organizationMembership.role,
};

const invitationColumns = {
  id: organizationInvitation.id,
  organizationId: organizationInvitation.organizationId,
  organizationName: organization.name,
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

interface SessionColumns {
  readonly id: string;
  readonly familyId: string;
  readonly userId: string;
  readonly activeOrganizationId: string;
  readonly refreshTokenHash: string;
  readonly clientKind: string;
  readonly deviceName: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBySessionId: string | null;
}

const asSession = (row: SessionColumns, operation: string) =>
  decode(
    SessionRecord,
    operation,
  )({
    id: row.id,
    familyId: row.familyId,
    userId: row.userId,
    activeOrganizationId: row.activeOrganizationId,
    refreshTokenHash: row.refreshTokenHash,
    clientKind: row.clientKind,
    deviceName: row.deviceName,
    expiresAt: row.expiresAt.getTime(),
    revokedAt: millis(row.revokedAt),
    replacedBySessionId: row.replacedBySessionId,
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

const makeAuthRepository = (
  database: AuthDrizzle,
  crypto: AuthCrypto["Service"],
): AuthRepository["Service"] => {
  const fail = (operation: string) =>
    Effect.mapError((cause: unknown) => repositoryError(operation, cause));

  const newId = crypto.randomId.pipe(fail("newId"));

  const atomicBatch = (operation: string, queries: ReadonlyArray<CompilableQuery>) =>
    runD1Batch<ReturnedId>(database, queries).pipe(fail(operation));

  const returningMatchedOne = (rows: ReadonlyArray<ReturnedId> | undefined) =>
    (rows?.length ?? 0) === 1;

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

  const anotherOwnerExists = (organizationId: OrganizationIdType, userId: UserIdType) =>
    exists(
      database
        .select({ id: organizationMembership.id })
        .from(organizationMembership)
        .where(
          and(
            eq(organizationMembership.organizationId, organizationId),
            eq(organizationMembership.role, "owner"),
            ne(organizationMembership.userId, userId),
          ),
        ),
    );

  const leavesAnOwner = (organizationId: OrganizationIdType, userId: UserIdType) =>
    or(ne(organizationMembership.role, "owner"), anotherOwnerExists(organizationId, userId));

  const newAccount = Effect.fnUntraced(function* (input: {
    readonly email: EmailAddressType;
    readonly name: string;
    readonly image: string | null;
    readonly passwordHash: PasswordHashType | null;
    readonly verifiedAt: number | null;
  }) {
    const userId = UserId.make(yield* newId);
    const name = input.name.trim();
    const store = { id: OrganizationId.make(yield* newId), name: `${name || "My"}'s Store` };
    const membershipId = yield* newId;
    return {
      record: UserRecord.make({
        id: userId,
        email: input.email,
        name,
        image: input.image,
        passwordHash: input.passwordHash,
        emailVerified: input.verifiedAt !== null,
      }),
      inserts: [
        database.insert(user).values({
          id: userId,
          email: input.email,
          name,
          image: input.image,
          passwordHash: input.passwordHash,
          emailVerifiedAt: input.verifiedAt === null ? null : at(input.verifiedAt),
        }),
        database.insert(organization).values({ id: store.id, name: store.name }),
        database
          .insert(organizationMembership)
          .values({ id: membershipId, organizationId: store.id, userId, role: "owner" }),
      ],
    };
  });

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
      const account = yield* newAccount({
        email: input.email,
        name: input.name,
        image: null,
        passwordHash: input.passwordHash,
        verifiedAt: null,
      });
      yield* atomicBatch("createPasswordUser", account.inserts);
      return account.record;
    }),
    replacePasswordHash: Effect.fn("AuthRepository.replacePasswordHash")(function* (input) {
      yield* database
        .update(user)
        .set({ passwordHash: input.next })
        .where(and(eq(user.id, input.userId), eq(user.passwordHash, input.previous)))
        .pipe(fail("replacePasswordHash"));
    }),
    createGoogleUser: Effect.fn("AuthRepository.createGoogleUser")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const account = yield* newAccount({
        email: input.email,
        name: input.name,
        image: input.image,
        passwordHash: null,
        verifiedAt: now,
      });
      yield* atomicBatch("createGoogleUser", [
        ...account.inserts,
        database.insert(oauthAccount).values({
          id: yield* newId,
          userId: account.record.id,
          provider: "google",
          providerAccountId: input.providerAccountId,
        }),
      ]);
      return account.record;
    }),
    attachGoogleAccount: Effect.fn("AuthRepository.attachGoogleAccount")(function* (input) {
      const linked = yield* database
        .insert(oauthAccount)
        .values({
          id: yield* newId,
          userId: input.userId,
          provider: "google",
          providerAccountId: input.providerAccountId,
        })
        .onConflictDoNothing({
          target: [oauthAccount.provider, oauthAccount.providerAccountId],
        })
        .returning({ id: oauthAccount.id })
        .pipe(fail("attachGoogleAccount"));
      return returningMatchedOne(linked);
    }),
    claimUnverifiedPasswordUser: Effect.fn("AuthRepository.claimUnverifiedPasswordUser")(
      function* (input) {
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
        const results = yield* atomicBatch("claimUnverifiedPasswordUser", [
          database
            .insert(oauthAccount)
            .values({
              id: yield* newId,
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
        return returningMatchedOne(results[1]);
      },
    ),
    membershipForUser: Effect.fn("AuthRepository.membershipForUser")(function* (userId) {
      const [row] = yield* database
        .select(membershipColumns)
        .from(organizationMembership)
        .innerJoin(organization, eq(organization.id, organizationMembership.organizationId))
        .where(eq(organizationMembership.userId, userId))
        .orderBy(desc(organizationMembership.createdAt))
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
        .set({ name: input.name })
        .where(eq(organization.id, input.organizationId))
        .returning({ id: organization.id, name: organization.name })
        .pipe(
          Effect.map((rows) => rows[0]),
          fail("updateOrganization"),
        );
      if (!updated) return null;
      return yield* decode(
        MembershipRecord,
        "updateOrganization.decode",
      )({
        organizationId: updated.id,
        organizationName: updated.name,
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
    changeMemberRole: Effect.fn("AuthRepository.changeMemberRole")(function* (input) {
      const changed = yield* database
        .update(organizationMembership)
        .set({ role: input.role })
        .where(
          and(
            eq(organizationMembership.organizationId, input.organizationId),
            eq(organizationMembership.userId, input.userId),
            ne(organizationMembership.role, input.role),
            leavesAnOwner(input.organizationId, input.userId),
          ),
        )
        .returning({ id: organizationMembership.id })
        .pipe(fail("changeMemberRole"));
      return returningMatchedOne(changed);
    }),
    removeMember: Effect.fn("AuthRepository.removeMember")(function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const results = yield* atomicBatch("removeMember", [
        database
          .delete(organizationMembership)
          .where(
            and(
              eq(organizationMembership.organizationId, input.organizationId),
              eq(organizationMembership.userId, input.userId),
              leavesAnOwner(input.organizationId, input.userId),
            ),
          )
          .returning({ id: organizationMembership.id }),
        database
          .update(session)
          .set({ revokedAt: at(now) })
          .where(
            and(
              eq(session.userId, input.userId),
              eq(session.activeOrganizationId, input.organizationId),
              isNull(session.revokedAt),
              not(
                exists(
                  database
                    .select({ id: organizationMembership.id })
                    .from(organizationMembership)
                    .where(
                      and(
                        eq(organizationMembership.organizationId, input.organizationId),
                        eq(organizationMembership.userId, input.userId),
                      ),
                    ),
                ),
              ),
            ),
          ),
      ]);
      return returningMatchedOne(results[0]);
    }),
    createInvitation: Effect.fn("AuthRepository.createInvitation")(function* (input) {
      const invitationId = InvitationId.make(yield* newId);
      yield* atomicBatch("createInvitation", [
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
      return returningMatchedOne(revoked);
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
      const pendingInvitation = and(
        eq(organizationInvitation.id, input.invitation.id),
        stillPending(input.now),
      );
      const membershipId = yield* newId;
      const results = yield* atomicBatch("acceptInvitation", [
        database
          .insert(organizationMembership)
          .select((query) =>
            query
              .select({
                id: bound(organizationMembership.id, membershipId),
                organizationId: organizationInvitation.organizationId,
                userId: bound(organizationMembership.userId, input.userId),
                role: organizationInvitation.role,
                createdAt: bound(organizationMembership.createdAt, at(input.now)),
              })
              .from(organizationInvitation)
              .where(pendingInvitation),
          )
          .onConflictDoNothing({
            target: [organizationMembership.organizationId, organizationMembership.userId],
          }),
        database
          .update(organizationInvitation)
          .set({ acceptedAt: at(input.now) })
          .where(pendingInvitation)
          .returning({ id: organizationInvitation.id }),
        database
          .update(session)
          .set({ activeOrganizationId: input.invitation.organizationId })
          .where(
            and(
              eq(session.id, input.sessionId),
              eq(session.userId, input.userId),
              isNull(session.revokedAt),
              exists(
                database
                  .select({ id: organizationInvitation.id })
                  .from(organizationInvitation)
                  .where(
                    and(
                      eq(organizationInvitation.id, input.invitation.id),
                      eq(organizationInvitation.acceptedAt, at(input.now)),
                    ),
                  ),
              ),
            ),
          ),
      ]);
      return returningMatchedOne(results[1]);
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
      return yield* asSession(row, "findSession.decode");
    }),
    findRefreshContext: Effect.fn("AuthRepository.findRefreshContext")(function* (sessionId) {
      const [row] = yield* database
        .select({
          ...sessionColumns,
          userEmail: user.email,
          userName: user.name,
          userImage: user.image,
          userPasswordHash: user.passwordHash,
          userEmailVerifiedAt: user.emailVerifiedAt,
          userFound: sql<string | null>`${user.id}`.as("refresh_user_id"),
          membershipOrganizationId: organizationMembership.organizationId,
          membershipRole: organizationMembership.role,
          organizationName: sql<string | null>`${organization.name}`.as(
            "refresh_organization_name",
          ),
        })
        .from(session)
        .leftJoin(user, eq(user.id, session.userId))
        .leftJoin(
          organizationMembership,
          and(
            eq(organizationMembership.userId, session.userId),
            eq(organizationMembership.organizationId, session.activeOrganizationId),
          ),
        )
        .leftJoin(organization, eq(organization.id, organizationMembership.organizationId))
        .where(eq(session.id, sessionId))
        .pipe(fail("findRefreshContext"));
      if (!row) return null;
      const current = yield* asSession(row, "findRefreshContext.session");
      const owner = yield* asUser(
        row.userFound === null || row.userEmail === null || row.userName === null
          ? undefined
          : {
              id: row.userFound,
              email: row.userEmail,
              name: row.userName,
              image: row.userImage,
              passwordHash: row.userPasswordHash,
              emailVerifiedAt: row.userEmailVerifiedAt,
            },
        "findRefreshContext.user",
      );
      const activeMembership =
        row.membershipOrganizationId === null ||
        row.membershipRole === null ||
        row.organizationName === null
          ? null
          : yield* decode(
              MembershipRecord,
              "findRefreshContext.membership",
            )({
              organizationId: row.membershipOrganizationId,
              organizationName: row.organizationName,
              role: row.membershipRole,
            });
      return { session: current, user: owner, activeMembership } satisfies RefreshContext;
    }),
    pruneExpiredSessions: Effect.fn("AuthRepository.pruneExpiredSessions")(function* (input) {
      const pruned = yield* database
        .delete(session)
        .where(
          inArray(
            session.id,
            database
              .select({ id: session.id })
              .from(session)
              .where(lte(session.expiresAt, at(input.expiredBefore)))
              .limit(input.limit),
          ),
        )
        .returning({ id: session.id })
        .pipe(fail("pruneExpiredSessions"));
      return pruned.length;
    }),
    rotateSession: Effect.fn("AuthRepository.rotateSession")(function* (input) {
      const successor = sessionValues(input.replacement);
      const results = yield* atomicBatch("rotateSession", [
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
        database.insert(session).select((query) =>
          query
            .select({
              id: bound(session.id, successor.id),
              familyId: bound(session.familyId, successor.familyId),
              userId: bound(session.userId, successor.userId),
              activeOrganizationId: bound(
                session.activeOrganizationId,
                successor.activeOrganizationId,
              ),
              refreshTokenHash: bound(session.refreshTokenHash, successor.refreshTokenHash),
              clientKind: bound(session.clientKind, successor.clientKind),
              deviceName: bound(session.deviceName, successor.deviceName),
              expiresAt: bound(session.expiresAt, successor.expiresAt),
            })
            .from(session)
            .where(
              and(eq(session.id, input.currentId), eq(session.replacedBySessionId, successor.id)),
            ),
        ),
      ]);
      return returningMatchedOne(results[0]);
    }),
    revokeFamily: Effect.fn("AuthRepository.revokeFamily")(function* (familyId, now) {
      yield* database
        .update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.familyId, familyId), isNull(session.revokedAt)))
        .pipe(fail("revokeFamily"));
    }),
  };
};
