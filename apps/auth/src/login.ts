import {
  EmailAddress,
  EmailProvider,
  LoginRoute,
  normalizeEmail,
  OtpChallengeId,
  PasswordHasher,
  type IdentifyInput,
  type LoginCommand,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuthCrypto, OTP_TTL_MS } from "./crypto";
import { EphemeralStore } from "./ephemeral";
import { AccountExists, InvalidCredentials, InvalidEmail, InvalidOtp } from "./failures";
import { AuthLimiter } from "./limits";
import { AuthRepository } from "./repository";
import { Sessions } from "./session-ops";
import { AuthSettings } from "./settings";

export class Login extends Context.Service<Login>()("@store/auth-worker/Login", {
  make: Effect.gen(function* () {
    const repository = yield* AuthRepository;
    const ephemeral = yield* EphemeralStore;
    const passwords = yield* PasswordHasher;
    const email = yield* EmailProvider;
    const sessions = yield* Sessions;
    const limiter = yield* AuthLimiter;
    const crypto = yield* AuthCrypto;
    const { developmentOtp } = yield* AuthSettings;

    const identify = Effect.fn("Auth.Login.identify")(function* (input: IdentifyInput) {
      const now = yield* Clock.currentTimeMillis;
      const normalized = yield* Schema.decodeUnknownEffect(EmailAddress)(
        normalizeEmail(input.email),
      ).pipe(Effect.mapError(() => new InvalidEmail()));
      yield* limiter.admit("tenPerMinute", `identify:${normalized}`, "request");
      const user = yield* repository.findUserByEmail(normalized);
      if (!user) return LoginRoute.make({ _tag: "Registration", email: normalized });
      if (user.passwordHash) return LoginRoute.make({ _tag: "Password", email: normalized });
      if (!email.deliversOtp) {
        return LoginRoute.make({
          _tag: "Otp",
          email: normalized,
          challengeId: OtpChallengeId.make(yield* crypto.randomId),
        });
      }
      const code = yield* crypto.otpCode;
      const expiresAt = now + OTP_TTL_MS;
      const challengeId = yield* ephemeral.createOtp({
        email: normalized,
        code,
        expiresAt,
      });
      yield* email.sendOtp({ email: normalized, code, expiresAt });
      if (developmentOtp) {
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
          yield* limiter.admit("fivePerMinute", `password:${emailAddress}`, "request");
          const user = yield* repository.findUserByEmail(emailAddress);
          if (!user?.passwordHash) {
            return yield* new InvalidCredentials();
          }
          const verified = yield* passwords.verify(command.password, user.passwordHash);
          if (!verified) {
            return yield* new InvalidCredentials();
          }
          return yield* sessions.issueSession(user, command.client);
        }
        case "Otp": {
          yield* limiter.admit("fivePerMinute", `otp-attempt:${command.challengeId}`, "code");
          if (!email.deliversOtp) {
            return yield* new InvalidOtp();
          }
          const emailAddress = yield* ephemeral.consumeOtp({
            challengeId: command.challengeId,
            code: command.code,
            now,
          });
          if (!emailAddress) {
            return yield* new InvalidOtp();
          }
          const user = yield* repository.findUserByEmail(emailAddress);
          if (!user || user.passwordHash) {
            return yield* new InvalidOtp();
          }
          return yield* sessions.issueSession(user, command.client, `otp-${command.challengeId}`);
        }
        case "RegisterPassword": {
          const emailAddress = EmailAddress.make(normalizeEmail(command.email));
          yield* limiter.admit("fivePerMinute", `register:${emailAddress}`, "request");
          const existing = yield* repository.findUserByEmail(emailAddress);
          if (existing) {
            return yield* new AccountExists();
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
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
