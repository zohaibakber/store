import * as Digest from "effect/crypto/Digest";
import * as Kdf from "effect/crypto/Kdf";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Layer from "effect/Layer";

export const layer = Layer.mergeAll(
  Digest.layerWebCrypto,
  Kdf.layerWebCrypto,
  Mac.layerWebCrypto,
  Signature.layerWebCrypto,
).pipe(Layer.provideMerge(SecureRandom.layerWebCrypto));
