import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

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

export const RefreshToken = NonEmptyString.check(Schema.isMaxLength(512)).pipe(
  Schema.brand("RefreshToken"),
);
export type RefreshToken = typeof RefreshToken.Type;

export const EmailAddress = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u),
).pipe(Schema.brand("EmailAddress"));
export type EmailAddress = typeof EmailAddress.Type;

export const PasswordPolicy = Schema.String.check(
  Schema.isMinLength(10),
  Schema.isMaxLength(100),
  Schema.makeFilter((value) => value === value.trim(), {
    title: "Password without surrounding whitespace",
  }),
);

const NewPassword = Schema.RedactedFromValue(PasswordPolicy);
const SubmittedPassword = Schema.RedactedFromValue(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
);

export const OtpCode = Schema.String.check(Schema.isPattern(/^\d{6}$/u)).pipe(
  Schema.brand("OtpCode"),
);
export type OtpCode = typeof OtpCode.Type;

export const OrganizationRole = Schema.Literals(["owner", "admin", "member"]);
export type OrganizationRole = typeof OrganizationRole.Type;

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

export const InvitationId = Identifier.pipe(Schema.brand("AuthInvitationId"));
export type InvitationId = typeof InvitationId.Type;

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

export const PasswordLoginCommand = Schema.Struct({
  _tag: Schema.Literal("Password"),
  email: EmailAddress,
  password: SubmittedPassword,
  client: AuthClientKind,
});

export const OtpLoginCommand = Schema.Struct({
  _tag: Schema.Literal("Otp"),
  challengeId: OtpChallengeId,
  code: OtpCode,
  client: AuthClientKind,
});

export const RegisterPasswordCommand = Schema.Struct({
  _tag: Schema.Literal("RegisterPassword"),
  email: EmailAddress,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  password: NewPassword,
  client: AuthClientKind,
});

export const LoginCommand = Schema.Union([
  PasswordLoginCommand,
  OtpLoginCommand,
  RegisterPasswordCommand,
]);
export type LoginCommand = typeof LoginCommand.Type;
export type LoginCredentials = typeof LoginCommand.Encoded;

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
  role: OrganizationRole,
  email: EmailAddress,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
});
export interface AccessClaims extends Schema.Schema.Type<typeof AccessClaims> {}

const PkceChallenge = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u));
const PkceVerifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~-]{43,128}$/u));

export const BeginGoogleInput = Schema.Struct({
  redirectUri: NonEmptyString.check(Schema.isMaxLength(2048)),
  codeChallenge: PkceChallenge,
  client: AuthClientKind,
});
export interface BeginGoogleInput extends Schema.Schema.Type<typeof BeginGoogleInput> {}

export const GoogleAuthorization = Schema.Struct({
  url: NonEmptyString,
});
export interface GoogleAuthorization extends Schema.Schema.Type<typeof GoogleAuthorization> {}

export const ExchangeGoogleInput = Schema.Struct({
  code: AuthorizationCode,
  codeVerifier: PkceVerifier,
  client: AuthClientKind,
});
export interface ExchangeGoogleInput extends Schema.Schema.Type<typeof ExchangeGoogleInput> {}

export const GoogleIdToken = NonEmptyString.check(Schema.isMaxLength(8192)).pipe(
  Schema.brand("GoogleIdToken"),
);
export type GoogleIdToken = typeof GoogleIdToken.Type;

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
});
export interface SignOutInput extends Schema.Schema.Type<typeof SignOutInput> {}

const AuthUser = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: EmailAddress,
  image: Schema.NullOr(Schema.String),
});
interface AuthUser extends Schema.Schema.Type<typeof AuthUser> {}

const MembershipWithLegacySlug = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.optionalKey(Schema.NullOr(Schema.String)),
  role: OrganizationRole,
});

export const AuthOrganizationMembership = MembershipWithLegacySlug.pipe(
  Schema.decodeTo(
    Schema.Struct({
      id: OrganizationId,
      name: Schema.String,
      role: OrganizationRole,
    }),
    SchemaTransformation.transform({
      decode: ({ id, name, role }) => ({ id, name, role }),
      encode: ({ id, name, role }) => ({ id, name, slug: null, role }),
    }),
  ),
);
export interface AuthOrganizationMembership extends Schema.Schema.Type<
  typeof AuthOrganizationMembership
> {}

const SessionWorkspace = Schema.Struct({
  status: Schema.Literal("authenticated"),
  user: AuthUser,
  activeOrganization: AuthOrganizationMembership,
  organizations: Schema.Array(AuthOrganizationMembership),
  isOnline: Schema.Boolean,
});
interface SessionWorkspace extends Schema.Schema.Type<typeof SessionWorkspace> {}

export const sessionWorkspaceFromClaims = (
  claims: Omit<AccessClaims, "sessionId" | "expiresAt">,
): SessionWorkspace => {
  const organization: AuthOrganizationMembership = {
    id: claims.activeOrganizationId,
    name: claims.organizationName,
    role: claims.role,
  };
  return {
    status: "authenticated",
    user: { id: claims.subject, name: claims.name, email: claims.email, image: claims.image },
    activeOrganization: organization,
    organizations: [organization],
    isOnline: true,
  };
};

export const RefreshedSession = TokenSet.pipe(Schema.fieldsAssign({ workspace: SessionWorkspace }));
export interface RefreshedSession extends Schema.Schema.Type<typeof RefreshedSession> {}

export const IssuedSession = TokenSet.pipe(
  Schema.fieldsAssign({ workspace: Schema.optionalKey(SessionWorkspace) }),
);
export interface IssuedSession extends Schema.Schema.Type<typeof IssuedSession> {}

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

export const OrganizationRoster = Schema.Struct({
  organization: AuthOrganizationMembership,
  members: Schema.Array(OrganizationMember),
  invitations: Schema.Array(OrganizationInvitation),
});
export interface OrganizationRoster extends Schema.Schema.Type<typeof OrganizationRoster> {}

export const OrganizationCommand = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("UpdateOrganization"),
    organizationId: OrganizationId,
    name: OrganizationName,
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
