import { EmailDeliveryError, PasswordHashError } from "@store/auth";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EphemeralStoreError } from "./ephemeral";
import { RepositoryError } from "./repository";

export class AuthError extends Schema.TaggedError<AuthError>()("Auth.AuthError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {}

export class AuthCryptoError extends Schema.TaggedError<AuthCryptoError>()("Auth.CryptoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export const authError = (status: number, code: string, message: string) =>
  new AuthError({ status, code, message });

export const infrastructureError = (cause: unknown) =>
  cause instanceof AuthError
    ? cause
    : authError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");

const annotateInfrastructure = (fields: Record<string, string>) =>
  Effect.logError("auth.infrastructure").pipe(Effect.annotateLogs(fields));

export const infrastructureLog = (cause: unknown) => {
  if (cause instanceof AuthError) return Effect.void;
  if (cause instanceof RepositoryError || cause instanceof EphemeralStoreError) {
    return annotateInfrastructure({
      tag: cause._tag,
      operation: cause.operation,
      message: cause.message,
    });
  }
  if (cause instanceof AuthCryptoError) {
    return annotateInfrastructure({
      tag: cause._tag,
      operation: cause.operation,
      message: String(cause.cause),
    });
  }
  if (cause instanceof EmailDeliveryError || cause instanceof PasswordHashError) {
    return annotateInfrastructure({ tag: cause._tag, message: cause.message });
  }
  return annotateInfrastructure({
    tag: cause instanceof Error ? cause.name : "Unknown",
    message: cause instanceof Error ? cause.message : String(cause),
  });
};
