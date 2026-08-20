import {
  AccessTokenService,
  AuthOrganizationMembership,
  AuthorizationCode,
  EmailAddress,
  EmailProvider,
  InvitationToken,
  LoginRoute,
  OrganizationDirectory,
  OrganizationInvitation,
  OrganizationRoster,
  OtpCode,
  PasswordHasher,
  RefreshToken,
  SessionId,
  TokenSet,
  isTrustedRedirect,
  normalizeEmail,
  type AccessClaims,
  type AuthClientKind,
  type BeginGoogleInput,
  type ExchangeGoogleIdTokenInput,
  type ExchangeGoogleInput,
  type IdentifyInput,
  type LoginCommand,
  type LoginRoute as LoginRouteType,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationDirectory as OrganizationDirectoryType,
  type OrganizationId,
  type OrganizationRole,
  type OrganizationRoster as OrganizationRosterType,
  type RefreshInput,
  type SignOutInput,
  type SwitchOrganizationInput,
  type TokenSet as TokenSetType,
  type UserId,
} from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { EphemeralStore } from "./ephemeral";
import { GoogleOAuth, type GoogleProfile } from "./google";
import {
  AuthRepository,
  type InvitationRecord,
  type MembershipRecord,
  type SessionRecord,
  type UserRecord,
} from "./repository";

const textEncoder = new TextEncoder();
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const OTP_TTL_MS = 10 * 60 * 1_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
/** Long enough to reach someone who reads mail once a week. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class AuthError extends Schema.TaggedError<AuthError>()("Auth.AuthError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {}

export interface GoogleCallback {
  readonly redirectUri: string;
  readonly code: typeof AuthorizationCode.Type;
}

export interface AuthServiceApi {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRouteType, AuthError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSetType, AuthError>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<URL, AuthError>;
  readonly completeGoogle: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<GoogleCallback, AuthError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSetType, AuthError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError>;
  /** Everything the signed-in user could switch to or accept. */
  readonly directory: (accessToken: string) => Effect.Effect<OrganizationDirectoryType, AuthError>;
  readonly roster: (input: {
    readonly accessToken: string;
    readonly organizationId: OrganizationId;
  }) => Effect.Effect<OrganizationRosterType, AuthError>;
  readonly organize: (input: {
    readonly accessToken: string;
    readonly command: OrganizationCommand;
  }) => Effect.Effect<OrganizationCommandResult, AuthError>;
  /**
   * Rotates the session onto another organization. The refresh credential is
   * the authority, because the access token naming the old organization is
   * what this call replaces.
   */
  readonly switchOrganization: (
    input: SwitchOrganizationInput,
  ) => Effect.Effect<TokenSetType, AuthError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@store/auth-worker/AuthService",
) {}

export interface AuthServiceConfiguration {
  readonly developmentOtp: boolean;
  readonly trustedRedirects: ReadonlyArray<string>;
  readonly refreshTokenPepper: string;
}

const authError = (status: number, code: string, message: string) =>
  new AuthError({ status, code, message });

const infrastructureError = (cause: unknown) =>
  cause instanceof AuthError
    ? cause
    : authError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");

const randomSecret = (bytes: number) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", textEncoder.encode(value)).then((buffer) => {
      let binary = "";
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
    }),
  );

const safeEqual = (left: string, right: string) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const generateOtp = () => {
  const maximum = 4_294_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while ((values[0] ?? 0) >= maximum);
  return OtpCode.make(String((values[0] ?? 0) % 1_000_000).padStart(6, "0"));
};

const parseRefreshToken = (token: string) =>
  Effect.gen(function* () {
    const separator = token.indexOf(".");
    if (separator <= 0 || separator === token.length - 1) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(token.slice(0, separator)).pipe(
      Effect.mapError(() => authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.")),
    );
    return { sessionId, secret: token.slice(separator + 1) };
  });

export const authServiceLayer = (configuration: AuthServiceConfiguration) =>
  Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const ephemeral = yield* EphemeralStore;
      const passwords = yield* PasswordHasher;
      const accessTokens = yield* AccessTokenService;
      const email = yield* EmailProvider;
      const google = yield* GoogleOAuth;

      /**
       * The organization the caller asked for, when they still belong to it,
       * and otherwise their first one. A session that names an organization
       * the user has left must not keep refreshing into it.
       */
      const resolveMembership = Effect.fn("AuthService.resolveMembership")(function* (
        userId: UserId,
        preferred?: OrganizationId,
      ) {
        if (preferred) {
          const membership = yield* repository.membershipInOrganization({
            userId,
            organizationId: preferred,
          });
          if (membership) return membership;
        }
        return yield* repository.membershipForUser(userId);
      });

      const issueAccess = (user: UserRecord, sessionId: SessionId, membership: MembershipRecord) =>
        accessTokens.issue({
          subject: user.id,
          sessionId,
          activeOrganizationId: membership.organizationId,
          organizationName: membership.organizationName,
          organizationSlug: membership.organizationSlug,
          role: membership.role,
          email: user.email,
          name: user.name,
          image: user.image,
        });

      const issueSession = Effect.fn("AuthService.issueSession")(function* (
        user: UserRecord,
        client: AuthClientKind,
        replayKey?: string,
      ) {
        const membership = yield* resolveMembership(user.id);
        const sessionId = SessionId.make(replayKey ?? crypto.randomUUID());
        const familyId = crypto.randomUUID();
        const refreshSecret = randomSecret(32);
        const refreshTokenHash = yield* sha256(
          `${configuration.refreshTokenPepper}:${refreshSecret}`,
        );
        const refreshExpiresAt = Date.now() + REFRESH_TTL_MS;
        yield* repository.createSession({
          id: sessionId,
          familyId,
          userId: user.id,
          activeOrganizationId: membership.organizationId,
          refreshTokenHash,
          client,
          expiresAt: refreshExpiresAt,
        });
        const access = yield* issueAccess(user, sessionId, membership);
        return TokenSet.make({
          accessToken: access.token,
          accessExpiresAt: access.expiresAt,
          refreshToken: RefreshToken.make(`${sessionId}.${refreshSecret}`),
          refreshExpiresAt,
        });
      });

      const identify = Effect.fn("AuthService.identify")(function* (input: IdentifyInput) {
        const normalized = yield* Schema.decodeUnknownEffect(EmailAddress)(
          normalizeEmail(input.email),
        ).pipe(Effect.mapError(() => authError(400, "INVALID_EMAIL", "Enter a valid email.")));
        const allowed = yield* ephemeral.allow({
          key: `identify:${normalized}`,
          limit: 10,
          windowSeconds: 60,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
        }
        const user = yield* repository.findUserByEmail(normalized);
        if (!user) return LoginRoute.make({ _tag: "Registration", email: normalized });
        if (user.passwordHash) return LoginRoute.make({ _tag: "Password", email: normalized });
        const code = generateOtp();
        const expiresAt = Date.now() + OTP_TTL_MS;
        const challengeId = yield* ephemeral.createOtp({
          email: normalized,
          code,
          expiresAt,
        });
        yield* email.sendOtp({ email: normalized, code, expiresAt });
        if (configuration.developmentOtp) {
          return LoginRoute.make({
            _tag: "Otp",
            email: normalized,
            challengeId,
            developmentCode: code,
          });
        }
        return LoginRoute.make({ _tag: "Otp", email: normalized, challengeId });
      });

      const authenticate = Effect.fn("AuthService.authenticate")(function* (command: LoginCommand) {
        switch (command._tag) {
          case "Password": {
            const emailAddress = EmailAddress.make(normalizeEmail(command.email));
            const allowed = yield* ephemeral.allow({
              key: `password:${emailAddress}`,
              limit: 5,
              windowSeconds: 300,
              now: Date.now(),
            });
            if (!allowed) {
              return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
            }
            const user = yield* repository.findUserByEmail(emailAddress);
            if (!user?.passwordHash) {
              return yield* authError(
                401,
                "INVALID_CREDENTIALS",
                "The email or password is incorrect.",
              );
            }
            const verified = yield* passwords.verify(command.password, user.passwordHash);
            if (!verified) {
              return yield* authError(
                401,
                "INVALID_CREDENTIALS",
                "The email or password is incorrect.",
              );
            }
            return yield* issueSession(user, command.client);
          }
          case "Otp": {
            const allowed = yield* ephemeral.allow({
              key: `otp-attempt:${command.challengeId}`,
              limit: 5,
              windowSeconds: OTP_TTL_MS / 1_000,
              now: Date.now(),
            });
            if (!allowed) {
              return yield* authError(429, "RATE_LIMITED", "Wait before trying another code.");
            }
            const emailAddress = yield* ephemeral.consumeOtp({
              challengeId: command.challengeId,
              code: command.code,
              now: Date.now(),
            });
            if (!emailAddress) {
              return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
            }
            const user = yield* repository.findUserByEmail(emailAddress);
            if (!user || user.passwordHash) {
              return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
            }
            return yield* issueSession(user, command.client, `otp-${command.challengeId}`);
          }
          case "RegisterPassword": {
            const emailAddress = EmailAddress.make(normalizeEmail(command.email));
            const allowed = yield* ephemeral.allow({
              key: `register:${emailAddress}`,
              limit: 5,
              windowSeconds: 3_600,
              now: Date.now(),
            });
            if (!allowed) {
              return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
            }
            const existing = yield* repository.findUserByEmail(emailAddress);
            if (existing) {
              return yield* authError(
                409,
                "ACCOUNT_EXISTS",
                "An account already exists for this email.",
              );
            }
            const passwordHash = yield* passwords.hash(command.password);
            const user = yield* repository.createPasswordUser({
              email: emailAddress,
              name: command.name,
              passwordHash,
            });
            return yield* issueSession(user, command.client);
          }
          default: {
            const _exhaustive: never = command;
            return _exhaustive;
          }
        }
      });

      /**
       * One Google identity, one Tabaaq user, however the identity arrived.
       *
       * The address arrives verified by Google, so it outranks a password
       * account nobody has ever verified: signing up with someone else's
       * address must not leave an attacker holding a credential on the real
       * owner's account, so the claim strips the password and revokes every
       * session opened with it. An account whose address *is* verified keeps
       * its password, and linking Google to it needs a deliberate act from
       * inside that session rather than an implicit merge here.
       */
      const linkGoogleUser = Effect.fn("AuthService.linkGoogleUser")(function* (
        profile: GoogleProfile,
      ) {
        const linked = yield* repository.findUserByGoogleId(profile.providerAccountId);
        if (linked) return linked;
        const existing = yield* repository.findUserByEmail(profile.email);
        if (!existing) return yield* repository.createGoogleUser(profile);
        if (existing.passwordHash && existing.emailVerified) {
          return yield* authError(
            409,
            "PASSWORD_ACCOUNT_EXISTS",
            "Sign in with your password, then connect Google from settings.",
          );
        }
        const claimed = existing.passwordHash
          ? yield* repository.claimUnverifiedPasswordUser({
              userId: existing.id,
              providerAccountId: profile.providerAccountId,
              image: profile.image,
              now: Date.now(),
            })
          : yield* repository.attachGoogleAccount({
              userId: existing.id,
              providerAccountId: profile.providerAccountId,
            });
        if (!claimed) {
          return yield* authError(
            409,
            "GOOGLE_ACCOUNT_LINKED",
            "This Google account is already connected to another Tabaaq account.",
          );
        }
        return { ...existing, passwordHash: null, emailVerified: true };
      });

      const beginGoogle = Effect.fn("AuthService.beginGoogle")(function* (input: BeginGoogleInput) {
        if (!isTrustedRedirect(input.redirectUri, configuration.trustedRedirects)) {
          return yield* authError(400, "INVALID_REDIRECT", "The OAuth redirect is not allowed.");
        }
        const state = yield* ephemeral.createOAuthState({
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          client: input.client,
          expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
        });
        return google.authorizationUrl(state);
      });

      const completeGoogle = Effect.fn("AuthService.completeGoogle")(function* (input: {
        readonly code: string;
        readonly state: string;
      }) {
        const state = yield* ephemeral.consumeOAuthState(input.state, Date.now());
        if (!state) {
          return yield* authError(
            400,
            "INVALID_OAUTH_STATE",
            "The Google sign-in request has expired.",
          );
        }
        const profile = yield* google.exchangeCode(input.code);
        const user = yield* linkGoogleUser(profile);
        const code = yield* ephemeral.createAuthorizationGrant({
          userId: user.id,
          codeChallenge: state.codeChallenge,
          client: state.client,
          expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
        });
        return { redirectUri: state.redirectUri, code };
      });

      const exchangeGoogle = Effect.fn("AuthService.exchangeGoogle")(function* (
        input: ExchangeGoogleInput,
      ) {
        const grant = yield* ephemeral.consumeAuthorizationGrant(input.code, Date.now());
        if (!grant) {
          return yield* authError(
            401,
            "INVALID_AUTHORIZATION_CODE",
            "The Google authorization has expired.",
          );
        }
        const challenge = yield* sha256(input.codeVerifier);
        if (!safeEqual(challenge, grant.codeChallenge)) {
          return yield* authError(
            401,
            "INVALID_CODE_VERIFIER",
            "The Google authorization could not be verified.",
          );
        }
        if (input.client._tag !== grant.client._tag) {
          return yield* authError(
            401,
            "INVALID_OAUTH_CLIENT",
            "The Google authorization client does not match.",
          );
        }
        const user = yield* repository.findUserById(grant.userId);
        if (!user) {
          return yield* authError(401, "ACCOUNT_NOT_FOUND", "The account no longer exists.");
        }
        return yield* issueSession(user, grant.client, `oauth-${input.code}`);
      });

      /**
       * Native clients present Google's own account picker, so there is no
       * redirect to protect with PKCE: the ID token itself is the proof.
       */
      const exchangeGoogleIdToken = Effect.fn("AuthService.exchangeGoogleIdToken")(function* (
        input: ExchangeGoogleIdTokenInput,
      ) {
        const profile = yield* google
          .verifyIdToken(input.idToken)
          .pipe(
            Effect.mapError(() =>
              authError(401, "INVALID_GOOGLE_IDENTITY", "Google sign-in could not be verified."),
            ),
          );
        const allowed = yield* ephemeral.allow({
          key: `google-identity:${profile.providerAccountId}`,
          limit: 10,
          windowSeconds: 60,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
        }
        const user = yield* linkGoogleUser(profile);
        return yield* issueSession(user, input.client);
      });

      /**
       * Resolves a refresh credential to the live session it names, applying
       * the reuse rule: presenting a revoked token kills the whole family,
       * because either the token or the session was stolen.
       */
      const openRefresh = Effect.fn("AuthService.openRefresh")(function* (
        refreshToken: string | undefined,
      ) {
        if (!refreshToken) {
          return yield* authError(401, "REFRESH_REQUIRED", "The session has expired.");
        }
        const parsed = yield* parseRefreshToken(refreshToken);
        const current = yield* repository.findSession(parsed.sessionId);
        if (!current) {
          return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
        }
        const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
        if (!safeEqual(actualHash, current.refreshTokenHash)) {
          return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
        }
        if (current.revokedAt !== null) {
          yield* repository.revokeFamily(current.familyId, Date.now());
          return yield* authError(
            401,
            "REFRESH_REUSE_DETECTED",
            "This session was revoked. Sign in again.",
          );
        }
        if (current.expiresAt <= Date.now()) {
          return yield* authError(401, "REFRESH_EXPIRED", "The session has expired.");
        }
        const user = yield* repository.findUserById(current.userId);
        if (!user) {
          return yield* authError(401, "ACCOUNT_NOT_FOUND", "The account no longer exists.");
        }
        return { session: current, user };
      });

      /** One refresh token becomes the next, carrying the family forward. */
      const rotateInto = Effect.fn("AuthService.rotateInto")(function* (input: {
        readonly session: SessionRecord;
        readonly user: UserRecord;
        readonly membership: MembershipRecord;
      }) {
        const nextId = SessionId.make(crypto.randomUUID());
        const nextSecret = randomSecret(32);
        const nextHash = yield* sha256(`${configuration.refreshTokenPepper}:${nextSecret}`);
        const refreshExpiresAt = Date.now() + REFRESH_TTL_MS;
        const rotated = yield* repository.rotateSession({
          currentId: input.session.id,
          now: Date.now(),
          replacement: {
            id: nextId,
            familyId: input.session.familyId,
            userId: input.session.userId,
            activeOrganizationId: input.membership.organizationId,
            refreshTokenHash: nextHash,
            client:
              input.session.clientKind === "Browser"
                ? { _tag: "Browser" }
                : { _tag: "Native", deviceName: input.session.deviceName ?? "Native client" },
            expiresAt: refreshExpiresAt,
          },
        });
        if (!rotated) {
          yield* repository.revokeFamily(input.session.familyId, Date.now());
          return yield* authError(
            401,
            "REFRESH_REUSE_DETECTED",
            "This session was revoked. Sign in again.",
          );
        }
        const access = yield* issueAccess(input.user, nextId, input.membership);
        return TokenSet.make({
          accessToken: access.token,
          accessExpiresAt: access.expiresAt,
          refreshToken: RefreshToken.make(`${nextId}.${nextSecret}`),
          refreshExpiresAt,
        });
      });

      const refresh = Effect.fn("AuthService.refresh")(function* (input: RefreshInput) {
        const open = yield* openRefresh(input.refreshToken);
        const membership = yield* resolveMembership(
          open.user.id,
          open.session.activeOrganizationId,
        );
        return yield* rotateInto({ ...open, membership });
      });

      const signOut = Effect.fn("AuthService.signOut")(function* (input: SignOutInput) {
        if (!input.refreshToken) return;
        const parsed = yield* parseRefreshToken(input.refreshToken);
        const session = yield* repository.findSession(parsed.sessionId);
        if (!session) return;
        const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
        if (!safeEqual(actualHash, session.refreshTokenHash)) return;
        if (input.everywhere) yield* repository.revokeUser(session.userId, Date.now());
        else yield* repository.revokeSession(session.id, Date.now());
      });

      /**
       * Resolves a bearer access token to its claims, and confirms the session
       * behind it is still live. The token is short-lived, but a membership
       * change or a sign-out everywhere must take effect before it expires.
       */
      const authorize = Effect.fn("AuthService.authorize")(function* (accessToken: string) {
        const claims = yield* accessTokens
          .verify(accessToken)
          .pipe(Effect.mapError(() => authError(401, "UNAUTHENTICATED", "Sign in to continue.")));
        const session = yield* repository.findSession(claims.sessionId);
        if (!session || session.revokedAt !== null || session.expiresAt <= Date.now()) {
          return yield* authError(401, "SESSION_REVOKED", "This session has ended. Sign in again.");
        }
        return claims;
      });

      const membershipOf = Effect.fn("AuthService.membershipOf")(function* (
        userId: UserId,
        organizationId: OrganizationId,
      ) {
        const membership = yield* repository.membershipInOrganization({ userId, organizationId });
        // An organization the caller does not belong to is indistinguishable
        // from one that does not exist, so it cannot be probed for.
        if (!membership) {
          return yield* authError(404, "ORGANIZATION_NOT_FOUND", "This organization is not yours.");
        }
        return membership;
      });

      const requireRole = Effect.fn("AuthService.requireRole")(function* (
        userId: UserId,
        organizationId: OrganizationId,
        allowed: ReadonlyArray<OrganizationRole>,
      ) {
        const membership = yield* membershipOf(userId, organizationId);
        if (!allowed.includes(membership.role)) {
          return yield* authError(
            403,
            "INSUFFICIENT_ROLE",
            allowed.length === 1 && allowed[0] === "owner"
              ? "Only the organization owner can do this."
              : "You do not have permission to do this.",
          );
        }
        return membership;
      });

      const membershipView = (membership: MembershipRecord) =>
        AuthOrganizationMembership.make({
          id: membership.organizationId,
          name: membership.organizationName,
          slug: membership.organizationSlug,
          role: membership.role,
        });

      const invitationView = (invitation: InvitationRecord) =>
        OrganizationInvitation.make({
          id: invitation.id,
          organizationId: invitation.organizationId,
          organizationName: invitation.organizationName,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        });

      const directory = Effect.fn("AuthService.directory")(function* (accessToken: string) {
        const claims = yield* authorize(accessToken);
        const memberships = yield* repository.membershipsForUser(claims.subject);
        const invitations = yield* repository.pendingInvitationsForEmail({
          email: claims.email,
          now: Date.now(),
        });
        const joined = new Set(memberships.map((membership) => membership.organizationId));
        return OrganizationDirectory.make({
          organizations: memberships.map(membershipView),
          invitations: invitations
            .filter((invitation) => !joined.has(invitation.organizationId))
            .map(invitationView),
        });
      });

      const roster = Effect.fn("AuthService.roster")(function* (input: {
        readonly accessToken: string;
        readonly organizationId: OrganizationId;
      }) {
        const claims = yield* authorize(input.accessToken);
        const membership = yield* membershipOf(claims.subject, input.organizationId);
        const members = yield* repository.listMembers(input.organizationId);
        // A plain member sees who they work with, not who is being courted.
        const invitations =
          membership.role === "member"
            ? []
            : yield* repository.pendingInvitationsForOrganization({
                organizationId: input.organizationId,
                now: Date.now(),
              });
        return OrganizationRoster.make({
          organization: membershipView(membership),
          members,
          invitations: invitations.map(invitationView),
        });
      });

      const createOrganization = Effect.fn("AuthService.createOrganization")(function* (
        claims: AccessClaims,
        name: string,
      ) {
        const allowed = yield* ephemeral.allow({
          key: `create-organization:${claims.subject}`,
          limit: 10,
          windowSeconds: 3_600,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(
            429,
            "RATE_LIMITED",
            "Wait before creating another organization.",
          );
        }
        const membership = yield* repository.createOrganization({
          name,
          ownerUserId: claims.subject,
        });
        return { _tag: "Joined", organization: membershipView(membership) } as const;
      });

      const inviteMember = Effect.fn("AuthService.inviteMember")(function* (
        claims: AccessClaims,
        input: {
          readonly organizationId: OrganizationId;
          readonly email: EmailAddress;
          readonly role: OrganizationRole;
        },
      ) {
        yield* requireRole(claims.subject, input.organizationId, ["owner", "admin"]);
        const address = EmailAddress.make(normalizeEmail(input.email));
        const members = yield* repository.listMembers(input.organizationId);
        if (members.some((member) => member.email === address)) {
          return yield* authError(
            409,
            "ALREADY_A_MEMBER",
            "This person is already in the organization.",
          );
        }
        const secret = randomSecret(32);
        const tokenHash = yield* sha256(`${configuration.refreshTokenPepper}:invite:${secret}`);
        const expiresAt = Date.now() + INVITATION_TTL_MS;
        const invitation = yield* repository.createInvitation({
          organizationId: input.organizationId,
          email: address,
          role: input.role,
          tokenHash,
          invitedByUserId: claims.subject,
          expiresAt,
          now: Date.now(),
        });
        yield* email
          .sendInvitation({
            email: address,
            organizationName: invitation.organizationName,
            role: invitation.role,
            invitedBy: claims.name,
            token: InvitationToken.make(secret),
            expiresAt,
          })
          .pipe(
            // The invitation exists whether or not anything could carry it, and
            // the inviter is handed the link either way.
            Effect.catchTag("Auth.EmailDeliveryError", (cause) =>
              Effect.logWarning("auth.invitation_delivery_failed").pipe(
                Effect.annotateLogs({ invitation: invitation.id, message: cause.message }),
              ),
            ),
          );
        return {
          _tag: "Invited",
          invitation: invitationView(invitation),
          token: InvitationToken.make(secret),
        } as const;
      });

      const acceptInvitation = Effect.fn("AuthService.acceptInvitation")(function* (
        claims: AccessClaims,
        token: string,
      ) {
        const allowed = yield* ephemeral.allow({
          key: `accept-invitation:${claims.subject}`,
          limit: 10,
          windowSeconds: 600,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(429, "RATE_LIMITED", "Wait before trying another invitation.");
        }
        const tokenHash = yield* sha256(`${configuration.refreshTokenPepper}:invite:${token}`);
        const invitation = yield* repository.findInvitationByTokenHash(tokenHash);
        const expired = invitation !== null && invitation.expiresAt <= Date.now();
        const spent =
          invitation !== null && (invitation.acceptedAt !== null || invitation.revokedAt !== null);
        if (!invitation || expired || spent) {
          return yield* authError(
            404,
            "INVITATION_NOT_FOUND",
            "This invitation is no longer valid. Ask for a new one.",
          );
        }
        // The invitation names one mailbox. Anyone else holding the link is not
        // who was invited, even if the link itself is genuine.
        if (invitation.email !== normalizeEmail(claims.email)) {
          return yield* authError(
            403,
            "INVITATION_EMAIL_MISMATCH",
            `This invitation was sent to ${invitation.email}.`,
          );
        }
        const accepted = yield* repository.acceptInvitation({
          invitation,
          userId: claims.subject,
          now: Date.now(),
        });
        if (!accepted) {
          return yield* authError(
            409,
            "INVITATION_ALREADY_USED",
            "This invitation has already been used.",
          );
        }
        return {
          _tag: "Joined",
          organization: AuthOrganizationMembership.make({
            id: invitation.organizationId,
            name: invitation.organizationName,
            slug: invitation.organizationSlug,
            role: invitation.role,
          }),
        } as const;
      });

      const changeMemberRole = Effect.fn("AuthService.changeMemberRole")(function* (
        claims: AccessClaims,
        input: {
          readonly organizationId: OrganizationId;
          readonly userId: UserId;
          readonly role: OrganizationRole;
        },
      ) {
        yield* requireRole(claims.subject, input.organizationId, ["owner"]);
        const target = yield* repository.membershipInOrganization({
          userId: input.userId,
          organizationId: input.organizationId,
        });
        if (!target) {
          return yield* authError(404, "MEMBER_NOT_FOUND", "This person is not a member.");
        }
        if (target.role === input.role) return { _tag: "Applied" } as const;
        // Somebody has to be able to grant roles, so the last owner cannot be
        // demoted. Promote a second owner first.
        if (target.role === "owner") {
          const owners = yield* repository.countRole({
            organizationId: input.organizationId,
            role: "owner",
          });
          if (owners <= 1) {
            return yield* authError(
              409,
              "LAST_OWNER",
              "Make someone else an owner before changing this role.",
            );
          }
        }
        yield* repository.changeMemberRole(input);
        return { _tag: "Applied" } as const;
      });

      const removeMember = Effect.fn("AuthService.removeMember")(function* (
        claims: AccessClaims,
        input: {
          readonly organizationId: OrganizationId;
          readonly userId: UserId;
        },
      ) {
        const caller = yield* requireRole(claims.subject, input.organizationId, ["owner", "admin"]);
        if (input.userId === claims.subject) {
          return yield* authError(
            409,
            "CANNOT_REMOVE_SELF",
            "Leave the organization instead of removing yourself.",
          );
        }
        const target = yield* repository.membershipInOrganization({
          userId: input.userId,
          organizationId: input.organizationId,
        });
        if (!target) {
          return yield* authError(404, "MEMBER_NOT_FOUND", "This person is not a member.");
        }
        // An admin manages the people below them; owners and other admins are
        // the owner's business.
        if (caller.role === "admin" && target.role !== "member") {
          return yield* authError(
            403,
            "INSUFFICIENT_ROLE",
            "Only the organization owner can remove an owner or an admin.",
          );
        }
        yield* repository.removeMember(input);
        return { _tag: "Applied" } as const;
      });

      const leaveOrganization = Effect.fn("AuthService.leaveOrganization")(function* (
        claims: AccessClaims,
        organizationId: OrganizationId,
      ) {
        const membership = yield* membershipOf(claims.subject, organizationId);
        const memberships = yield* repository.membershipsForUser(claims.subject);
        // Every session resolves to an organization, so the last one cannot be
        // left. Somewhere to land is what makes leaving possible.
        if (memberships.length <= 1) {
          return yield* authError(
            409,
            "LAST_ORGANIZATION",
            "Create or join another organization before leaving this one.",
          );
        }
        if (membership.role === "owner") {
          const owners = yield* repository.countRole({ organizationId, role: "owner" });
          if (owners <= 1) {
            return yield* authError(
              409,
              "LAST_OWNER",
              "Make someone else an owner before leaving this organization.",
            );
          }
        }
        yield* repository.removeMember({ organizationId, userId: claims.subject });
        return { _tag: "Applied" } as const;
      });

      const organize = Effect.fn("AuthService.organize")(function* (input: {
        readonly accessToken: string;
        readonly command: OrganizationCommand;
      }) {
        const claims = yield* authorize(input.accessToken);
        const command = input.command;
        switch (command._tag) {
          case "CreateOrganization":
            return yield* createOrganization(claims, command.name);
          case "InviteMember":
            return yield* inviteMember(claims, command);
          case "RevokeInvitation": {
            yield* requireRole(claims.subject, command.organizationId, ["owner", "admin"]);
            const revoked = yield* repository.revokeInvitation({
              organizationId: command.organizationId,
              invitationId: command.invitationId,
              now: Date.now(),
            });
            if (!revoked) {
              return yield* authError(
                404,
                "INVITATION_NOT_FOUND",
                "This invitation is no longer pending.",
              );
            }
            return { _tag: "Applied" } as const;
          }
          case "AcceptInvitation":
            return yield* acceptInvitation(claims, command.token);
          case "ChangeMemberRole":
            return yield* changeMemberRole(claims, command);
          case "RemoveMember":
            return yield* removeMember(claims, command);
          case "LeaveOrganization":
            return yield* leaveOrganization(claims, command.organizationId);
          default: {
            const _exhaustive: never = command;
            return _exhaustive;
          }
        }
      });

      const switchOrganization = Effect.fn("AuthService.switchOrganization")(function* (
        input: SwitchOrganizationInput,
      ) {
        const open = yield* openRefresh(input.refreshToken);
        const membership = yield* membershipOf(open.user.id, input.organizationId);
        return yield* rotateInto({ ...open, membership });
      });

      const handle = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(Effect.mapError(infrastructureError));

      return AuthService.of({
        identify: (input) => handle(identify(input)),
        authenticate: (command) => handle(authenticate(command)),
        beginGoogle: (input) => handle(beginGoogle(input)),
        completeGoogle: (input) => handle(completeGoogle(input)),
        exchangeGoogle: (input) => handle(exchangeGoogle(input)),
        exchangeGoogleIdToken: (input) => handle(exchangeGoogleIdToken(input)),
        refresh: (input) => handle(refresh(input)),
        signOut: (input) => handle(signOut(input)),
        directory: (accessToken) => handle(directory(accessToken)),
        roster: (input) => handle(roster(input)),
        organize: (input) => handle(organize(input)),
        switchOrganization: (input) => handle(switchOrganization(input)),
      });
    }),
  );
