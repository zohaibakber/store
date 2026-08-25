import {
  AccessClaims,
  AccessToken,
  AccessTokenService,
  AuthorizationCode,
  EmailAddress,
  EmailProvider,
  InvitationId,
  JwtError,
  OrganizationId,
  OrganizationMember,
  OtpChallengeId,
  PasswordHash,
  PasswordHasher,
  SessionId,
  UserId,
  type IssueAccessTokenInput,
  type OrganizationRole,
  type SendInvitationInput,
} from "@store/auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { EphemeralStore } from "../src/ephemeral";
import { GoogleOAuth, GoogleOAuthError, type GoogleProfile } from "../src/google";
import { nextRateLimit, type RateLimitWindow } from "../src/rate-limit";
import {
  AuthRepository,
  type AuthRepositoryApi,
  type InvitationRecord,
  type MembershipRecord,
  type SessionRecord,
  type UserRecord,
} from "../src/repository";
import { AuthService, authServiceLayer } from "../src/service";

const textEncoder = new TextEncoder();

export const refreshTokenHash = async (secret: string) => {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`refresh-pepper:${secret}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

export interface Store {
  readonly users: Array<UserRecord>;
  readonly organizations: Array<{ id: OrganizationId; name: string; slug: string | null }>;
  readonly memberships: Array<{
    organizationId: OrganizationId;
    userId: UserId;
    role: OrganizationRole;
    createdAt: number;
  }>;
  readonly invitations: Array<{ record: InvitationRecord; tokenHash: string }>;
  readonly sessions: Array<SessionRecord>;
  readonly googleIdentities: Array<{ providerAccountId: string; userId: UserId }>;
  readonly sentInvitations: Array<SendInvitationInput>;
  readonly rateLimits: Map<string, RateLimitWindow>;
}

export const emptyStore = (): Store => ({
  users: [],
  organizations: [],
  memberships: [],
  invitations: [],
  sessions: [],
  googleIdentities: [],
  sentInvitations: [],
  rateLimits: new Map(),
});

export const PASSWORD_HASH = PasswordHash.make("pbkdf2-sha256$100000$c2FsdA$aGFzaA");

export const seedUser = (
  store: Store,
  input: {
    readonly id: string;
    readonly email: string;
    readonly name?: string;
    readonly password?: boolean;
    readonly emailVerified?: boolean;
  },
) => {
  const user: UserRecord = {
    id: UserId.make(input.id),
    email: EmailAddress.make(input.email),
    name: input.name ?? input.email,
    image: null,
    passwordHash: input.password === false ? null : PASSWORD_HASH,
    emailVerified: input.emailVerified ?? false,
  };
  store.users.push(user);
  return user;
};

export const seedOrganization = (
  store: Store,
  input: {
    readonly id: string;
    readonly name: string;
    readonly slug?: string;
    readonly members: ReadonlyArray<{ readonly userId: UserId; readonly role: OrganizationRole }>;
  },
) => {
  const id = OrganizationId.make(input.id);
  store.organizations.push({ id, name: input.name, slug: input.slug ?? null });
  input.members.forEach((member, index) => {
    store.memberships.push({
      organizationId: id,
      userId: member.userId,
      role: member.role,
      createdAt: index,
    });
  });
  return id;
};

export const seedSession = (
  store: Store,
  input: {
    readonly id: string;
    readonly userId: UserId;
    readonly organizationId: OrganizationId;
    readonly refreshTokenHash?: string;
  },
) => {
  const session: SessionRecord = {
    id: SessionId.make(input.id),
    familyId: `family-${input.id}`,
    userId: input.userId,
    activeOrganizationId: input.organizationId,
    refreshTokenHash: input.refreshTokenHash ?? "unset",
    clientKind: "Native",
    deviceName: "Test device",
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    replacedBySessionId: null,
  };
  store.sessions.push(session);
  return session;
};

const membershipOf = (store: Store, userId: UserId, organizationId: OrganizationId) => {
  const membership = store.memberships.find(
    (entry) => entry.userId === userId && entry.organizationId === organizationId,
  );
  if (!membership) return null;
  const organization = store.organizations.find((entry) => entry.id === organizationId);
  return {
    organizationId,
    organizationName: organization?.name ?? "Unknown",
    organizationSlug: organization?.slug ?? null,
    role: membership.role,
  } satisfies MembershipRecord;
};

const pending = (invitation: InvitationRecord, now: number) =>
  invitation.acceptedAt === null && invitation.revokedAt === null && invitation.expiresAt > now;

export const fakeRepository = (store: Store): AuthRepositoryApi => ({
  findUserByEmail: (email) =>
    Effect.succeed(store.users.find((user) => user.email === email) ?? null),
  findUserById: (userId) => Effect.succeed(store.users.find((user) => user.id === userId) ?? null),
  findUserByGoogleId: (providerAccountId) =>
    Effect.sync(() => {
      const identity = store.googleIdentities.find(
        (entry) => entry.providerAccountId === providerAccountId,
      );
      if (!identity) return null;
      return store.users.find((user) => user.id === identity.userId) ?? null;
    }),
  createPasswordUser: (input) =>
    Effect.sync(() => {
      const user = seedUser(store, {
        id: `user-${store.users.length + 1}`,
        email: input.email,
        name: input.name,
      });
      seedOrganization(store, {
        id: `organization-${store.organizations.length + 1}`,
        name: `${input.name}'s Store`,
        members: [{ userId: user.id, role: "owner" }],
      });
      return user;
    }),
  createGoogleUser: (input) =>
    Effect.sync(() => {
      const user = seedUser(store, {
        id: `user-${store.users.length + 1}`,
        email: input.email,
        name: input.name,
        password: false,
        emailVerified: true,
      });
      seedOrganization(store, {
        id: `organization-${store.organizations.length + 1}`,
        name: `${input.name}'s Store`,
        members: [{ userId: user.id, role: "owner" }],
      });
      store.googleIdentities.push({
        providerAccountId: input.providerAccountId,
        userId: user.id,
      });
      return user;
    }),
  attachGoogleAccount: (input) =>
    Effect.sync(() => {
      const taken = store.googleIdentities.some(
        (entry) => entry.providerAccountId === input.providerAccountId,
      );
      if (taken) return false;
      store.googleIdentities.push(input);
      return true;
    }),
  claimUnverifiedPasswordUser: (input) =>
    Effect.sync(() => {
      const taken = store.googleIdentities.some(
        (entry) => entry.providerAccountId === input.providerAccountId,
      );
      if (taken) return false;
      const index = store.users.findIndex((user) => user.id === input.userId);
      const user = store.users[index];
      if (!user || user.passwordHash === null || user.emailVerified) return false;
      store.users[index] = {
        ...user,
        passwordHash: null,
        emailVerified: true,
        image: user.image ?? input.image,
      };
      store.googleIdentities.push({
        providerAccountId: input.providerAccountId,
        userId: input.userId,
      });
      for (const [sessionIndex, session] of store.sessions.entries()) {
        if (session.userId === input.userId && session.revokedAt === null) {
          store.sessions[sessionIndex] = { ...session, revokedAt: input.now };
        }
      }
      return true;
    }),
  membershipForUser: (userId) =>
    Effect.suspend(() => {
      const membership = store.memberships
        .filter((entry) => entry.userId === userId)
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      const resolved = membership ? membershipOf(store, userId, membership.organizationId) : null;
      return resolved ? Effect.succeed(resolved) : Effect.die(`${userId} has no membership`);
    }),
  membershipInOrganization: (input) =>
    Effect.sync(() => membershipOf(store, input.userId, input.organizationId)),
  updateOrganization: (input) =>
    Effect.sync(() => {
      const index = store.organizations.findIndex((entry) => entry.id === input.organizationId);
      const organization = store.organizations[index];
      if (!organization) return null;
      const taken = store.organizations.some(
        (entry) => entry.id !== organization.id && input.slug !== null && entry.slug === input.slug,
      );
      if (taken) return null;
      store.organizations[index] = { ...organization, name: input.name, slug: input.slug };
      return {
        organizationId: organization.id,
        organizationName: input.name,
        organizationSlug: input.slug,
        role: input.role,
      } satisfies MembershipRecord;
    }),
  listMembers: (organizationId) =>
    Effect.sync(() =>
      store.memberships
        .filter((entry) => entry.organizationId === organizationId)
        .flatMap((entry) => {
          const user = store.users.find((candidate) => candidate.id === entry.userId);
          if (!user) return [];
          return [
            OrganizationMember.make({
              userId: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
              role: entry.role,
              joinedAt: entry.createdAt,
            }),
          ];
        }),
    ),
  countRole: (input) =>
    Effect.sync(
      () =>
        store.memberships.filter(
          (entry) => entry.organizationId === input.organizationId && entry.role === input.role,
        ).length,
    ),
  changeMemberRole: (input) =>
    Effect.sync(() => {
      const index = store.memberships.findIndex(
        (entry) => entry.organizationId === input.organizationId && entry.userId === input.userId,
      );
      const membership = store.memberships[index];
      if (!membership || membership.role === input.role) return false;
      store.memberships[index] = { ...membership, role: input.role };
      return true;
    }),
  removeMember: (input) =>
    Effect.sync(() => {
      const index = store.memberships.findIndex(
        (entry) => entry.organizationId === input.organizationId && entry.userId === input.userId,
      );
      if (index === -1) return false;
      store.memberships.splice(index, 1);
      for (const [sessionIndex, session] of store.sessions.entries()) {
        if (
          session.userId === input.userId &&
          session.activeOrganizationId === input.organizationId &&
          session.revokedAt === null
        ) {
          store.sessions[sessionIndex] = { ...session, revokedAt: Date.now() };
        }
      }
      return true;
    }),
  createInvitation: (input) =>
    Effect.sync(() => {
      for (const [index, entry] of store.invitations.entries()) {
        if (
          entry.record.organizationId === input.organizationId &&
          entry.record.email === input.email &&
          pending(entry.record, input.now)
        ) {
          store.invitations[index] = {
            ...entry,
            record: { ...entry.record, revokedAt: input.now },
          };
        }
      }
      const organization = store.organizations.find((entry) => entry.id === input.organizationId);
      const record: InvitationRecord = {
        id: InvitationId.make(`invitation-${store.invitations.length + 1}`),
        organizationId: input.organizationId,
        organizationName: organization?.name ?? "Unknown",
        organizationSlug: organization?.slug ?? null,
        email: input.email,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        revokedAt: null,
        createdAt: input.now,
      };
      store.invitations.push({ record, tokenHash: input.tokenHash });
      return record;
    }),
  revokeInvitation: (input) =>
    Effect.sync(() => {
      const index = store.invitations.findIndex(
        (entry) =>
          entry.record.id === input.invitationId &&
          entry.record.organizationId === input.organizationId &&
          entry.record.acceptedAt === null &&
          entry.record.revokedAt === null,
      );
      const entry = store.invitations[index];
      if (!entry) return false;
      store.invitations[index] = { ...entry, record: { ...entry.record, revokedAt: input.now } };
      return true;
    }),
  findInvitationByTokenHash: (tokenHash) =>
    Effect.sync(
      () => store.invitations.find((entry) => entry.tokenHash === tokenHash)?.record ?? null,
    ),
  pendingInvitationsForOrganization: (input) =>
    Effect.sync(() =>
      store.invitations
        .filter(
          (entry) =>
            entry.record.organizationId === input.organizationId &&
            pending(entry.record, input.now),
        )
        .map((entry) => entry.record),
    ),
  acceptInvitation: (input) =>
    Effect.sync(() => {
      const index = store.invitations.findIndex((entry) => entry.record.id === input.invitation.id);
      const entry = store.invitations[index];
      if (!entry || !pending(entry.record, input.now)) return false;
      store.invitations[index] = { ...entry, record: { ...entry.record, acceptedAt: input.now } };
      const already = store.memberships.some(
        (membership) =>
          membership.organizationId === input.invitation.organizationId &&
          membership.userId === input.userId,
      );
      if (!already) {
        store.memberships.push({
          organizationId: input.invitation.organizationId,
          userId: input.userId,
          role: input.invitation.role,
          createdAt: input.now,
        });
      }
      return true;
    }),
  createSession: (input) =>
    Effect.sync(() => {
      store.sessions.push({
        id: input.id,
        familyId: input.familyId,
        userId: input.userId,
        activeOrganizationId: input.activeOrganizationId,
        refreshTokenHash: input.refreshTokenHash,
        clientKind: input.client._tag,
        deviceName: input.client._tag === "Native" ? input.client.deviceName : null,
        expiresAt: input.expiresAt,
        revokedAt: null,
        replacedBySessionId: null,
      });
    }),
  findSession: (sessionId) =>
    Effect.sync(() => store.sessions.find((session) => session.id === sessionId) ?? null),
  moveSession: (input) =>
    Effect.sync(() => {
      const index = store.sessions.findIndex((session) => session.id === input.sessionId);
      const session = store.sessions[index];
      if (!session || session.revokedAt !== null) return;
      store.sessions[index] = { ...session, activeOrganizationId: input.organizationId };
    }),
  rotateSession: (input) =>
    Effect.sync(() => {
      const index = store.sessions.findIndex((session) => session.id === input.currentId);
      const current = store.sessions[index];
      if (!current || current.revokedAt !== null || current.expiresAt <= input.now) return false;
      store.sessions[index] = {
        ...current,
        revokedAt: input.now,
        replacedBySessionId: input.replacement.id,
      };
      store.sessions.push({
        id: input.replacement.id,
        familyId: input.replacement.familyId,
        userId: input.replacement.userId,
        activeOrganizationId: input.replacement.activeOrganizationId,
        refreshTokenHash: input.replacement.refreshTokenHash,
        clientKind: input.replacement.client._tag,
        deviceName:
          input.replacement.client._tag === "Native" ? input.replacement.client.deviceName : null,
        expiresAt: input.replacement.expiresAt,
        revokedAt: null,
        replacedBySessionId: null,
      });
      return true;
    }),
  revokeSession: (sessionId, now) =>
    Effect.sync(() => {
      const index = store.sessions.findIndex((session) => session.id === sessionId);
      const session = store.sessions[index];
      if (session) store.sessions[index] = { ...session, revokedAt: now };
    }),
  revokeFamily: (familyId, now) =>
    Effect.sync(() => {
      for (const [index, session] of store.sessions.entries()) {
        if (session.familyId === familyId && session.revokedAt === null) {
          store.sessions[index] = { ...session, revokedAt: now };
        }
      }
    }),
  revokeUser: (userId, now) =>
    Effect.sync(() => {
      for (const [index, session] of store.sessions.entries()) {
        if (session.userId === userId && session.revokedAt === null) {
          store.sessions[index] = { ...session, revokedAt: now };
        }
      }
    }),
  allowRateLimit: (input) =>
    Effect.sync(() => {
      const next = nextRateLimit(store.rateLimits.get(input.key), input);
      if (next === null) return false;
      store.rateLimits.set(input.key, next);
      return true;
    }),
});

export const encodeClaims = (input: IssueAccessTokenInput, expiresAt: number) =>
  AccessToken.make(
    btoa(
      JSON.stringify({
        subject: input.subject,
        sessionId: input.sessionId,
        activeOrganizationId: input.activeOrganizationId,
        organizationName: input.organizationName,
        organizationSlug: input.organizationSlug,
        role: input.role,
        email: input.email,
        name: input.name,
        image: input.image,
        expiresAt,
      }),
    ),
  );

export interface Harness {
  readonly store: Store;
  readonly issued: Array<IssueAccessTokenInput>;
  readonly layer: Layer.Layer<AuthService>;
}

export const harness = (options: { readonly googleProfile?: GoogleProfile } = {}): Harness => {
  const store = emptyStore();
  const issued: Array<IssueAccessTokenInput> = [];

  const dependencies = Layer.mergeAll(
    Layer.succeed(AuthRepository, AuthRepository.of(fakeRepository(store))),
    Layer.succeed(
      EphemeralStore,
      EphemeralStore.of({
        createOtp: () => Effect.succeed(OtpChallengeId.make("challenge-1")),
        consumeOtp: () => Effect.succeed(null),
        createOAuthState: () => Effect.succeed("oauth-state"),
        consumeOAuthState: () => Effect.succeed(null),
        createAuthorizationGrant: () =>
          Effect.succeed(AuthorizationCode.make("authorization-code")),
        consumeAuthorizationGrant: () => Effect.succeed(null),
      }),
    ),
    Layer.succeed(
      PasswordHasher,
      PasswordHasher.of({
        hash: () => Effect.succeed(PASSWORD_HASH),
        verify: () => Effect.succeed(true),
      }),
    ),
    Layer.succeed(
      AccessTokenService,
      AccessTokenService.of({
        issue: (input) =>
          Effect.sync(() => {
            issued.push(input);
            const expiresAt = Date.now() + 300_000;
            return { token: encodeClaims(input, expiresAt), expiresAt };
          }),
        verify: (token) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(AccessClaims)(JSON.parse(atob(token))),
            catch: () =>
              new JwtError({ reason: "Malformed", message: "The access token is malformed." }),
          }),
      }),
    ),
    Layer.succeed(
      EmailProvider,
      EmailProvider.of({
        sendOtp: () => Effect.void,
        sendInvitation: (input) =>
          Effect.sync(() => {
            store.sentInvitations.push(input);
          }),
      }),
    ),
    Layer.succeed(
      GoogleOAuth,
      GoogleOAuth.of({
        authorizationUrl: (state) => new URL(`https://accounts.example/authorize?state=${state}`),
        exchangeCode: () => Effect.die("not used"),
        verifyIdToken: (idToken) =>
          idToken === "valid-id-token" && options.googleProfile
            ? Effect.succeed(options.googleProfile)
            : Effect.fail(
                new GoogleOAuthError({
                  operation: "verifyIdToken.audience",
                  message: "The identity token was issued for another application.",
                }),
              ),
      }),
    ),
  );

  return {
    store,
    issued,
    layer: authServiceLayer({
      developmentOtp: true,
      trustedRedirects: ["https://app.example.com", "com.tabaaq.desktop://"],
      refreshTokenPepper: "refresh-pepper",
    }).pipe(Layer.provide(dependencies)),
  };
};
