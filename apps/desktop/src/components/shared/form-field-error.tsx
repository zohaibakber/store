import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { FieldError } from "@/components/ui/field";

const FieldFailure = Schema.Struct({ message: Schema.String });

// TanStack Form errors bypass Base UI validity, so match forces rendering.
export function FormFieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
  const message = errors
    .map((error) => {
      if (Schema.is(Schema.String)(error)) return error;
      return Schema.decodeUnknownOption(FieldFailure)(error).pipe(
        Option.map((failure) => failure.message),
        Option.getOrNull,
      );
    })
    .filter(Boolean)
    .join(" ");
  if (!message) return null;
  return <FieldError match>{message}</FieldError>;
}
