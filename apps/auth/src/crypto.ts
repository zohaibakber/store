import { OtpCode, WebCrypto, type OtpChallengeId } from "@store/auth";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthCryptoError } from "./errors";

const textEncoder = new TextEncoder();

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const OTP_TTL_MS = 10 * 60 * 1_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type Pepper = Redacted.Redacted<string>;
type Secret = Redacted.Redacted<string>;

const failed = (operation: string) =>
  Effect.mapError((cause: unknown) => new AuthCryptoError({ operation, cause }));

export class AuthCrypto extends Context.Service<AuthCrypto>()("@store/auth-worker/AuthCrypto", {
  make: Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;

    const sha256 = (value: string) =>
      crypto
        .digest("SHA-256", textEncoder.encode(value))
        .pipe(failed("sha256"), Effect.map(Base64Url.encode));

    const peppered = (pepper: Pepper, value: string) =>
      sha256(`${Redacted.value(pepper)}:${value}`);

    const randomToken = (bytes: number) =>
      crypto.randomBytes(bytes).pipe(failed("randomBytes"), Effect.map(Base64Url.encode));

    return {
      randomId: crypto.randomUUIDv4.pipe(failed("randomId")),
      randomToken,
      randomSecret: (bytes: number) => Effect.map(randomToken(bytes), Redacted.make),
      otpCode: crypto
        .randomIntBetween(0, 1_000_000, { halfOpen: true })
        .pipe(Effect.map((value) => OtpCode.make(String(value).padStart(6, "0")))),
      pkceChallenge: sha256,
      refreshHash: (pepper: Pepper, secret: Secret) => peppered(pepper, Redacted.value(secret)),
      invitationHash: (pepper: Pepper, secret: Secret) =>
        peppered(pepper, `invite:${Redacted.value(secret)}`),
      recordKey: (pepper: Pepper, kind: string, id: string) => peppered(pepper, `${kind}:${id}`),
      otpVerifier: (pepper: Pepper, challengeId: OtpChallengeId, code: OtpCode) =>
        WebCrypto.hmacSha256(
          textEncoder.encode(Redacted.value(pepper)),
          textEncoder.encode(`otp:${challengeId}:${code}`),
        ).pipe(failed("otpVerifier"), Effect.map(Base64Url.encode)),
      matches: (left: string, right: string) =>
        WebCrypto.constantTimeEqual(textEncoder.encode(left), textEncoder.encode(right)).pipe(
          failed("matches"),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(WebCrypto.layer));
}
