import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const lenientSearchParam = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
) => Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))));
