import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Password } from "./model";

const textEncoder = new TextEncoder();
/**
 * workerd rejects PBKDF2 above 100,000 iterations. The verifier also refuses
 * counts below that, so this is the only value that both hashes and verifies
 * on Cloudflare Workers.
 */
const ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const PasswordHash = Schema.String.check(
  Schema.isPattern(/^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u),
).pipe(Schema.brand("PasswordHash"));
export type PasswordHash = typeof PasswordHash.Type;

export class PasswordHashError extends Schema.TaggedError<PasswordHashError>()(
  "Auth.PasswordHashError",
  {
    message: Schema.String,
  },
) {}

const derive = (password: Password, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
  Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      return new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            hash: "SHA-256",
            salt,
            iterations,
          },
          key,
          HASH_BYTES * 8,
        ),
      );
    },
    catch: (cause) =>
      new PasswordHashError({
        message: `Password hashing failed: ${String(cause)}`,
      }),
  });

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

export const hashPassword = Effect.fn("Password.hash")(function* (password: Password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = yield* derive(password, salt, ITERATIONS);
  return PasswordHash.make(
    `pbkdf2-sha256$${ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`,
  );
});

export const verifyPassword = Effect.fn("Password.verify")(function* (
  password: Password,
  encoded: PasswordHash,
) {
  const [algorithm, iterationText, saltText, hashText] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !hashText
  ) {
    return false;
  }
  const actual = yield* derive(password, base64UrlDecode(saltText), iterations);
  return constantTimeEqual(actual, base64UrlDecode(hashText));
});

export interface PasswordHasherApi {
  readonly hash: (password: Password) => Effect.Effect<PasswordHash, PasswordHashError>;
  readonly verify: (
    password: Password,
    hash: PasswordHash,
  ) => Effect.Effect<boolean, PasswordHashError>;
}

export class PasswordHasher extends Context.Service<PasswordHasher, PasswordHasherApi>()(
  "@store/auth/PasswordHasher",
) {}

export const passwordHasherLayer = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of({
    hash: hashPassword,
    verify: verifyPassword,
  }),
);
