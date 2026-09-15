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

export const SyncBadRequest = publicErrorSchema("BadRequest", 400);
export type SyncBadRequest = typeof SyncBadRequest.Type;

export const SyncForbidden = publicErrorSchema("Forbidden", 403);
export type SyncForbidden = typeof SyncForbidden.Type;

export const SyncNotFound = publicErrorSchema("NotFound", 404);
export type SyncNotFound = typeof SyncNotFound.Type;

export const SyncConflict = publicErrorSchema("Conflict", 409);
export type SyncConflict = typeof SyncConflict.Type;

export const SyncServiceUnavailable = publicErrorSchema("ServiceUnavailable", 503);
export type SyncServiceUnavailable = typeof SyncServiceUnavailable.Type;
