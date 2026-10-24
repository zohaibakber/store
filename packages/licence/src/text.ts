import { createHash } from "node:crypto";

import { Licence, LicenceRefusal, MAX_LICENCE_TEXT_LENGTH } from "@store/contracts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export const LICENCE_TEXT_PREFIX = "tabaaq-licence-1";

export const BACKUP_KEY_BYTES = 32;

const SIGNATURE_BYTES = 64;
const SEPARATOR = ".";

const LicenceJson = Schema.fromJsonString(Licence);
const decodeLicenceJson = Schema.decodeUnknownResult(LicenceJson);
const encodeLicenceJson = Schema.encodeSync(LicenceJson);

export type LicenceText = {
  readonly licence: Licence;
  readonly payload: Uint8Array;
  readonly signature: Uint8Array;
  readonly backupKey: Option.Option<Uint8Array>;
};

const malformed = () => new LicenceRefusal({ reason: "malformed" });

const decodeCanonical = (encoded: string): Option.Option<Uint8Array> =>
  Option.filter(
    Result.getSuccess(Base64Url.decode(encoded)),
    (bytes) => Base64Url.encode(bytes) === encoded,
  );

export const backupKeyHash = (key: Uint8Array) =>
  Hex.encode(createHash("sha256").update(key).digest());

export const encodeLicencePayload = (licence: Licence) =>
  new TextEncoder().encode(encodeLicenceJson(licence));

export const formatLicenceText = (parts: Omit<LicenceText, "licence">) =>
  [
    LICENCE_TEXT_PREFIX,
    Base64Url.encode(parts.payload),
    Base64Url.encode(parts.signature),
    ...Option.match(parts.backupKey, {
      onNone: () => [],
      onSome: (key) => [Base64Url.encode(key)],
    }),
  ].join(SEPARATOR);

export const normalizeLicenceText = (text: string) => text.replaceAll(/\s+/gu, "");

const backupKeyOf = (
  licence: Licence,
  encoded: string | undefined,
): Result.Result<Option.Option<Uint8Array>, LicenceRefusal> => {
  if (licence.backup === null) {
    return encoded === undefined ? Result.succeed(Option.none()) : Result.fail(malformed());
  }
  if (encoded === undefined) return Result.fail(malformed());
  const key = decodeCanonical(encoded);
  if (
    Option.isNone(key) ||
    key.value.length !== BACKUP_KEY_BYTES ||
    backupKeyHash(key.value) !== licence.backup.keyHash
  ) {
    return Result.fail(malformed());
  }
  return Result.succeed(key);
};

export const parseLicenceText = (text: string): Result.Result<LicenceText, LicenceRefusal> => {
  const normalized = normalizeLicenceText(text);
  if (normalized.length > MAX_LICENCE_TEXT_LENGTH) return Result.fail(malformed());
  const [prefix, encodedPayload, encodedSignature, encodedBackupKey, ...extra] =
    normalized.split(SEPARATOR);
  if (
    prefix !== LICENCE_TEXT_PREFIX ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    extra.length > 0
  ) {
    return Result.fail(malformed());
  }
  const payload = decodeCanonical(encodedPayload);
  const signature = decodeCanonical(encodedSignature);
  if (
    Option.isNone(payload) ||
    Option.isNone(signature) ||
    signature.value.length !== SIGNATURE_BYTES
  ) {
    return Result.fail(malformed());
  }
  const licence = decodeLicenceJson(new TextDecoder().decode(payload.value));
  if (Result.isFailure(licence)) return Result.fail(malformed());
  return Result.map(backupKeyOf(licence.success, encodedBackupKey), (backupKey) => ({
    licence: licence.success,
    payload: payload.value,
    signature: signature.value,
    backupKey,
  }));
};
