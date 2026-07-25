import { FieldError } from "@/components/ui/field";

// TanStack Form errors bypass Base UI validity, so match forces rendering.
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
