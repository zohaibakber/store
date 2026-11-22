import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Kdf from "effect/crypto/Kdf";
import * as Password from "effect/crypto/Password";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { layer as webCrypto } from "./web-crypto";

// workerd refuses PBKDF2 above 100k iterations, so it is both the cost new
// hashes use and the ceiling a stored hash may ask for.
const WORKERD_PBKDF2_ITERATIONS = 100_000;
const algorithm = Kdf.pbkdf2({ hash: Digest.sha256, iterations: WORKERD_PBKDF2_ITERATIONS });

// Hashes written before the move to PHC strings: `pbkdf2-sha256$<i>$<salt>$<hash>`
// in unpadded Base64Url. They still verify, and a match rehashes them as PHC.
const legacyPattern = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;
const phcPattern = /^\$pbkdf2-sha256\$i=\d+,l=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;

export const PasswordHash = Schema.String.check(
  Schema.isPattern(new RegExp(`${legacyPattern.source}|${phcPattern.source}`, "u")),
).pipe(Schema.brand("PasswordHash"));
export type PasswordHash = typeof PasswordHash.Type;

export class PasswordHashError extends Schema.TaggedError<PasswordHashError>()(
  "PasswordHashError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const failed = (cause: { readonly message: string }) =>
  new PasswordHashError({ message: `Password hashing failed: ${cause.message}`, cause });

export type PasswordVerdict = "mismatch" | "match" | "matchNeedsRehash";

/** The stored hash as a PHC string, or `undefined` when no hash this service wrote can look like it. */
const toPhc = (stored: PasswordHash): string | undefined => {
  const legacy = legacyPattern.exec(stored);
  if (legacy === null) return stored;
  const [, iterations, salt, hash] = legacy;
  const decodedSalt = Base64Url.decode(salt!);
  const decodedHash = Base64Url.decode(hash!);
  if (Result.isFailure(decodedSalt) || Result.isFailure(decodedHash)) return undefined;
  return Password.encode({
    algorithm: Kdf.pbkdf2({ hash: Digest.sha256, iterations: Number(iterations) }),
    salt: decodedSalt.success,
    hash: decodedHash.success,
  });
};

export class PasswordHasher extends Context.Service<
  PasswordHasher,
  {
    readonly hash: (
      password: Redacted.Redacted<string>,
    ) => Effect.Effect<PasswordHash, PasswordHashError>;
    readonly verify: (
      password: Redacted.Redacted<string>,
      hash: PasswordHash,
    ) => Effect.Effect<PasswordVerdict, PasswordHashError>;
  }
>()("@store/auth/PasswordHasher") {
  static readonly layer = Layer.effect(
    PasswordHasher,
    Effect.gen(function* () {
      const passwords = yield* Password.Password;

      const hash = Effect.fn("PasswordHasher.hash")(function* (
        password: Redacted.Redacted<string>,
      ) {
        return PasswordHash.make(yield* passwords.hash(password));
      }, Effect.mapError(failed));

      const verify = Effect.fn("PasswordHasher.verify")(function* (
        password: Redacted.Redacted<string>,
        stored: PasswordHash,
      ) {
        const phc = toPhc(stored);
        if (phc === undefined) return "mismatch" as const;
        const decoded = yield* Password.decode(phc);
        if (
          decoded.algorithm._tag !== "Pbkdf2" ||
          decoded.algorithm.iterations > WORKERD_PBKDF2_ITERATIONS
        ) {
          return "mismatch" as const;
        }
        if (!(yield* passwords.verify(password, phc))) return "mismatch" as const;
        return phc !== stored || (yield* passwords.needsRehash(phc))
          ? ("matchNeedsRehash" as const)
          : ("match" as const);
      }, Effect.mapError(failed));

      return PasswordHasher.of({ hash, verify });
    }),
  ).pipe(Layer.provide(Password.layer({ algorithm })), Layer.provide(webCrypto));
}
