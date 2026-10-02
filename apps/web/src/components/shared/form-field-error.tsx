import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { FieldError } from "@/components/ui/field";
import { isString } from "@/lib/predicates";

const decodeFailure = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

export function FormFieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
  const message = errors
    .map((error) => {
      if (isString(error)) return error;
      return decodeFailure(error).pipe(
        Option.map((failure) => failure.message),
        Option.getOrNull,
      );
    })
    .filter(Boolean)
    .join(" ");
  if (!message) return null;
  return <FieldError match>{message}</FieldError>;
}
