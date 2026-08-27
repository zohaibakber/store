import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const Identifier = NonEmptyString.check(Schema.isMaxLength(128));

export const UserId = Identifier.pipe(Schema.brand("AuthUserId"));
export type UserId = typeof UserId.Type;

export const OrganizationId = Identifier.pipe(Schema.brand("AuthOrganizationId"));
export type OrganizationId = typeof OrganizationId.Type;

export const SessionId = Identifier.pipe(Schema.brand("AuthSessionId"));
export type SessionId = typeof SessionId.Type;

export const OtpChallengeId = Identifier.pipe(Schema.brand("OtpChallengeId"));
export type OtpChallengeId = typeof OtpChallengeId.Type;

export const AuthorizationCode = Identifier.pipe(Schema.brand("AuthorizationCode"));
export type AuthorizationCode = typeof AuthorizationCode.Type;

export const AccessToken = NonEmptyString.pipe(Schema.brand("AccessToken"));
export type AccessToken = typeof AccessToken.Type;

export const RefreshToken = NonEmptyString.pipe(Schema.brand("RefreshToken"));
export type RefreshToken = typeof RefreshToken.Type;

export const EmailAddress = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u),
).pipe(Schema.brand("EmailAddress"));
export type EmailAddress = typeof EmailAddress.Type;

export const Password = Schema.String.check(
  Schema.isMinLength(10),
  Schema.isMaxLength(100),
  Schema.makeFilter((value) => value === value.trim(), {
    title: "Password without surrounding whitespace",
  }),
).pipe(Schema.brand("Password"));
export type Password = typeof Password.Type;

export const OtpCode = Schema.String.check(Schema.isPattern(/^\d{6}$/u)).pipe(
  Schema.brand("OtpCode"),
);
export type OtpCode = typeof OtpCode.Type;

export const OrganizationRole = Schema.Literals(["owner", "admin", "member"]);
export type OrganizationRole = typeof OrganizationRole.Type;

/** Ownership transfers through a role change, so an invitation cannot grant it. */
export const InvitableRole = Schema.Literals(["admin", "member"]);
export type InvitableRole = typeof InvitableRole.Type;

export const OrganizationName = Schema.String.check(
  Schema.isMinLength(2),
  Schema.isMaxLength(60),
  Schema.makeFilter((value) => value === value.trim(), {
    title: "Organization name without surrounding whitespace",
  }),
).pipe(Schema.brand("OrganizationName"));
export type OrganizationName = typeof OrganizationName.Type;

/** A URL-safe handle. The column is uniquely indexed, so two stores cannot share one. */
export const OrganizationSlug = Schema.String.check(
  Schema.isMinLength(2),
  Schema.isMaxLength(40),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
).pipe(Schema.brand("OrganizationSlug"));
export type OrganizationSlug = typeof OrganizationSlug.Type;

export const InvitationId = Identifier.pipe(Schema.brand("AuthInvitationId"));
export type InvitationId = typeof InvitationId.Type;

/**
 * An opaque secret. D1 stores only its hash, so the token is readable exactly
 * once: in the response that created it.
 */
export const InvitationToken = NonEmptyString.check(Schema.isMaxLength(256)).pipe(
  Schema.brand("InvitationToken"),
);
export type InvitationToken = typeof InvitationToken.Type;

export const AuthClientKind = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Browser"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Native"),
    deviceName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
]);
export type AuthClientKind = typeof AuthClientKind.Type;

export const browserClient = (): AuthClientKind => ({ _tag: "Browser" });
export const nativeClient = (deviceName: string): AuthClientKind => ({
  _tag: "Native",
  deviceName,
});

export const IdentifyInput = Schema.Struct({
  email: EmailAddress,
});
export interface IdentifyInput extends Schema.Schema.Type<typeof IdentifyInput> {}

export const LoginRoute = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Password"),
    email: EmailAddress,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Otp"),
    email: EmailAddress,
    challengeId: OtpChallengeId,
    developmentCode: Schema.optionalKey(OtpCode),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Registration"),
    email: EmailAddress,
  }),
]);
export type LoginRoute = typeof LoginRoute.Type;

export const LoginCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Password"),
    email: EmailAddress,
    password: Password,
    client: AuthClientKind,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Otp"),
    challengeId: OtpChallengeId,
    code: OtpCode,
    client: AuthClientKind,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RegisterPassword"),
    email: EmailAddress,
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    password: Password,
    client: AuthClientKind,
  }),
]);
export type LoginCommand = typeof LoginCommand.Type;

export const TokenSet = Schema.Struct({
  accessToken: AccessToken,
  accessExpiresAt: Schema.Number,
  refreshToken: Schema.optionalKey(RefreshToken),
  refreshExpiresAt: Schema.Number,
});
export interface TokenSet extends Schema.Schema.Type<typeof TokenSet> {}

export const AccessClaims = Schema.Struct({
  subject: UserId,
  sessionId: SessionId,
  activeOrganizationId: OrganizationId,
  organizationName: Schema.String,
  organizationSlug: Schema.NullOr(Schema.String),
  role: OrganizationRole,
  email: EmailAddress,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
});
export interface AccessClaims extends Schema.Schema.Type<typeof AccessClaims> {}

export const BeginGoogleInput = Schema.Struct({
  redirectUri: NonEmptyString,
  codeChallenge: NonEmptyString,
  client: AuthClientKind,
});
export interface BeginGoogleInput extends Schema.Schema.Type<typeof BeginGoogleInput> {}

export const GoogleAuthorization = Schema.Struct({
  url: NonEmptyString,
});
export interface GoogleAuthorization extends Schema.Schema.Type<typeof GoogleAuthorization> {}

export const ExchangeGoogleInput = Schema.Struct({
  code: AuthorizationCode,
  codeVerifier: NonEmptyString,
  client: AuthClientKind,
});
export interface ExchangeGoogleInput extends Schema.Schema.Type<typeof ExchangeGoogleInput> {}

export const GoogleIdToken = NonEmptyString.check(Schema.isMaxLength(8192)).pipe(
  Schema.brand("GoogleIdToken"),
);
export type GoogleIdToken = typeof GoogleIdToken.Type;

/**
 * Native clients sign in through Google's own account picker, so they arrive
 * with an ID token instead of an authorization code.
 */
export const ExchangeGoogleIdTokenInput = Schema.Struct({
  idToken: GoogleIdToken,
  client: AuthClientKind,
});
export interface ExchangeGoogleIdTokenInput extends Schema.Schema.Type<
  typeof ExchangeGoogleIdTokenInput
> {}

export const RefreshInput = Schema.Struct({
  refreshToken: Schema.optionalKey(RefreshToken),
});
export interface RefreshInput extends Schema.Schema.Type<typeof RefreshInput> {}

export const SignOutInput = Schema.Struct({
  refreshToken: Schema.optionalKey(RefreshToken),
  everywhere: Schema.optionalKey(Schema.Boolean),
});
export interface SignOutInput extends Schema.Schema.Type<typeof SignOutInput> {}

export const AuthUser = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: EmailAddress,
  image: Schema.NullOr(Schema.String),
});
export interface AuthUser extends Schema.Schema.Type<typeof AuthUser> {}

export const AuthOrganizationMembership = Schema.Struct({
  id: OrganizationId,
  name: Schema.String,
  slug: Schema.NullOr(Schema.String),
  role: OrganizationRole,
});
export interface AuthOrganizationMembership extends Schema.Schema.Type<
  typeof AuthOrganizationMembership
> {}

export const AuthSessionRecord = Schema.Struct({
  id: SessionId,
  userId: UserId,
  activeOrganizationId: OrganizationId,
  expiresAt: Schema.Number,
});
export interface AuthSessionRecord extends Schema.Schema.Type<typeof AuthSessionRecord> {}

export const AuthSession = Schema.Struct({
  user: AuthUser,
  session: AuthSessionRecord,
  organizations: Schema.Array(AuthOrganizationMembership),
});
export interface AuthSession extends Schema.Schema.Type<typeof AuthSession> {}

export const OrganizationMember = Schema.Struct({
  userId: UserId,
  name: Schema.String,
  email: EmailAddress,
  image: Schema.NullOr(Schema.String),
  role: OrganizationRole,
  joinedAt: Schema.Number,
});
export interface OrganizationMember extends Schema.Schema.Type<typeof OrganizationMember> {}

export const OrganizationInvitation = Schema.Struct({
  id: InvitationId,
  organizationId: OrganizationId,
  organizationName: Schema.String,
  email: EmailAddress,
  role: OrganizationRole,
  expiresAt: Schema.Number,
  createdAt: Schema.Number,
});
export interface OrganizationInvitation extends Schema.Schema.Type<typeof OrganizationInvitation> {}

/**
 * The signed-in session's own organization with everything its settings
 * surface shows. There is no directory of other organizations: a session
 * belongs to one store, and redeeming an invitation is the only thing that
 * moves it to another.
 */
export const OrganizationRoster = Schema.Struct({
  organization: AuthOrganizationMembership,
  members: Schema.Array(OrganizationMember),
  invitations: Schema.Array(OrganizationInvitation),
});
export interface OrganizationRoster extends Schema.Schema.Type<typeof OrganizationRoster> {}

/**
 * Every command names the organization it acts on except the one that joins a
 * new one, where the token is the only thing the caller has.
 */
export const OrganizationCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("UpdateOrganization"),
    organizationId: OrganizationId,
    name: OrganizationName,
    slug: Schema.NullOr(OrganizationSlug),
  }),
  Schema.Struct({
    _tag: Schema.Literal("InviteMember"),
    organizationId: OrganizationId,
    email: EmailAddress,
    role: InvitableRole,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RevokeInvitation"),
    organizationId: OrganizationId,
    invitationId: InvitationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AcceptInvitation"),
    token: InvitationToken,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ChangeMemberRole"),
    organizationId: OrganizationId,
    userId: UserId,
    role: OrganizationRole,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveMember"),
    organizationId: OrganizationId,
    userId: UserId,
  }),
]);
export type OrganizationCommand = typeof OrganizationCommand.Type;

/**
 * The caller learns whatever the change produced: the organization as it now
 * reads, the invitation token they have to deliver themselves while email is
 * stubbed, or nothing beyond success.
 *
 * `Joined` also means the session moved: redeeming an invitation points it at
 * the organization that was joined, so the next token refresh lands there.
 */
export const OrganizationCommandResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Joined"),
    organization: AuthOrganizationMembership,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Updated"),
    organization: AuthOrganizationMembership,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Invited"),
    invitation: OrganizationInvitation,
    token: InvitationToken,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Applied"),
  }),
]);
export type OrganizationCommandResult = typeof OrganizationCommandResult.Type;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
