import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Schema from "effect/Schema";

const statusByTag = {
  BadRequest: 400,
  Unauthenticated: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  UnsupportedMediaType: 415,
  TooManyRequests: 429,
  ServiceUnavailable: 503,
} as const;

type AuthHttpErrorTag = keyof typeof statusByTag;

export const AuthErrorCode = Schema.Literals([
  "INVALID_REFRESH_TOKEN",
  "REFRESH_REUSE_DETECTED",
  "REFRESH_EXPIRED",
  "ACCOUNT_NOT_FOUND",
  "UNAUTHENTICATED",
  "SESSION_REVOKED",
  "INVALID_EMAIL",
  "INVALID_CREDENTIALS",
  "INVALID_OTP",
  "ACCOUNT_EXISTS",
  "PASSWORD_ACCOUNT_EXISTS",
  "GOOGLE_MAILBOX_UNPROVEN",
  "GOOGLE_ACCOUNT_LINKED",
  "INVALID_REDIRECT",
  "INVALID_OAUTH_STATE",
  "INVALID_GOOGLE_IDENTITY",
  "INVALID_AUTHORIZATION_CODE",
  "INVALID_CODE_VERIFIER",
  "INVALID_OAUTH_CLIENT",
  "ORGANIZATION_NOT_FOUND",
  "ALREADY_A_MEMBER",
  "INVITATION_NOT_FOUND",
  "INVITATION_ALREADY_USED",
  "MEMBER_NOT_FOUND",
  "CANNOT_REMOVE_SELF",
  "AUTH_UNAVAILABLE",
  "RATE_LIMITED",
  "INSUFFICIENT_ROLE",
  "LAST_OWNER",
  "INVITATION_EMAIL_MISMATCH",
  "INVALID_REQUEST",
  "UNTRUSTED_ORIGIN",
  "NOT_FOUND",
  "INTERNAL_SERVER_ERROR",
]);
export type AuthErrorCode = typeof AuthErrorCode.Type;

const PublicErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

const publicErrorSchema = <const Tag extends AuthHttpErrorTag>(tag: Tag) =>
  Schema.Struct({
    _tag: Schema.tagDefaultOmit(tag),
    error: PublicErrorBody,
  }).pipe(HttpApiSchema.status(statusByTag[tag]));

export const AuthBadRequest = publicErrorSchema("BadRequest");
export type AuthBadRequest = typeof AuthBadRequest.Type;

export const AuthUnauthenticated = publicErrorSchema("Unauthenticated");
export type AuthUnauthenticated = typeof AuthUnauthenticated.Type;

export const AuthForbidden = publicErrorSchema("Forbidden");
export type AuthForbidden = typeof AuthForbidden.Type;

export const AuthNotFound = publicErrorSchema("NotFound");
export type AuthNotFound = typeof AuthNotFound.Type;

export const AuthConflict = publicErrorSchema("Conflict");
export type AuthConflict = typeof AuthConflict.Type;

export const AuthUnsupportedMediaType = publicErrorSchema("UnsupportedMediaType");
export type AuthUnsupportedMediaType = typeof AuthUnsupportedMediaType.Type;

export const AuthTooManyRequests = publicErrorSchema("TooManyRequests");
export type AuthTooManyRequests = typeof AuthTooManyRequests.Type;

export const AuthServiceUnavailable = publicErrorSchema("ServiceUnavailable");
export type AuthServiceUnavailable = typeof AuthServiceUnavailable.Type;

export const AuthHttpErrors = [
  AuthBadRequest,
  AuthUnauthenticated,
  AuthForbidden,
  AuthNotFound,
  AuthConflict,
  AuthUnsupportedMediaType,
  AuthTooManyRequests,
  AuthServiceUnavailable,
] as const;

export type AuthHttpError = (typeof AuthHttpErrors)[number]["Type"];

export const authHttpErrorStatus = (tag: AuthHttpError["_tag"]): number => statusByTag[tag];

const SESSION_ENDING_CODES: ReadonlyArray<AuthErrorCode> = [
  "INVALID_REFRESH_TOKEN",
  "REFRESH_REUSE_DETECTED",
  "REFRESH_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_NOT_FOUND",
  "UNAUTHENTICATED",
];

export const sessionEndingCodes: ReadonlySet<string> = new Set(SESSION_ENDING_CODES);
