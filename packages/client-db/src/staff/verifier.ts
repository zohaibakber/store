import { scrypt, timingSafeEqual } from "node:crypto";

import { ReplicaStorageError } from "@store/contracts/replica";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export const STAFF_KDF_COST = 2 ** 15;

const BLOCK_SIZE = 8;

const SALT_BYTES = 16;

const KEY_BYTES = 32;

const Verifier = Schema.fromJsonString(
  Schema.Struct({
    cost: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 2 ** 20 })),
    salt: Schema.Uint8ArrayFromBase64,
    key: Schema.Uint8ArrayFromBase64,
  }),
);

const encodeVerifier = Schema.encodeEffect(Verifier);

const decodeVerifier = Schema.decodeUnknownEffect(Verifier);

const derive = (secret: Redacted.Redacted<string>, salt: Uint8Array, cost: number) =>
  Effect.callback<Uint8Array>((resume) => {
    scrypt(
      Redacted.value(secret),
      salt,
      KEY_BYTES,
      { N: cost, r: BLOCK_SIZE, p: 1, maxmem: 256 * cost * BLOCK_SIZE },
      (error, key) => resume(error === null ? Effect.succeed(key) : Effect.die(error)),
    );
  });

export const sealSecret = Effect.fn("StaffVerifier.seal")(function* (
  secret: Redacted.Redacted<string>,
  cost: number,
) {
  const crypto = yield* Crypto.Crypto;
  const salt = yield* crypto.randomBytes(SALT_BYTES);
  const key = yield* derive(secret, salt, cost);
  return yield* encodeVerifier({ cost, salt, key });
}, Effect.orDie);

export const verifySecret = Effect.fn("StaffVerifier.verify")(
  function* (verifier: string, secret: Redacted.Redacted<string>) {
    const stored = yield* decodeVerifier(verifier);
    const key = yield* derive(secret, stored.salt, stored.cost);
    return key.length === stored.key.length && timingSafeEqual(key, stored.key);
  },
  Effect.mapError(() => new ReplicaStorageError({ message: "Staff verifier is unreadable." })),
);
