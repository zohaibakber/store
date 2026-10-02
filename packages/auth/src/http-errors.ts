import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

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

export const sessionEndingCodes: ReadonlySet<string> = new Set([
  "REFRESH_REQUIRED",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_REUSE_DETECTED",
  "REFRESH_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_NOT_FOUND",
  "UNAUTHENTICATED",
]);
