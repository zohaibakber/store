import { OtpCode, WebCrypto, type OtpChallengeId } from "@store/auth";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthCryptoError } from "./errors";

const textEncoder = new TextEncoder();

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

    const randomToken = Effect.fn("AuthCrypto.randomToken")((bytes: number) =>
      crypto.randomBytes(bytes).pipe(failed("randomBytes"), Effect.map(Base64Url.encode)),
    );

    return {
      randomId: crypto
        .randomUUIDv4()
        .pipe(failed("randomId"), Effect.withSpan("AuthCrypto.randomId")),
      randomToken,
      randomSecret: Effect.fn("AuthCrypto.randomSecret")((bytes: number) =>
        Effect.map(randomToken(bytes), Redacted.make),
      ),
      otpCode: crypto.randomIntBetween(0, 1_000_000, { halfOpen: true }).pipe(
        Effect.map((value) => OtpCode.make(String(value).padStart(6, "0"))),
        Effect.withSpan("AuthCrypto.otpCode"),
      ),
      pkceChallenge: Effect.fn("AuthCrypto.pkceChallenge")((verifier: string) => sha256(verifier)),
      refreshHash: Effect.fn("AuthCrypto.refreshHash")((secret: Secret) =>
        sha256(`refresh:${Redacted.value(secret)}`),
      ),
      invitationHash: Effect.fn("AuthCrypto.invitationHash")((secret: Secret) =>
        sha256(`invite:${Redacted.value(secret)}`),
      ),
      recordKey: Effect.fn("AuthCrypto.recordKey")((pepper: Pepper, kind: string, id: string) =>
        peppered(pepper, `${kind}:${id}`),
      ),
      otpVerifier: Effect.fn("AuthCrypto.otpVerifier")(
        (pepper: Pepper, challengeId: OtpChallengeId, code: OtpCode) =>
          WebCrypto.hmacSha256(
            textEncoder.encode(Redacted.value(pepper)),
            textEncoder.encode(`otp:${challengeId}:${code}`),
          ).pipe(failed("otpVerifier"), Effect.map(Base64Url.encode)),
      ),
      matches: Effect.fn("AuthCrypto.matches")((left: string, right: string) =>
        WebCrypto.constantTimeEqual(textEncoder.encode(left), textEncoder.encode(right)).pipe(
          failed("matches"),
        ),
      ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(WebCrypto.layer));
}
