import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as React from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { isString } from "@/lib/predicates";

const decodeFailure = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

function FormFieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
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

interface FormFieldApi {
  readonly name: string;
  readonly state: {
    readonly meta: {
      readonly isTouched: boolean;
      readonly isValid: boolean;
      readonly errors: ReadonlyArray<unknown>;
    };
  };
}

export interface FormControlProps {
  readonly id: string;
  readonly name: string;
  readonly "aria-invalid": true | undefined;
}

export function FormField({
  children,
  description,
  field,
  label,
}: {
  children: (control: FormControlProps, invalid: boolean) => React.ReactNode;
  description?: React.ReactNode;
  field: FormFieldApi;
  label: React.ReactNode;
}) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {children(
        { id: field.name, name: field.name, "aria-invalid": invalid || undefined },
        invalid,
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {invalid && <FormFieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
