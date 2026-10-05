import { createPrivateKey, generateKeyPairSync, hkdfSync, sign } from "node:crypto";

import {
  LICENCE_FORMAT,
  type Licence,
  type LicenceId,
  type ShopId,
  type ShopName,
} from "@store/contracts";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { LicencePublicKey } from "./keys";
import { BACKUP_KEY_BYTES, backupKeyHash, encodeLicencePayload, formatLicenceText } from "./text";

export const LicenceSigningKey = Schema.Struct({
  id: Schema.NonEmptyString,
  developmentOnly: Schema.Boolean,
  publicKey: Schema.NonEmptyString,
  privateKey: Schema.RedactedFromValue(Schema.NonEmptyString),
});
export type LicenceSigningKey = typeof LicenceSigningKey.Type;

export type LicenceGrant = {
  readonly id: LicenceId;
  readonly shopId: ShopId;
  readonly shopName: ShopName;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

export type LicenceBackupKey = {
  readonly keyVersion: number;
  readonly key: Uint8Array;
};

const OkpKeyPair = Schema.Struct({ x: Schema.NonEmptyString, d: Schema.NonEmptyString });
const decodeKeyPair = Schema.decodeUnknownSync(OkpKeyPair);

export const publicKeyOf = (key: LicenceSigningKey): LicencePublicKey => ({
  id: key.id,
  publicKey: key.publicKey,
  developmentOnly: key.developmentOnly,
});

export const generateSigningKey = (id: string, developmentOnly: boolean): LicenceSigningKey => {
  const pair = decodeKeyPair(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }));
  return { id, developmentOnly, publicKey: pair.x, privateKey: Redacted.make(pair.d) };
};

export const deriveBackupKey = (
  secret: Redacted.Redacted<Uint8Array>,
  shopId: ShopId,
  keyVersion: number,
): Uint8Array =>
  new Uint8Array(
    hkdfSync(
      "sha256",
      Redacted.value(secret),
      new TextEncoder().encode(shopId),
      new TextEncoder().encode(`tabaaq-backup-key:v${keyVersion}`),
      BACKUP_KEY_BYTES,
    ),
  );

export const signLicence = (
  grant: LicenceGrant,
  key: LicenceSigningKey,
  backup: Option.Option<LicenceBackupKey>,
): { readonly licence: Licence; readonly text: string } => {
  const licence: Licence = {
    format: LICENCE_FORMAT,
    ...grant,
    signingKeyId: key.id,
    backup: Option.match(backup, {
      onNone: () => null,
      onSome: (held) => ({ keyVersion: held.keyVersion, keyHash: backupKeyHash(held.key) }),
    }),
  };
  const payload = encodeLicencePayload(licence);
  const signature = sign(
    null,
    payload,
    createPrivateKey({
      key: { kty: "OKP", crv: "Ed25519", x: key.publicKey, d: Redacted.value(key.privateKey) },
      format: "jwk",
    }),
  );
  return {
    licence,
    text: formatLicenceText({
      payload,
      signature: new Uint8Array(signature),
      backupKey: Option.map(backup, (held) => held.key),
    }),
  };
};
