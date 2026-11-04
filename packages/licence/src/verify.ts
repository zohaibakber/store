import { LicenceRefusal, type Licence } from "@store/contracts";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { LICENCE_PUBLIC_KEYS, type LicencePublicKey } from "./keys";
import { backupKeyHash, formatLicenceText, parseLicenceText } from "./text";

export type LicenceTrust = {
  readonly keys: ReadonlyArray<LicencePublicKey>;
  readonly packaged: boolean;
};

export type VerifiedLicence = {
  readonly licence: Licence;
  readonly text: string;
  readonly backupKey: Option.Option<Redacted.Redacted<Uint8Array>>;
};

export const shippedLicenceTrust = (packaged: boolean): LicenceTrust => ({
  keys: LICENCE_PUBLIC_KEYS,
  packaged,
});

const signedBy = Effect.fn("Licence.signedBy")(
  function* (key: LicencePublicKey, payload: Uint8Array, signature: Uint8Array) {
    const verifier = yield* Signature.Signature;
    const publicKey = yield* Signature.publicKey(
      Signature.ed25519,
      yield* Effect.fromResult(Base64Url.decode(key.publicKey)),
    );
    return yield* verifier.verify(publicKey, signature, payload);
  },
  Effect.orElseSucceed(() => false),
);

export const verifyLicenceText = Effect.fn("Licence.verify")(function* (
  text: string,
  trust: LicenceTrust,
) {
  const parsed = yield* Effect.fromResult(parseLicenceText(text));
  if (
    parsed.licence.backup !== null &&
    Option.isSome(parsed.backupKey) &&
    (yield* backupKeyHash(parsed.backupKey.value)) !== parsed.licence.backup.keyHash
  ) {
    return yield* new LicenceRefusal({ reason: "malformed" });
  }
  const named = trust.keys.filter(
    (candidate) =>
      candidate.id === parsed.licence.signingKeyId &&
      !(candidate.developmentOnly && trust.packaged),
  );
  if (named.length === 0) return yield* new LicenceRefusal({ reason: "unknownKey" });
  const signer = yield* Effect.findFirst(named, (key) =>
    signedBy(key, parsed.payload, parsed.signature),
  );
  if (Option.isNone(signer)) {
    return yield* new LicenceRefusal({ reason: "badSignature" });
  }
  return {
    licence: parsed.licence,
    text: formatLicenceText(parsed),
    backupKey: Option.map(parsed.backupKey, (bytes) => Redacted.make(bytes)),
  } satisfies VerifiedLicence;
});
