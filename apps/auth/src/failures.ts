import { authHttpErrorStatus, EmailAddress, type AuthHttpError } from "@store/auth";
import * as Schema from "effect/Schema";

export class RefreshRequired extends Schema.TaggedError<RefreshRequired>()(
  "Auth.RefreshRequired",
  {},
) {}

export class InvalidRefreshToken extends Schema.TaggedError<InvalidRefreshToken>()(
  "Auth.InvalidRefreshToken",
  {},
) {}

export class RefreshReuseDetected extends Schema.TaggedError<RefreshReuseDetected>()(
  "Auth.RefreshReuseDetected",
  {},
) {}

export class RefreshExpired extends Schema.TaggedError<RefreshExpired>()(
  "Auth.RefreshExpired",
  {},
) {}

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()(
  "Auth.AccountNotFound",
  {},
) {}

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Auth.Unauthenticated",
  {},
) {}

export class SessionRevoked extends Schema.TaggedError<SessionRevoked>()(
  "Auth.SessionRevoked",
  {},
) {}

export class InvalidEmail extends Schema.TaggedError<InvalidEmail>()("Auth.InvalidEmail", {}) {}

export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "Auth.InvalidCredentials",
  {},
) {}

export class InvalidOtp extends Schema.TaggedError<InvalidOtp>()("Auth.InvalidOtp", {}) {}

export class AccountExists extends Schema.TaggedError<AccountExists>()("Auth.AccountExists", {}) {}

export class PasswordAccountExists extends Schema.TaggedError<PasswordAccountExists>()(
  "Auth.PasswordAccountExists",
  {},
) {}

export class GoogleAccountLinked extends Schema.TaggedError<GoogleAccountLinked>()(
  "Auth.GoogleAccountLinked",
  {},
) {}

export class InvalidRedirect extends Schema.TaggedError<InvalidRedirect>()(
  "Auth.InvalidRedirect",
  {},
) {}

export class InvalidOAuthState extends Schema.TaggedError<InvalidOAuthState>()(
  "Auth.InvalidOAuthState",
  {},
) {}

export class GoogleCodeUnverified extends Schema.TaggedError<GoogleCodeUnverified>()(
  "Auth.GoogleCodeUnverified",
  {},
) {}

export class InvalidGoogleIdentity extends Schema.TaggedError<InvalidGoogleIdentity>()(
  "Auth.InvalidGoogleIdentity",
  {},
) {}

export class InvalidAuthorizationCode extends Schema.TaggedError<InvalidAuthorizationCode>()(
  "Auth.InvalidAuthorizationCode",
  {},
) {}

export class InvalidCodeVerifier extends Schema.TaggedError<InvalidCodeVerifier>()(
  "Auth.InvalidCodeVerifier",
  {},
) {}

export class InvalidOAuthClient extends Schema.TaggedError<InvalidOAuthClient>()(
  "Auth.InvalidOAuthClient",
  {},
) {}

export class OrganizationNotFound extends Schema.TaggedError<OrganizationNotFound>()(
  "Auth.OrganizationNotFound",
  {},
) {}

export class AlreadyAMember extends Schema.TaggedError<AlreadyAMember>()(
  "Auth.AlreadyAMember",
  {},
) {}

export class InvitationInvalid extends Schema.TaggedError<InvitationInvalid>()(
  "Auth.InvitationInvalid",
  {},
) {}

export class InvitationNotPending extends Schema.TaggedError<InvitationNotPending>()(
  "Auth.InvitationNotPending",
  {},
) {}

export class InvitationAlreadyUsed extends Schema.TaggedError<InvitationAlreadyUsed>()(
  "Auth.InvitationAlreadyUsed",
  {},
) {}

export class MemberNotFound extends Schema.TaggedError<MemberNotFound>()(
  "Auth.MemberNotFound",
  {},
) {}

export class CannotRemoveSelf extends Schema.TaggedError<CannotRemoveSelf>()(
  "Auth.CannotRemoveSelf",
  {},
) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Auth.Unavailable", {}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()("Auth.RateLimited", {
  attempting: Schema.Literals(["request", "code", "invitation"]),
}) {}

export class InsufficientRole extends Schema.TaggedError<InsufficientRole>()(
  "Auth.InsufficientRole",
  { requires: Schema.Literals(["owner", "manager", "ownerOverManagers"]) },
) {}

export class InvitationEmailMismatch extends Schema.TaggedError<InvitationEmailMismatch>()(
  "Auth.InvitationEmailMismatch",
  { invited: EmailAddress },
) {}

export class LastOwner extends Schema.TaggedError<LastOwner>()("Auth.LastOwner", {
  blocks: Schema.Literals(["roleChange", "removal"]),
}) {}

export type AuthFailure =
  | RefreshRequired
  | InvalidRefreshToken
  | RefreshReuseDetected
  | RefreshExpired
  | AccountNotFound
  | Unauthenticated
  | SessionRevoked
  | InvalidEmail
  | InvalidCredentials
  | InvalidOtp
  | AccountExists
  | PasswordAccountExists
  | GoogleAccountLinked
  | InvalidRedirect
  | InvalidOAuthState
  | GoogleCodeUnverified
  | InvalidGoogleIdentity
  | InvalidAuthorizationCode
  | InvalidCodeVerifier
  | InvalidOAuthClient
  | OrganizationNotFound
  | AlreadyAMember
  | InvitationInvalid
  | InvitationNotPending
  | InvitationAlreadyUsed
  | MemberNotFound
  | CannotRemoveSelf
  | Unavailable
  | RateLimited
  | InsufficientRole
  | InvitationEmailMismatch
  | LastOwner;

interface AuthFailureWire {
  readonly kind: AuthHttpError["_tag"];
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

const wire = (kind: AuthHttpError["_tag"], code: string, message: string): AuthFailureWire => ({
  kind,
  status: authHttpErrorStatus(kind),
  code,
  message,
});

const RATE_LIMIT_MESSAGE = {
  request: "Wait before trying again.",
  code: "Wait before trying another code.",
  invitation: "Wait before trying another invitation.",
} as const;

const INSUFFICIENT_ROLE_MESSAGE = {
  owner: "Only the organization owner can do this.",
  manager: "You do not have permission to do this.",
  ownerOverManagers: "Only the organization owner can remove an owner or an admin.",
} as const;

const LAST_OWNER_MESSAGE = {
  roleChange: "Make someone else an owner before changing this role.",
  removal: "Make someone else an owner before removing this person.",
} as const;

export const authFailureWire = (failure: AuthFailure): AuthFailureWire => {
  switch (failure._tag) {
    case "Auth.RefreshRequired":
      return wire("Unauthenticated", "REFRESH_REQUIRED", "The session has expired.");
    case "Auth.InvalidRefreshToken":
      return wire("Unauthenticated", "INVALID_REFRESH_TOKEN", "The session has expired.");
    case "Auth.RefreshReuseDetected":
      return wire(
        "Unauthenticated",
        "REFRESH_REUSE_DETECTED",
        "This session was revoked. Sign in again.",
      );
    case "Auth.RefreshExpired":
      return wire("Unauthenticated", "REFRESH_EXPIRED", "The session has expired.");
    case "Auth.AccountNotFound":
      return wire("Unauthenticated", "ACCOUNT_NOT_FOUND", "The account no longer exists.");
    case "Auth.Unauthenticated":
      return wire("Unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");
    case "Auth.SessionRevoked":
      return wire("Unauthenticated", "SESSION_REVOKED", "This session has ended. Sign in again.");
    case "Auth.InvalidEmail":
      return wire("BadRequest", "INVALID_EMAIL", "Enter a valid email.");
    case "Auth.InvalidCredentials":
      return wire("Unauthenticated", "INVALID_CREDENTIALS", "The email or password is incorrect.");
    case "Auth.InvalidOtp":
      return wire("Unauthenticated", "INVALID_OTP", "The code is invalid or has expired.");
    case "Auth.AccountExists":
      return wire("Conflict", "ACCOUNT_EXISTS", "An account already exists for this email.");
    case "Auth.PasswordAccountExists":
      return wire(
        "Conflict",
        "PASSWORD_ACCOUNT_EXISTS",
        "Sign in with your password, then connect Google from settings.",
      );
    case "Auth.GoogleAccountLinked":
      return wire(
        "Conflict",
        "GOOGLE_ACCOUNT_LINKED",
        "This Google account is already connected to another Tabaaq account.",
      );
    case "Auth.InvalidRedirect":
      return wire("BadRequest", "INVALID_REDIRECT", "The OAuth redirect is not allowed.");
    case "Auth.InvalidOAuthState":
      return wire("BadRequest", "INVALID_OAUTH_STATE", "The Google sign-in request has expired.");
    case "Auth.GoogleCodeUnverified":
      return wire("BadRequest", "INVALID_GOOGLE_IDENTITY", "Google sign-in could not be verified.");
    case "Auth.InvalidGoogleIdentity":
      return wire(
        "Unauthenticated",
        "INVALID_GOOGLE_IDENTITY",
        "Google sign-in could not be verified.",
      );
    case "Auth.InvalidAuthorizationCode":
      return wire(
        "Unauthenticated",
        "INVALID_AUTHORIZATION_CODE",
        "The Google authorization has expired.",
      );
    case "Auth.InvalidCodeVerifier":
      return wire(
        "Unauthenticated",
        "INVALID_CODE_VERIFIER",
        "The Google authorization could not be verified.",
      );
    case "Auth.InvalidOAuthClient":
      return wire(
        "Unauthenticated",
        "INVALID_OAUTH_CLIENT",
        "The Google authorization client does not match.",
      );
    case "Auth.OrganizationNotFound":
      return wire("NotFound", "ORGANIZATION_NOT_FOUND", "This organization is not yours.");
    case "Auth.AlreadyAMember":
      return wire("Conflict", "ALREADY_A_MEMBER", "This person is already in the organization.");
    case "Auth.InvitationInvalid":
      return wire(
        "NotFound",
        "INVITATION_NOT_FOUND",
        "This invitation is no longer valid. Ask for a new one.",
      );
    case "Auth.InvitationNotPending":
      return wire("NotFound", "INVITATION_NOT_FOUND", "This invitation is no longer pending.");
    case "Auth.InvitationAlreadyUsed":
      return wire("Conflict", "INVITATION_ALREADY_USED", "This invitation has already been used.");
    case "Auth.MemberNotFound":
      return wire("NotFound", "MEMBER_NOT_FOUND", "This person is not a member.");
    case "Auth.CannotRemoveSelf":
      return wire(
        "Conflict",
        "CANNOT_REMOVE_SELF",
        "Leave the organization instead of removing yourself.",
      );
    case "Auth.Unavailable":
      return wire(
        "ServiceUnavailable",
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
      );
    case "Auth.RateLimited":
      return wire("TooManyRequests", "RATE_LIMITED", RATE_LIMIT_MESSAGE[failure.attempting]);
    case "Auth.InsufficientRole":
      return wire("Forbidden", "INSUFFICIENT_ROLE", INSUFFICIENT_ROLE_MESSAGE[failure.requires]);
    case "Auth.InvitationEmailMismatch":
      return wire(
        "Forbidden",
        "INVITATION_EMAIL_MISMATCH",
        `This invitation was sent to ${failure.invited}.`,
      );
    case "Auth.LastOwner":
      return wire("Conflict", "LAST_OWNER", LAST_OWNER_MESSAGE[failure.blocks]);
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
};

export const authHttpError = (failure: AuthFailure): AuthHttpError => {
  const { kind, code, message } = authFailureWire(failure);
  return { _tag: kind, error: { code, message } };
};
