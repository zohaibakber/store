import { describe, expect, it } from "@effect/vitest";
import { LicenceId, ShopId, ShopName, type LicenceRefusalReason } from "@store/contracts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import { verifyLicenceText, type LicenceTrust } from "../src/index";
import {
  deriveBackupKey,
  generateSigningKey,
  publicKeyOf,
  signLicence,
  type LicenceGrant,
} from "../src/sign";

const production = generateSigningKey("test-production", false);
const development = generateSigningKey("test-development", true);
const stranger = generateSigningKey("test-production", false);

const trust = (packaged: boolean): LicenceTrust => ({
  keys: [publicKeyOf(production), publicKeyOf(development)],
  packaged,
});

const grant: LicenceGrant = {
  id: LicenceId.make("licence-1"),
  shopId: ShopId.make("shop-1"),
  shopName: ShopName.make("Test Pharmacy"),
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_831_536_000_000,
};

const backupKey = deriveBackupKey(Redacted.make(new Uint8Array(32).fill(7)), grant.shopId, 1);
const backup = Option.some({ keyVersion: 1, key: backupKey });

const reasonOf = (text: string, packaged = true): LicenceRefusalReason | "accepted" =>
  Result.match(verifyLicenceText(text, trust(packaged)), {
    onSuccess: () => "accepted",
    onFailure: (refusal) => refusal.reason,
  });

const withPart = (text: string, index: number, change: (part: string) => string) =>
  text
    .split(".")
    .map((part, at) => (at === index ? change(part) : part))
    .join(".");

const flipFirstByte = (part: string) => {
  const bytes = Result.getOrThrow(Base64Url.decode(part));
  return Base64Url.encode(bytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte)));
};

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const loosenLastCharacter = (part: string) => {
  const unused = part.length % 4 === 2 ? 4 : part.length % 4 === 3 ? 2 : 0;
  if (unused === 0) return `${part}A`;
  const last = BASE64URL.indexOf(part.at(-1)!);
  return `${part.slice(0, -1)}${BASE64URL[last ^ 1]}`;
};

const ED25519_GROUP_ORDER = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn;

const addGroupOrder = (part: string) => {
  const bytes = Result.getOrThrow(Base64Url.decode(part));
  let s = ED25519_GROUP_ORDER;
  for (let index = 63; index >= 32; index -= 1)
    s += BigInt(bytes[index]!) << BigInt(8 * (index - 32));
  return Base64Url.encode(
    bytes.map((byte, index) =>
      index < 32 ? byte : Number((s >> BigInt(8 * (index - 32))) & 0xffn),
    ),
  );
};

describe("licence text", () => {
  it("round-trips a signed licence with and without a backup key", () => {
    const plain = signLicence(grant, production, Option.none());
    const verified = Result.getOrThrow(verifyLicenceText(plain.text, trust(true)));
    expect(verified.licence).toEqual(plain.licence);
    expect(verified.licence.backup).toBeNull();
    expect(Option.isNone(verified.backupKey)).toBe(true);

    const backed = signLicence(grant, production, backup);
    const wrapped = `  ${backed.text.slice(0, 40)}\n${backed.text.slice(40)}\r\n`;
    const restored = Result.getOrThrow(verifyLicenceText(wrapped, trust(true)));
    expect(restored.text).toBe(backed.text);
    expect(restored.licence.backup?.keyVersion).toBe(1);
    expect(Option.map(restored.backupKey, Redacted.value)).toEqual(Option.some(backupKey));

    const rotated: LicenceTrust = {
      keys: [publicKeyOf(stranger), publicKeyOf(production)],
      packaged: true,
    };
    expect(Result.isSuccess(verifyLicenceText(plain.text, rotated))).toBe(true);
  });

  it("refuses a changed payload", () => {
    const { text } = signLicence(grant, production, Option.none());
    const later = signLicence(
      { ...grant, expiresAt: grant.expiresAt * 2 },
      stranger,
      Option.none(),
    );
    const swapped = withPart(text, 1, () => later.text.split(".")[1]!);
    expect(reasonOf(swapped)).toBe("badSignature");
  });

  it("refuses a changed signature and a signature by a key that only shares the id", () => {
    const { text } = signLicence(grant, production, Option.none());
    expect(reasonOf(withPart(text, 2, flipFirstByte))).toBe("badSignature");
    expect(reasonOf(signLicence(grant, stranger, Option.none()).text)).toBe("badSignature");
  });

  it("refuses a key id that is not in the list", () => {
    const unknown = generateSigningKey("never-shipped", false);
    expect(reasonOf(signLicence(grant, unknown, Option.none()).text)).toBe("unknownKey");
    for (const id of ["__proto__", "constructor", "toString", "0", "length"]) {
      const named = generateSigningKey(id, false);
      expect(reasonOf(signLicence(grant, named, Option.none()).text)).toBe("unknownKey");
    }
  });

  it("accepts a development key only when the app is not packaged", () => {
    const { text } = signLicence(grant, development, Option.none());
    expect(reasonOf(text, false)).toBe("accepted");
    expect(reasonOf(text, true)).toBe("unknownKey");
  });

  it("refuses a backup key that is missing, swapped or unexpected", () => {
    const backed = signLicence(grant, production, backup).text;
    const other = Base64Url.encode(new Uint8Array(32).fill(9));
    expect(reasonOf(withPart(backed, 3, () => other))).toBe("malformed");
    expect(reasonOf(backed.split(".").slice(0, 3).join("."))).toBe("malformed");
    const plain = signLicence(grant, production, Option.none()).text;
    expect(reasonOf(`${plain}.${other}`)).toBe("malformed");
  });

  it("refuses text that is not a licence", () => {
    const { text } = signLicence(grant, production, Option.none());
    expect(reasonOf("")).toBe("malformed");
    expect(reasonOf("tabaaq-licence-1")).toBe("malformed");
    expect(reasonOf(withPart(text, 0, () => "tabaaq-licence-2"))).toBe("malformed");
    expect(reasonOf(withPart(text, 1, () => Base64Url.encode("{}")))).toBe("malformed");
    expect(reasonOf(`${text}.a.b`)).toBe("malformed");
    expect(reasonOf(`${text}.`)).toBe("malformed");
    expect(reasonOf(`${text}.${text.split(".")[2]}`)).toBe("malformed");
    expect(reasonOf(`${"tabaaq-licence-1."}${"A".repeat(1_000_000)}`)).toBe("malformed");
  });

  it("refuses text whose parts are not the one canonical encoding of their bytes", () => {
    const backed = signLicence(grant, production, backup).text;
    for (const index of [1, 2, 3]) {
      expect(reasonOf(withPart(backed, index, (part) => `${part}=`))).toBe("malformed");
      expect(reasonOf(withPart(backed, index, loosenLastCharacter))).toBe("malformed");
    }
    expect(reasonOf(backed)).toBe("accepted");
  });

  it("refuses a signed payload that was re-encoded, extended or re-signed with a second S", () => {
    const { text } = signLicence(grant, production, Option.none());
    const json = new TextDecoder().decode(Result.getOrThrow(Base64Url.decode(text.split(".")[1]!)));
    const spaced = Base64Url.encode(json.replace(",", ", "));
    const later = Base64Url.encode(json.replace(/\}$/u, ',"expiresAt":9999999999999}'));
    expect(reasonOf(withPart(text, 1, () => spaced))).toBe("badSignature");
    expect(reasonOf(withPart(text, 1, () => later))).toBe("badSignature");
    expect(reasonOf(withPart(text, 2, addGroupOrder))).toBe("badSignature");
  });
});
