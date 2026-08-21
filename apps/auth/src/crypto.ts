import { OtpCode, SessionId } from "@store/auth";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { authError } from "./errors";

const textEncoder = new TextEncoder();

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const OTP_TTL_MS = 10 * 60 * 1_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const randomSecret = (bytes: number) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

export const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", textEncoder.encode(value)).then((buffer) => {
      let binary = "";
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
    }),
  );

export const safeEqual = (left: string, right: string) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export const generateOtp = () => {
  const maximum = 4_294_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while ((values[0] ?? 0) >= maximum);
  return OtpCode.make(String((values[0] ?? 0) % 1_000_000).padStart(6, "0"));
};

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
