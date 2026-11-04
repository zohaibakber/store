import {
  LICENCE_FORMAT,
  type Licence,
  type LicenceId,
  type ShopId,
  type ShopName,
} from "@store/contracts";
import * as Kdf from "effect/crypto/Kdf";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
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

export const publicKeyOf = (key: LicenceSigningKey): LicencePublicKey => ({
  id: key.id,
  publicKey: key.publicKey,
  developmentOnly: key.developmentOnly,
});

export const generateSigningKey = Effect.fn("LicenceSigningKey.generate")(function* (
  id: string,
  developmentOnly: boolean,
) {
  const signature = yield* Signature.Signature;
  const pair = yield* signature.generateKeyPair(Signature.ed25519);
  return {
    id,
    developmentOnly,
    publicKey: Base64Url.encode(yield* Signature.toBytes(pair.publicKey)),
    privateKey: Redacted.make(Base64Url.encode(yield* Signature.toBytes(pair.privateKey))),
  } satisfies LicenceSigningKey;
}, Effect.orDie);

export const deriveBackupKey = Effect.fn("LicenceBackupKey.derive")(function* (
  secret: Redacted.Redacted<Uint8Array>,
  shopId: ShopId,
  keyVersion: number,
) {
  const kdf = yield* Kdf.Kdf;
  const encoder = new TextEncoder();
  return yield* kdf.derive(Kdf.hkdfSha256, Redacted.value(secret), {
    salt: encoder.encode(shopId),
    info: encoder.encode(`tabaaq-backup-key:v${keyVersion}`),
    length: BACKUP_KEY_BYTES,
  });
}, Effect.orDie);

export const signLicence = Effect.fn("Licence.sign")(function* (
  grant: LicenceGrant,
  key: LicenceSigningKey,
  backup: Option.Option<LicenceBackupKey>,
) {
  const signature = yield* Signature.Signature;
  const licence: Licence = {
    format: LICENCE_FORMAT,
    ...grant,
    signingKeyId: key.id,
    backup: Option.isSome(backup)
      ? {
          keyVersion: backup.value.keyVersion,
          keyHash: yield* backupKeyHash(backup.value.key),
        }
      : null,
  };
  const payload = encodeLicencePayload(licence);
  const privateKey = yield* Signature.privateKey(
    Signature.ed25519,
    yield* Effect.fromResult(Base64Url.decode(Redacted.value(key.privateKey))),
  );
  return {
    licence,
    text: formatLicenceText({
      payload,
      signature: yield* signature.sign(privateKey, payload),
      backupKey: Option.map(backup, (held) => held.key),
    }),
  };
}, Effect.orDie);
