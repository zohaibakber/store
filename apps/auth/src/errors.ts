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

export const authError = (status: number, code: string, message: string) =>
  new AuthError({ status, code, message });

export const infrastructureError = (cause: unknown) =>
  cause instanceof AuthError
    ? cause
    : authError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");

export const infrastructureLog = (cause: unknown) => {
  if (cause instanceof AuthError) return Effect.void;
  if (cause instanceof RepositoryError || cause instanceof EphemeralStoreError) {
    return Effect.logError("auth.infrastructure").pipe(
      Effect.annotateLogs({
        tag: cause._tag,
        operation: cause.operation,
        message: cause.message,
      }),
    );
  }
  if (cause instanceof EmailDeliveryError || cause instanceof PasswordHashError) {
    return Effect.logError("auth.infrastructure").pipe(
      Effect.annotateLogs({ tag: cause._tag, message: cause.message }),
    );
  }
  return Effect.logError("auth.infrastructure").pipe(
    Effect.annotateLogs({
      tag: cause instanceof Error ? cause.name : "Unknown",
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  );
};
