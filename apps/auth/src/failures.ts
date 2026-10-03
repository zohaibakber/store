import { authHttpErrorStatus, EmailAddress, type AuthHttpError } from "@store/auth";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

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

const REFUSALS = {
  RefreshRequired: wire("Unauthenticated", "REFRESH_REQUIRED", "The session has expired."),
  InvalidRefreshToken: wire("Unauthenticated", "INVALID_REFRESH_TOKEN", "The session has expired."),
  RefreshReuseDetected: wire(
    "Unauthenticated",
    "REFRESH_REUSE_DETECTED",
    "This session was revoked. Sign in again.",
  ),
  RefreshExpired: wire("Unauthenticated", "REFRESH_EXPIRED", "The session has expired."),
  AccountNotFound: wire("Unauthenticated", "ACCOUNT_NOT_FOUND", "The account no longer exists."),
  Unauthenticated: wire("Unauthenticated", "UNAUTHENTICATED", "Sign in to continue."),
  SessionRevoked: wire(
    "Unauthenticated",
    "SESSION_REVOKED",
    "This session has ended. Sign in again.",
  ),
  InvalidEmail: wire("BadRequest", "INVALID_EMAIL", "Enter a valid email."),
  InvalidCredentials: wire(
    "Unauthenticated",
    "INVALID_CREDENTIALS",
    "The email or password is incorrect.",
  ),
  InvalidOtp: wire("Unauthenticated", "INVALID_OTP", "The code is invalid or has expired."),
  AccountExists: wire("Conflict", "ACCOUNT_EXISTS", "An account already exists for this email."),
  PasswordAccountExists: wire(
    "Conflict",
    "PASSWORD_ACCOUNT_EXISTS",
    "An account already exists for this email. Sign in with your password.",
  ),
  GoogleMailboxUnproven: wire(
    "Conflict",
    "GOOGLE_MAILBOX_UNPROVEN",
    "An account already exists for this email. Sign in the way you did before.",
  ),
  GoogleAccountLinked: wire(
    "Conflict",
    "GOOGLE_ACCOUNT_LINKED",
    "This Google account is already connected to another Tabaaq account.",
  ),
  InvalidRedirect: wire("BadRequest", "INVALID_REDIRECT", "The OAuth redirect is not allowed."),
  InvalidOAuthState: wire(
    "BadRequest",
    "INVALID_OAUTH_STATE",
    "The Google sign-in request has expired.",
  ),
  GoogleCodeUnverified: wire(
    "BadRequest",
    "INVALID_GOOGLE_IDENTITY",
    "Google sign-in could not be verified.",
  ),
  InvalidGoogleIdentity: wire(
    "Unauthenticated",
    "INVALID_GOOGLE_IDENTITY",
    "Google sign-in could not be verified.",
  ),
  InvalidAuthorizationCode: wire(
    "Unauthenticated",
    "INVALID_AUTHORIZATION_CODE",
    "The Google authorization has expired.",
  ),
  InvalidCodeVerifier: wire(
    "Unauthenticated",
    "INVALID_CODE_VERIFIER",
    "The Google authorization could not be verified.",
  ),
  InvalidOAuthClient: wire(
    "Unauthenticated",
    "INVALID_OAUTH_CLIENT",
    "The Google authorization client does not match.",
  ),
  OrganizationNotFound: wire(
    "NotFound",
    "ORGANIZATION_NOT_FOUND",
    "This organization is not yours.",
  ),
  AlreadyAMember: wire(
    "Conflict",
    "ALREADY_A_MEMBER",
    "This person is already in the organization.",
  ),
  InvitationInvalid: wire(
    "NotFound",
    "INVITATION_NOT_FOUND",
    "This invitation is no longer valid. Ask for a new one.",
  ),
  InvitationNotPending: wire(
    "NotFound",
    "INVITATION_NOT_FOUND",
    "This invitation is no longer pending.",
  ),
  InvitationAlreadyUsed: wire(
    "Conflict",
    "INVITATION_ALREADY_USED",
    "This invitation has already been used.",
  ),
  MemberNotFound: wire("NotFound", "MEMBER_NOT_FOUND", "This person is not a member."),
  CannotRemoveSelf: wire(
    "Conflict",
    "CANNOT_REMOVE_SELF",
    "Leave the organization instead of removing yourself.",
  ),
  Unavailable: wire(
    "ServiceUnavailable",
    "AUTH_UNAVAILABLE",
    "Authentication is temporarily unavailable.",
  ),
  "RateLimited.request": wire("TooManyRequests", "RATE_LIMITED", "Wait before trying again."),
  "RateLimited.code": wire("TooManyRequests", "RATE_LIMITED", "Wait before trying another code."),
  "RateLimited.invitation": wire(
    "TooManyRequests",
    "RATE_LIMITED",
    "Wait before trying another invitation.",
  ),
  "InsufficientRole.owner": wire(
    "Forbidden",
    "INSUFFICIENT_ROLE",
    "Only the organization owner can do this.",
  ),
  "InsufficientRole.manager": wire(
    "Forbidden",
    "INSUFFICIENT_ROLE",
    "You do not have permission to do this.",
  ),
  "InsufficientRole.ownerOverManagers": wire(
    "Forbidden",
    "INSUFFICIENT_ROLE",
    "Only the organization owner can remove an owner or an admin.",
  ),
  "LastOwner.roleChange": wire(
    "Conflict",
    "LAST_OWNER",
    "Make someone else an owner before changing this role.",
  ),
  "LastOwner.removal": wire(
    "Conflict",
    "LAST_OWNER",
    "Make someone else an owner before removing this person.",
  ),
} as const satisfies Record<string, AuthFailureWire>;

export class AuthRefusal extends Schema.TaggedError<AuthRefusal>()("Auth.Refusal", {
  reason: Schema.Literals(Struct.keys(REFUSALS)),
}) {}

export class InvitationEmailMismatch extends Schema.TaggedError<InvitationEmailMismatch>()(
  "Auth.InvitationEmailMismatch",
  { invited: EmailAddress },
) {}

export type AuthFailure = AuthRefusal | InvitationEmailMismatch;

export type RateLimitAttempt = "request" | "code" | "invitation";

export const authFailureWire = (failure: AuthFailure): AuthFailureWire => {
  switch (failure._tag) {
    case "Auth.Refusal":
      return REFUSALS[failure.reason];
    case "Auth.InvitationEmailMismatch":
      return wire(
        "Forbidden",
        "INVITATION_EMAIL_MISMATCH",
        `This invitation was sent to ${failure.invited}.`,
      );
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
