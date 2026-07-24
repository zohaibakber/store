import { FieldError } from "@/components/ui/field";

// TanStack Form reports errors as standard-schema issues ({ message }) or
// strings; coss FieldError only renders inside Base UI's own validity state,
// so `match` forces it visible when the form library says the field is invalid.
export function FormFieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
  const message = errors
    .map((error) => {
      if (typeof error === "string") return error;
      if (error && typeof error === "object" && "message" in error) {
        return String((error as { message: unknown }).message);
      }
      return null;
    })
    .filter(Boolean)
    .join(" ");
  if (!message) return null;
  return <FieldError match>{message}</FieldError>;
}
