import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Password } from "./model";
import { constantTimeEqual, layer, pbkdf2Sha256 } from "./web-crypto";

const textEncoder = new TextEncoder();
const WORKERD_PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

export const PasswordHash = Schema.String.check(
  Schema.isPattern(/^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u),
).pipe(Schema.brand("PasswordHash"));
export type PasswordHash = typeof PasswordHash.Type;

export class PasswordHashError extends Schema.TaggedError<PasswordHashError>()(
  "Auth.PasswordHashError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const hashingFailed = (cause: unknown) =>
  new PasswordHashError({ message: `Password hashing failed: ${String(cause)}`, cause });

const derive = (password: Password, salt: Uint8Array, iterations: number) =>
  pbkdf2Sha256({
    password: textEncoder.encode(password),
    salt,
    iterations,
    bytes: HASH_BYTES,
  }).pipe(Effect.mapError((failure) => hashingFailed(failure.cause)));

const decodeSaltOrHash = (value: string) =>
  Effect.fromResult(Base64Url.decode(value)).pipe(
    Effect.mapError(
      (cause) =>
        new PasswordHashError({
          message: `Password hash encoding is invalid: ${cause.message}`,
          cause,
        }),
    ),
  );

const hashPassword = Effect.fn("Password.hash")(function* (password: Password) {
  const crypto = yield* Crypto.Crypto;
  const salt = yield* crypto.randomBytes(SALT_BYTES).pipe(Effect.mapError(hashingFailed));
  const hash = yield* derive(password, salt, WORKERD_PBKDF2_ITERATIONS);
  return PasswordHash.make(
    `pbkdf2-sha256$${WORKERD_PBKDF2_ITERATIONS}$${Base64Url.encode(salt)}$${Base64Url.encode(hash)}`,
  );
});

const verifyPassword = Effect.fn("Password.verify")(function* (
  password: Password,
  encoded: PasswordHash,
) {
  const [algorithm, iterationText, saltText, hashText] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < WORKERD_PBKDF2_ITERATIONS ||
    !saltText ||
    !hashText
  ) {
    return false;
  }
  const salt = yield* decodeSaltOrHash(saltText);
  const expected = yield* decodeSaltOrHash(hashText);
  const actual = yield* derive(password, salt, iterations);
  return yield* constantTimeEqual(actual, expected).pipe(
    Effect.mapError((failure) => hashingFailed(failure.cause)),
  );
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

export const passwordHasherLayer = Layer.effect(
  PasswordHasher,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    return PasswordHasher.of({
      hash: (password) => Effect.provideService(hashPassword(password), Crypto.Crypto, crypto),
      verify: verifyPassword,
    });
  }),
).pipe(Layer.provide(layer));
