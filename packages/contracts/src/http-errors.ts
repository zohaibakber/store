import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as Schema from "effect/Schema";

const PublicErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

export const publicErrorSchema = <const Tag extends string>(tag: Tag, status: number) =>
  Schema.Struct({
    _tag: Schema.tagDefaultOmit(tag),
    error: PublicErrorBody,
  }).pipe(HttpApiSchema.status(status));
