import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Layer from "effect/Layer";

export const TestCrypto = Layer.succeed(
  SecureRandom.SecureRandom,
  SecureRandom.make((size) => crypto.getRandomValues(new Uint8Array(size))),
);
