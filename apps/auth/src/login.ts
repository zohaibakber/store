import {
  EmailAddress,
  LoginRoute,
  normalizeEmail,
  type EmailProviderApi,
  type IdentifyInput,
  type LoginCommand,
  type PasswordHasherApi,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { generateOtp, OTP_TTL_MS } from "./crypto";
import type { EphemeralStoreApi } from "./ephemeral";
import { authError } from "./errors";
import { enforceAuthLimit, type AuthLimits } from "./limits";
import type { AuthRepositoryApi } from "./repository";
import type { SessionOps } from "./session-ops";

export interface LoginOpsConfiguration {
  readonly developmentOtp: boolean;
}

export const makeLoginOps = (
  repository: AuthRepositoryApi,
  ephemeral: EphemeralStoreApi,
  passwords: PasswordHasherApi,
  email: EmailProviderApi,
  sessions: Pick<SessionOps, "issueSession">,
  configuration: LoginOpsConfiguration,
  limits: AuthLimits,
) => {
  const identify = Effect.fn("Auth.Login.identify")(function* (input: IdentifyInput) {
    const now = yield* Clock.currentTimeMillis;
    const normalized = yield* Schema.decodeUnknownEffect(EmailAddress)(
      normalizeEmail(input.email),
    ).pipe(Effect.mapError(() => authError(400, "INVALID_EMAIL", "Enter a valid email.")));
    yield* enforceAuthLimit(
      limits.tenPerMinute,
      `identify:${normalized}`,
      "Wait before trying again.",
    );
    const user = yield* repository.findUserByEmail(normalized);
    if (!user) return LoginRoute.make({ _tag: "Registration", email: normalized });
    if (user.passwordHash) return LoginRoute.make({ _tag: "Password", email: normalized });
    const code = generateOtp();
    const expiresAt = now + OTP_TTL_MS;
    const challengeId = yield* ephemeral.createOtp({
      email: normalized,
      code,
      expiresAt,
    });
    yield* email.sendOtp({ email: normalized, code, expiresAt });
    if (configuration.developmentOtp) {
      return LoginRoute.make({
        _tag: "Otp",
        email: normalized,
        challengeId,
        developmentCode: code,
      });
    }
    return LoginRoute.make({ _tag: "Otp", email: normalized, challengeId });
  });

  const authenticate = Effect.fn("Auth.Login.authenticate")(function* (command: LoginCommand) {
    const now = yield* Clock.currentTimeMillis;
    switch (command._tag) {
      case "Password": {
        const emailAddress = EmailAddress.make(normalizeEmail(command.email));
        yield* enforceAuthLimit(
          limits.fivePerMinute,
          `password:${emailAddress}`,
          "Wait before trying again.",
        );
        const user = yield* repository.findUserByEmail(emailAddress);
        if (!user?.passwordHash) {
          return yield* authError(
            401,
            "INVALID_CREDENTIALS",
            "The email or password is incorrect.",
          );
        }
        const verified = yield* passwords.verify(command.password, user.passwordHash);
        if (!verified) {
          return yield* authError(
            401,
            "INVALID_CREDENTIALS",
            "The email or password is incorrect.",
          );
        }
        return yield* sessions.issueSession(user, command.client);
      }
      case "Otp": {
        yield* enforceAuthLimit(
          limits.fivePerMinute,
          `otp-attempt:${command.challengeId}`,
          "Wait before trying another code.",
        );
        const emailAddress = yield* ephemeral.consumeOtp({
          challengeId: command.challengeId,
          code: command.code,
          now,
        });
        if (!emailAddress) {
          return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
        }
        const user = yield* repository.findUserByEmail(emailAddress);
        if (!user || user.passwordHash) {
          return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
        }
        return yield* sessions.issueSession(user, command.client, `otp-${command.challengeId}`);
      }
      case "RegisterPassword": {
        const emailAddress = EmailAddress.make(normalizeEmail(command.email));
        yield* enforceAuthLimit(
          limits.fivePerMinute,
          `register:${emailAddress}`,
          "Wait before trying again.",
        );
        const existing = yield* repository.findUserByEmail(emailAddress);
        if (existing) {
          return yield* authError(
            409,
            "ACCOUNT_EXISTS",
            "An account already exists for this email.",
          );
        }
        const passwordHash = yield* passwords.hash(command.password);
        const user = yield* repository.createPasswordUser({
          email: emailAddress,
          name: command.name,
          passwordHash,
        });
        return yield* sessions.issueSession(user, command.client);
      }
      default: {
        const _exhaustive: never = command;
        return _exhaustive;
      }
    }
  });

  return { identify, authenticate };
};

export type LoginOps = ReturnType<typeof makeLoginOps>;
