import type { EmailDeliveryError, JwtError, PasswordHashError } from "@store/auth";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { SqlError } from "effect/unstable/sql/SqlError";

import type { EphemeralStoreError } from "./ephemeral";
import { AuthRefusal, type AuthFailure } from "./failures";
import type { GoogleOAuthError } from "./google";
import type { RepositoryError } from "./repository";

export class AuthCryptoError extends Schema.TaggedError<AuthCryptoError>()("Auth.CryptoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const label = (cause: unknown): string => {
  if (Predicate.hasProperty(cause, "_tag") && Predicate.isString(cause._tag)) {
    return Predicate.hasProperty(cause, "reason") &&
      Predicate.hasProperty(cause.reason, "_tag") &&
      Predicate.isString(cause.reason._tag)
      ? `${cause._tag}:${cause.reason._tag}`
      : cause._tag;
  }
  return cause instanceof Error ? cause.name : "Unknown";
};

const frames = (cause: unknown) =>
  cause instanceof Error && cause.stack !== undefined
    ? cause.stack
        .split("\n")
        .filter((line) => line.trimStart().startsWith("at "))
        .slice(0, 8)
        .join("\n")
    : "";

export const causeDiagnostics = (cause: Cause.Cause<unknown>) => ({
  reasons: cause.reasons
    .map((reason) =>
      Cause.isFailReason(reason)
        ? `Fail(${label(reason.error)})`
        : Cause.isDieReason(reason)
          ? `Die(${label(reason.defect)})`
          : "Interrupt",
    )
    .join(", "),
  stack: cause.reasons
    .map((reason) =>
      Cause.isFailReason(reason)
        ? frames(reason.error)
        : Cause.isDieReason(reason)
          ? frames(reason.defect)
          : "",
    )
    .find((stack) => stack.length > 0),
});

export const storageFailureMessage = (cause: unknown): string => {
  if (cause instanceof EffectDrizzleQueryError) {
    return `${storageFailureMessage(cause.cause)} in ${cause.query}`;
  }
  if (Predicate.isString(cause)) return cause;
  return cause instanceof SqlError ? `${label(cause)}: ${cause.message}` : label(cause);
};

export type InfrastructureFailure =
  | RepositoryError
  | EphemeralStoreError
  | AuthCryptoError
  | EmailDeliveryError
  | PasswordHashError
  | GoogleOAuthError
  | JwtError;

const infrastructureDiagnostics = (failure: InfrastructureFailure) => {
  switch (failure._tag) {
    case "Auth.RepositoryError":
    case "Auth.EphemeralStoreError":
      return { tag: failure._tag, operation: failure.operation, message: failure.message };
    case "Auth.CryptoError":
      return { tag: failure._tag, operation: failure.operation, message: String(failure.cause) };
    case "Auth.EmailDeliveryError":
    case "Auth.PasswordHashError":
    case "Auth.GoogleOAuthError":
    case "Auth.JwtError":
      return { tag: failure._tag, message: failure.message };
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
};

const INFRASTRUCTURE_TAGS = [
  "Auth.RepositoryError",
  "Auth.EphemeralStoreError",
  "Auth.CryptoError",
  "Auth.EmailDeliveryError",
  "Auth.PasswordHashError",
  "Auth.GoogleOAuthError",
  "Auth.JwtError",
] as const;

export const unavailableOnInfrastructureFailure = <A, R>(
  effect: Effect.Effect<A, AuthFailure | InfrastructureFailure, R>,
): Effect.Effect<A, AuthFailure, R> =>
  Effect.catchTag(effect, INFRASTRUCTURE_TAGS, (failure) =>
    Effect.logError("auth.infrastructure").pipe(
      Effect.annotateLogs(infrastructureDiagnostics(failure)),
      Effect.andThen(Effect.fail(new AuthRefusal({ reason: "Unavailable" }))),
    ),
  );
