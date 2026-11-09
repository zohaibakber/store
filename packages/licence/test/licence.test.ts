import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { layer } from "@effect/vitest";
import { LicenceId, ShopId, ShopName, type LicenceRefusalReason } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { expect } from "vite-plus/test";

import { verifyLicenceText, type LicenceTrust } from "../src/index";
import {
  deriveBackupKey,
  generateSigningKey,
  publicKeyOf,
  signLicence,
  type LicenceGrant,
} from "../src/sign";

const grant: LicenceGrant = {
  id: LicenceId.make("licence-1"),
  shopId: ShopId.make("shop-1"),
  shopName: ShopName.make("Test Pharmacy"),
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_831_536_000_000,
};

const fixture = Effect.gen(function* () {
  const production = yield* generateSigningKey("test-production", false);
  const development = yield* generateSigningKey("test-development", true);
  const stranger = yield* generateSigningKey("test-production", false);
  const backupKey = yield* deriveBackupKey(
    Redacted.make(new Uint8Array(32).fill(7)),
    grant.shopId,
    1,
  );
  const trust = (packaged: boolean): LicenceTrust => ({
    keys: [publicKeyOf(production), publicKeyOf(development)],
    packaged,
  });
  const reasonOf = (text: string, packaged = true) =>
    Effect.map(
      Effect.result(verifyLicenceText(text, trust(packaged))),
      (result): LicenceRefusalReason | "accepted" =>
        Result.match(result, {
          onSuccess: () => "accepted",
          onFailure: (refusal) => refusal.reason,
        }),
    );
  return {
    production,
    development,
    stranger,
    backupKey,
    backup: Option.some({ keyVersion: 1, key: backupKey }),
    trust,
    reasonOf,
  };
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

layer(NodeCrypto.layer)("licence text", (it) => {
  it.effect("round-trips a signed licence with and without a backup key", () =>
    Effect.gen(function* () {
      const { production, stranger, backupKey, backup, trust } = yield* fixture;
      const plain = yield* signLicence(grant, production, Option.none());
      const verified = yield* verifyLicenceText(plain.text, trust(true));
      expect(verified.licence).toEqual(plain.licence);
      expect(verified.licence.backup).toBeNull();
      expect(Option.isNone(verified.backupKey)).toBe(true);

      const backed = yield* signLicence(grant, production, backup);
      const wrapped = `  ${backed.text.slice(0, 40)}\n${backed.text.slice(40)}\r\n`;
      const restored = yield* verifyLicenceText(wrapped, trust(true));
      expect(restored.text).toBe(backed.text);
      expect(restored.licence.backup?.keyVersion).toBe(1);
      expect(Option.map(restored.backupKey, Redacted.value)).toEqual(Option.some(backupKey));

      const rotated: LicenceTrust = {
        keys: [publicKeyOf(stranger), publicKeyOf(production)],
        packaged: true,
      };
      expect(Result.isSuccess(yield* Effect.result(verifyLicenceText(plain.text, rotated)))).toBe(
        true,
      );
    }),
  );

  it.effect("refuses a changed payload", () =>
    Effect.gen(function* () {
      const { production, stranger, reasonOf } = yield* fixture;
      const { text } = yield* signLicence(grant, production, Option.none());
      const later = yield* signLicence(
        { ...grant, expiresAt: grant.expiresAt * 2 },
        stranger,
        Option.none(),
      );
      const swapped = withPart(text, 1, () => later.text.split(".")[1]!);
      expect(yield* reasonOf(swapped)).toBe("badSignature");
    }),
  );

  it.effect("refuses a changed signature and a signature by a key that only shares the id", () =>
    Effect.gen(function* () {
      const { production, stranger, reasonOf } = yield* fixture;
      const { text } = yield* signLicence(grant, production, Option.none());
      expect(yield* reasonOf(withPart(text, 2, flipFirstByte))).toBe("badSignature");
      expect(yield* reasonOf((yield* signLicence(grant, stranger, Option.none())).text)).toBe(
        "badSignature",
      );
    }),
  );

  it.effect("refuses a key id that is not in the list", () =>
    Effect.gen(function* () {
      const { reasonOf } = yield* fixture;
      for (const id of ["never-shipped", "__proto__", "constructor", "toString", "0", "length"]) {
        const named = yield* generateSigningKey(id, false);
        const { text } = yield* signLicence(grant, named, Option.none());
        expect(yield* reasonOf(text)).toBe("unknownKey");
      }
    }),
  );

  it.effect("accepts a development key only when the app is not packaged", () =>
    Effect.gen(function* () {
      const { development, reasonOf } = yield* fixture;
      const { text } = yield* signLicence(grant, development, Option.none());
      expect(yield* reasonOf(text, false)).toBe("accepted");
      expect(yield* reasonOf(text, true)).toBe("unknownKey");
    }),
  );

  it.effect("refuses a backup key that is missing, swapped or unexpected", () =>
    Effect.gen(function* () {
      const { production, backup, reasonOf } = yield* fixture;
      const backed = (yield* signLicence(grant, production, backup)).text;
      const other = Base64Url.encode(new Uint8Array(32).fill(9));
      expect(yield* reasonOf(withPart(backed, 3, () => other))).toBe("malformed");
      expect(yield* reasonOf(backed.split(".").slice(0, 3).join("."))).toBe("malformed");
      const plain = (yield* signLicence(grant, production, Option.none())).text;
      expect(yield* reasonOf(`${plain}.${other}`)).toBe("malformed");
    }),
  );

  it.effect("refuses text that is not a licence", () =>
    Effect.gen(function* () {
      const { production, reasonOf } = yield* fixture;
      const { text } = yield* signLicence(grant, production, Option.none());
      expect(yield* reasonOf("")).toBe("malformed");
      expect(yield* reasonOf("tabaaq-licence-1")).toBe("malformed");
      expect(yield* reasonOf(withPart(text, 0, () => "tabaaq-licence-2"))).toBe("malformed");
      expect(yield* reasonOf(withPart(text, 1, () => Base64Url.encode("{}")))).toBe("malformed");
      expect(yield* reasonOf(`${text}.a.b`)).toBe("malformed");
      expect(yield* reasonOf(`${text}.`)).toBe("malformed");
      expect(yield* reasonOf(`${text}.${text.split(".")[2]}`)).toBe("malformed");
      expect(yield* reasonOf(`${"tabaaq-licence-1."}${"A".repeat(1_000_000)}`)).toBe("malformed");
    }),
  );

  it.effect("refuses text whose parts are not the one canonical encoding of their bytes", () =>
    Effect.gen(function* () {
      const { production, backup, reasonOf } = yield* fixture;
      const backed = (yield* signLicence(grant, production, backup)).text;
      for (const index of [1, 2, 3]) {
        expect(yield* reasonOf(withPart(backed, index, (part) => `${part}=`))).toBe("malformed");
        expect(yield* reasonOf(withPart(backed, index, loosenLastCharacter))).toBe("malformed");
      }
      expect(yield* reasonOf(backed)).toBe("accepted");
    }),
  );

  it.effect(
    "refuses a signed payload that was re-encoded, extended or re-signed with a second S",
    () =>
      Effect.gen(function* () {
        const { production, reasonOf } = yield* fixture;
        const { text } = yield* signLicence(grant, production, Option.none());
        const json = new TextDecoder().decode(
          Result.getOrThrow(Base64Url.decode(text.split(".")[1]!)),
        );
        const spaced = Base64Url.encode(json.replace(",", ", "));
        const later = Base64Url.encode(json.replace(/\}$/u, ',"expiresAt":9999999999999}'));
        expect(yield* reasonOf(withPart(text, 1, () => spaced))).toBe("badSignature");
        expect(yield* reasonOf(withPart(text, 1, () => later))).toBe("badSignature");
        expect(yield* reasonOf(withPart(text, 2, addGroupOrder))).toBe("badSignature");
      }),
  );
});
