import { OtpCode, SessionId } from "@store/auth";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { AuthCryptoError, authError } from "./errors";

const textEncoder = new TextEncoder();

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const OTP_TTL_MS = 10 * 60 * 1_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const platformCrypto = Crypto.make({
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
  digest: (algorithm, data) =>
    Effect.tryPromise({
      try: () => {
        // SAFETY: copy onto a fresh ArrayBuffer so SubtleCrypto sees BufferSource.
        const source = new Uint8Array(data);
        return crypto.subtle.digest(algorithm, source).then((buffer) => new Uint8Array(buffer));
      },
      catch: (cause) =>
        PlatformError.badArgument({
          module: "Crypto",
          method: "digest",
          description: String(cause),
          cause,
        }),
    }),
});

export const randomSecret = (bytes: number) =>
  Effect.runSync(
    platformCrypto.randomBytes(bytes).pipe(
      Effect.map(Encoding.encodeBase64Url),
      Effect.orDie,
    ),
  );

export const sha256 = (value: string) =>
  platformCrypto.digest("SHA-256", textEncoder.encode(value)).pipe(
    Effect.mapError((cause) => new AuthCryptoError({ operation: "sha256", cause })),
    Effect.map(Encoding.encodeBase64Url),
  );

export const hashRefreshSecret = (pepper: string, secret: string) => sha256(`${pepper}:${secret}`);

export const hashInvitationSecret = (pepper: string, secret: string) =>
  sha256(`${pepper}:invite:${secret}`);

export const safeEqual = (left: string, right: string) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export const generateOtp = () =>
  Effect.runSync(
    platformCrypto
      .randomIntBetween(0, 1_000_000, { halfOpen: true })
      .pipe(Effect.map((value) => OtpCode.make(String(value).padStart(6, "0")))),
  );

export const parseRefreshToken = (token: string) =>
  Effect.gen(function* () {
    const separator = token.indexOf(".");
    if (separator <= 0 || separator === token.length - 1) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(token.slice(0, separator)).pipe(
      Effect.mapError(() => authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.")),
    );
    return { sessionId, secret: token.slice(separator + 1) };
  });
