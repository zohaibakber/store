import * as Schema from "effect/Schema";

export const formValidator = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);
