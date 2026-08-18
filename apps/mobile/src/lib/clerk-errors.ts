import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type ClerkFieldError = {
  readonly message: string;
  readonly longMessage?: string;
};

export type ClerkGlobalError = {
  readonly message: string;
  readonly longMessage?: string;
};

const ClerkErrorCause = Schema.Struct({
  code: Schema.optional(Schema.String),
  longMessage: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const messageOf = (error: ClerkFieldError | ClerkGlobalError | null | undefined) =>
  error?.longMessage || error?.message || undefined;

export const clerkErrorMessage = (
  error: {
    readonly code?: string;
    readonly longMessage?: string;
    readonly message?: string;
  } | null,
) => error?.longMessage || error?.message || undefined;

export const clerkErrorMessageFromUnknown = (cause: unknown) =>
  clerkErrorMessage(Schema.decodeUnknownOption(ClerkErrorCause)(cause).pipe(Option.getOrNull));

export const clerkFieldMessage = (
  fields: {
    readonly identifier?: ClerkFieldError | null;
    readonly emailAddress?: ClerkFieldError | null;
    readonly code?: ClerkFieldError | null;
  },
  name: "email" | "code",
) =>
  name === "code"
    ? messageOf(fields.code)
    : (messageOf(fields.identifier) ?? messageOf(fields.emailAddress));

export const clerkGlobalMessages = (
  global: ReadonlyArray<ClerkGlobalError> | null,
): ReadonlyArray<string> =>
  (global ?? []).flatMap((error) => {
    const message = messageOf(error);
    return message ? [message] : [];
  });

export const isIdentifierNotFound = (error: { readonly code?: string } | null) =>
  error?.code === "form_identifier_not_found";
