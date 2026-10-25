import { createPublicKey, verify } from "node:crypto";

import { LicenceRefusal, type Licence } from "@store/contracts";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import { LICENCE_PUBLIC_KEYS, type LicencePublicKey } from "./keys";
import { formatLicenceText, parseLicenceText } from "./text";

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

const signedBy = (key: LicencePublicKey, payload: Uint8Array, signature: Uint8Array) =>
  Result.try(() =>
    verify(
      null,
      payload,
      createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.publicKey }, format: "jwk" }),
      signature,
    ),
  ).pipe(Result.getOrElse(() => false));

export const verifyLicenceText = (
  text: string,
  trust: LicenceTrust,
): Result.Result<VerifiedLicence, LicenceRefusal> =>
  Result.flatMap(parseLicenceText(text), (parsed) => {
    const named = trust.keys.filter(
      (candidate) =>
        candidate.id === parsed.licence.signingKeyId &&
        !(candidate.developmentOnly && trust.packaged),
    );
    if (named.length === 0) return Result.fail(new LicenceRefusal({ reason: "unknownKey" }));
    if (!named.some((key) => signedBy(key, parsed.payload, parsed.signature))) {
      return Result.fail(new LicenceRefusal({ reason: "badSignature" }));
    }
    return Result.succeed({
      licence: parsed.licence,
      text: formatLicenceText(parsed),
      backupKey: Option.map(parsed.backupKey, (bytes) => Redacted.make(bytes)),
    });
  });
