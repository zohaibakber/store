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

export const BadRequest = publicErrorSchema("BadRequest", 400);
export type BadRequest = typeof BadRequest.Type;

export const Unauthenticated = publicErrorSchema("Unauthenticated", 401);
export type Unauthenticated = typeof Unauthenticated.Type;

export const Forbidden = publicErrorSchema("Forbidden", 403);
export type Forbidden = typeof Forbidden.Type;

export const PayloadTooLarge = publicErrorSchema("PayloadTooLarge", 413);
export type PayloadTooLarge = typeof PayloadTooLarge.Type;

export const UnsupportedMediaType = publicErrorSchema("UnsupportedMediaType", 415);
export type UnsupportedMediaType = typeof UnsupportedMediaType.Type;

export const TooManyRequests = publicErrorSchema("TooManyRequests", 429);
export type TooManyRequests = typeof TooManyRequests.Type;

export const BadGateway = publicErrorSchema("BadGateway", 502);
export type BadGateway = typeof BadGateway.Type;

export const publicError = (code: string, message: string) => ({ error: { code, message } });

export const badRequest = (code: string, message: string) =>
  BadRequest.make(publicError(code, message));
export const unauthenticated = (code: string, message: string) =>
  Unauthenticated.make(publicError(code, message));
export const forbidden = (code: string, message: string) =>
  Forbidden.make(publicError(code, message));
export const payloadTooLarge = (code: string, message: string) =>
  PayloadTooLarge.make(publicError(code, message));
export const unsupportedMediaType = (code: string, message: string) =>
  UnsupportedMediaType.make(publicError(code, message));
export const tooManyRequests = (code: string, message: string) =>
  TooManyRequests.make(publicError(code, message));
export const badGateway = (code: string, message: string) =>
  BadGateway.make(publicError(code, message));
