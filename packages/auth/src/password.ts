import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

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

type Password = Redacted.Redacted<string>;

export interface PasswordVerdict {
  readonly matches: boolean;
  readonly outdated: boolean;
}

const derive = (password: Password, salt: Uint8Array, iterations: number) =>
  pbkdf2Sha256({
    password: textEncoder.encode(Redacted.value(password)),
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

const verifyPassword = Effect.fn("PasswordHasher.verify")(function* (
  password: Password,
  encoded: PasswordHash,
) {
  const [algorithm, iterationText, saltText, hashText] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > WORKERD_PBKDF2_ITERATIONS ||
    !saltText ||
    !hashText
  ) {
    return { matches: false, outdated: false } satisfies PasswordVerdict;
  }
  const salt = yield* decodeSaltOrHash(saltText);
  const expected = yield* decodeSaltOrHash(hashText);
  const actual = yield* derive(password, salt, iterations);
  const matches = yield* constantTimeEqual(actual, expected).pipe(
    Effect.mapError((failure) => hashingFailed(failure.cause)),
  );
  return {
    matches,
    outdated: matches && iterations < WORKERD_PBKDF2_ITERATIONS,
  } satisfies PasswordVerdict;
});

export class PasswordHasher extends Context.Service<
  PasswordHasher,
  {
    readonly hash: (password: Password) => Effect.Effect<PasswordHash, PasswordHashError>;
    readonly verify: (
      password: Password,
      hash: PasswordHash,
    ) => Effect.Effect<PasswordVerdict, PasswordHashError>;
  }
>()("@store/auth/PasswordHasher") {
  static readonly layer = Layer.effect(
    PasswordHasher,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;

      const hash = Effect.fn("PasswordHasher.hash")(function* (password: Password) {
        const salt = yield* crypto.randomBytes(SALT_BYTES).pipe(Effect.mapError(hashingFailed));
        const derived = yield* derive(password, salt, WORKERD_PBKDF2_ITERATIONS);
        return PasswordHash.make(
          `pbkdf2-sha256$${WORKERD_PBKDF2_ITERATIONS}$${Base64Url.encode(salt)}$${Base64Url.encode(derived)}`,
        );
      });

      return PasswordHasher.of({ hash, verify: verifyPassword });
    }),
  ).pipe(Layer.provide(layer));
}
