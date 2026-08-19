import type * as React from "react";

import { FormFieldError } from "@/components/shared/form-field-error";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

// Structural shape of a TanStack Form field, kept minimal so this stays
// decoupled from the form's generics.
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

/** Spreadable onto a DOM input. No stray non-DOM attributes. */
export interface FormControlProps {
  readonly id: string;
  readonly name: string;
  readonly "aria-invalid": true | undefined;
}

/**
 * The frame every form control shares: label, invalid derivation, description
 * and error. The control itself stays with the caller, which receives the
 * wiring it needs, so each field keeps its own markup without restating the
 * `isTouched && !isValid` dance or forgetting `aria-invalid`.
 *
 * `invalid` comes through as a second argument rather than on `control` so
 * `{...control}` stays safe to spread onto a DOM element.
 */
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
