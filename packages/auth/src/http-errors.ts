import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

const PublicErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

const publicErrorSchema = <const Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.tagDefaultOmit(tag),
    error: PublicErrorBody,
  }).pipe(HttpApiSchema.status(status));

export const AuthBadRequest = publicErrorSchema("BadRequest", 400);
export type AuthBadRequest = typeof AuthBadRequest.Type;

export const AuthUnauthenticated = publicErrorSchema("Unauthenticated", 401);
export type AuthUnauthenticated = typeof AuthUnauthenticated.Type;

export const AuthForbidden = publicErrorSchema("Forbidden", 403);
export type AuthForbidden = typeof AuthForbidden.Type;

export const AuthNotFound = publicErrorSchema("NotFound", 404);
export type AuthNotFound = typeof AuthNotFound.Type;

export const AuthConflict = publicErrorSchema("Conflict", 409);
export type AuthConflict = typeof AuthConflict.Type;

export const AuthUnsupportedMediaType = publicErrorSchema("UnsupportedMediaType", 415);
export type AuthUnsupportedMediaType = typeof AuthUnsupportedMediaType.Type;

export const AuthTooManyRequests = publicErrorSchema("TooManyRequests", 429);
export type AuthTooManyRequests = typeof AuthTooManyRequests.Type;

export const AuthServiceUnavailable = publicErrorSchema("ServiceUnavailable", 503);
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

export type AuthHttpError =
  | AuthBadRequest
  | AuthUnauthenticated
  | AuthForbidden
  | AuthNotFound
  | AuthConflict
  | AuthUnsupportedMediaType
  | AuthTooManyRequests
  | AuthServiceUnavailable;

const authHttpErrorByStatus = {
  400: AuthBadRequest,
  401: AuthUnauthenticated,
  403: AuthForbidden,
  404: AuthNotFound,
  409: AuthConflict,
  415: AuthUnsupportedMediaType,
  429: AuthTooManyRequests,
  503: AuthServiceUnavailable,
} as const;

const authHttpErrorStatusByTag = {
  BadRequest: 400,
  Unauthenticated: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  UnsupportedMediaType: 415,
  TooManyRequests: 429,
  ServiceUnavailable: 503,
} as const satisfies Record<AuthHttpError["_tag"], number>;

const body = (code: string, message: string) => ({ error: { code, message } });

export const authHttpErrorStatus = (tag: AuthHttpError["_tag"]): number =>
  authHttpErrorStatusByTag[tag];

export const authHttpErrorFromStatus = (
  status: number,
  code: string,
  message: string,
): AuthHttpError => {
  const schema =
    status in authHttpErrorByStatus
      ? authHttpErrorByStatus[status as keyof typeof authHttpErrorByStatus]
      : AuthBadRequest;
  return schema.make(body(code, message));
};
