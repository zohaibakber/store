export type ClerkFieldError = {
  readonly message: string;
  readonly longMessage?: string;
  readonly code?: string;
};

export type ClerkErrorFields = {
  readonly identifier?: ClerkFieldError | null;
  readonly emailAddress?: ClerkFieldError | null;
  readonly password?: ClerkFieldError | null;
  readonly code?: ClerkFieldError | null;
};

export type ClerkGlobalError = {
  readonly message: string;
  readonly longMessage?: string;
  readonly code?: string;
};

export type ClerkFormErrors = {
  readonly email?: string;
  readonly password?: string;
  readonly code?: string;
};

const messageOf = (error: ClerkFieldError | ClerkGlobalError | null | undefined) =>
  error?.longMessage || error?.message || undefined;

export const clerkFormErrors = (fields: ClerkErrorFields): ClerkFormErrors => ({
  email: messageOf(fields.identifier) ?? messageOf(fields.emailAddress),
  password: messageOf(fields.password),
  code: messageOf(fields.code),
});

export const clerkGlobalMessages = (
  global: ReadonlyArray<ClerkGlobalError> | null,
): ReadonlyArray<string> =>
  (global ?? []).flatMap((error) => {
    const message = messageOf(error);
    return message ? [message] : [];
  });

type CompactClerkFormErrors = {
  email?: string;
  password?: string;
  code?: string;
};

export const compactFormErrors = (errors: ClerkFormErrors): ClerkFormErrors => {
  const next: CompactClerkFormErrors = {};
  if (errors.email) next.email = errors.email;
  if (errors.password) next.password = errors.password;
  if (errors.code) next.code = errors.code;
  return next;
};
