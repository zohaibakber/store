import { homedir } from "node:os";

import { Licence } from "@store/contracts";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { LicenceSigningKey } from "./sign";
import { BACKUP_KEY_BYTES } from "./text";

const PRIVATE_FILE = 0o600;
const PRIVATE_DIRECTORY = 0o700;

export class OperatorFailure extends Schema.TaggedError<OperatorFailure>()("OperatorFailure", {
  message: Schema.String,
}) {}

export const IssuedLicence = Schema.Struct({ licence: Licence, text: Schema.String });
export type IssuedLicence = typeof IssuedLicence.Type;

const SigningKeyJson = Schema.fromJsonString(LicenceSigningKey);
const decodeSigningKey = Schema.decodeUnknownEffect(SigningKeyJson);
const encodeSigningKey = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      ...LicenceSigningKey.fields,
      privateKey: Schema.NonEmptyString,
    }),
  ),
);

const IssuedJson = Schema.fromJsonString(IssuedLicence);
const decodeIssued = Schema.decodeUnknownEffect(IssuedJson);
const encodeIssued = Schema.encodeEffect(IssuedJson);

const failed = (action: string) =>
  Effect.mapError(
    (cause: { readonly message: string }) =>
      new OperatorFailure({ message: `Could not ${action}. ${cause.message}` }),
  );

export class OperatorStore extends Context.Service<
  OperatorStore,
  {
    readonly directory: string;
    readonly saveKey: (key: LicenceSigningKey) => Effect.Effect<string, OperatorFailure>;
    readonly keys: Effect.Effect<ReadonlyArray<LicenceSigningKey>, OperatorFailure>;
    readonly backupSecret: Effect.Effect<Redacted.Redacted<Uint8Array>, OperatorFailure>;
    readonly record: (issued: IssuedLicence) => Effect.Effect<void, OperatorFailure>;
    readonly issued: Effect.Effect<ReadonlyArray<IssuedLicence>, OperatorFailure>;
  }
>()("@store/licence/OperatorStore") {
  static readonly layer = Layer.effect(
    OperatorStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const directory = yield* Config.String("TABAAQ_LICENCE_HOME").pipe(
        Config.withDefault(path.join(homedir(), ".config", "tabaaq-licence")),
      );
      const keyDirectory = path.join(directory, "keys");
      const secretFile = path.join(directory, "backup-secret");
      const issuedFile = path.join(directory, "issued.jsonl");

      const prepare = (target: string) =>
        fs.makeDirectory(target, { recursive: true, mode: PRIVATE_DIRECTORY });

      const saveKey = Effect.fn("OperatorStore.saveKey")(function* (key: LicenceSigningKey) {
        const file = path.join(keyDirectory, `${key.id}.json`);
        yield* prepare(keyDirectory);
        const text = yield* encodeSigningKey({
          ...key,
          privateKey: Redacted.value(key.privateKey),
        });
        yield* fs.writeFileString(file, `${text}\n`, { flag: "wx", mode: PRIVATE_FILE });
        return file;
      }, failed("write the private key"));

      const keys = Effect.gen(function* () {
        if (!(yield* fs.exists(keyDirectory))) return [];
        const names = yield* fs.readDirectory(keyDirectory);
        return yield* Effect.forEach(
          names.filter((name) => name.endsWith(".json")),
          (name) =>
            Effect.flatMap(fs.readFileString(path.join(keyDirectory, name)), decodeSigningKey),
        );
      }).pipe(failed("read the private keys"), Effect.withSpan("OperatorStore.keys"));

      const createSecret = Effect.gen(function* () {
        const secret = yield* crypto.randomBytes(BACKUP_KEY_BYTES);
        yield* prepare(directory);
        yield* fs.writeFileString(secretFile, `${Base64Url.encode(secret)}\n`, {
          flag: "wx",
          mode: PRIVATE_FILE,
        });
        yield* Console.error(
          `Created the vendor backup secret at ${secretFile}. Keep a copy: every shop's backup key is derived from it.`,
        );
        return secret;
      });

      const backupSecret = Effect.gen(function* () {
        if (!(yield* fs.exists(secretFile))) return Redacted.make(yield* createSecret);
        const stored = Base64Url.decode((yield* fs.readFileString(secretFile)).trim());
        if (Result.isFailure(stored) || stored.success.length !== BACKUP_KEY_BYTES) {
          return yield* new OperatorFailure({ message: `${secretFile} is not a backup secret.` });
        }
        return Redacted.make(stored.success);
      }).pipe(failed("read the backup secret"), Effect.withSpan("OperatorStore.backupSecret"));

      const record = Effect.fn("OperatorStore.record")(function* (issued: IssuedLicence) {
        yield* prepare(directory);
        const line = yield* encodeIssued(issued);
        yield* fs.writeFileString(issuedFile, `${line}\n`, { flag: "a", mode: PRIVATE_FILE });
      }, failed("record the issued licence"));

      const issued = Effect.gen(function* () {
        if (!(yield* fs.exists(issuedFile))) return [];
        const lines = (yield* fs.readFileString(issuedFile)).split("\n");
        return yield* Effect.forEach(
          lines.filter((line) => line.trim() !== ""),
          (line) => decodeIssued(line),
        );
      }).pipe(failed("read the issued licences"), Effect.withSpan("OperatorStore.issued"));

      return OperatorStore.of({ directory, saveKey, keys, backupSecret, record, issued });
    }),
  );
}
