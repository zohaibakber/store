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

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
