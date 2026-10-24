import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  LicenceId,
  licenceStateOf,
  ShopId,
  ShopName,
  type Licence,
  type LicenceState,
} from "@store/contracts";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { LICENCE_PUBLIC_KEYS } from "./keys";
import { OperatorFailure, OperatorStore, PRIVATE_FILE } from "./operator";
import {
  deriveBackupKey,
  generateSigningKey,
  publicKeyOf,
  signLicence,
  type LicenceBackupKey,
  type LicenceGrant,
  type LicenceSigningKey,
} from "./sign";
import { LICENCE_TEXT_PREFIX } from "./text";
import { verifyLicenceText } from "./verify";

const DAY_MILLIS = 86_400_000;
const FIRST_BACKUP_KEY_VERSION = 1;

const KeyId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/u));
const Days = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3_650 }));
const DaysAgo = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3_650 }));

const day = (millis: number) => DateTime.formatIsoDateUtc(DateTime.makeUnsafe(millis));

const describeState = (state: LicenceState): string => {
  switch (state._tag) {
    case "missing":
      return "missing";
    case "valid":
      return "valid";
    case "expiring":
      return `expiring, ${state.daysLeft} days left`;
    case "grace":
      return `in grace, ${state.daysLeft} days until read-only`;
    case "expired":
      return "expired";
  }
};

const describe = (licence: Licence, now: number) =>
  [
    `shop name   ${licence.shopName}`,
    `shop id     ${licence.shopId}`,
    `licence id  ${licence.id}`,
    `issued      ${day(licence.issuedAt)}`,
    `expires     ${day(licence.expiresAt)}`,
    `state       ${describeState(licenceStateOf(licence, now))}`,
    `signed by   ${licence.signingKeyId}`,
    `backup      ${licence.backup === null ? "off" : `on, key version ${licence.backup.keyVersion}`}`,
  ].join("\n");

const signingKey = Effect.fn("LicenceCli.signingKey")(function* (wanted: Option.Option<string>) {
  const store = yield* OperatorStore;
  const keys = yield* store.keys;
  const chosen = Option.match(wanted, {
    onNone: () => (keys.length === 1 ? keys[0] : undefined),
    onSome: (id) => keys.find((key) => key.id === id),
  });
  if (chosen !== undefined) return chosen;
  const known = keys.map((key) => key.id).join(", ");
  return yield* new OperatorFailure({
    message: Option.match(wanted, {
      onNone: () =>
        keys.length === 0
          ? `No private key in ${store.directory}. Run keygen first.`
          : `Several private keys exist (${known}). Choose one with --key.`,
      onSome: (id) => `No private key named ${id} in ${store.directory}. Known keys: ${known}.`,
    }),
  });
});

const readLicence = Effect.fn("LicenceCli.readLicence")(function* (textOrFile: string) {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* OperatorStore;
  const fromFile =
    !textOrFile.startsWith(LICENCE_TEXT_PREFIX) &&
    (yield* fs.exists(textOrFile).pipe(Effect.orElseSucceed(() => false)));
  const text = fromFile
    ? yield* fs
        .readFileString(textOrFile)
        .pipe(
          Effect.mapError(
            (cause) =>
              new OperatorFailure({ message: `Could not read the file. ${cause.message}` }),
          ),
        )
    : textOrFile;
  const local = (yield* store.keys).map(publicKeyOf);
  return yield* Effect.fromResult(
    verifyLicenceText(text, { keys: [...LICENCE_PUBLIC_KEYS, ...local], packaged: false }),
  ).pipe(
    Effect.mapError(
      (refusal) => new OperatorFailure({ message: `The licence was refused: ${refusal.reason}.` }),
    ),
  );
});

const out = Flag.String("out").pipe(
  Flag.withDescription("Also write the licence text to this file, to send to the shop"),
  Flag.optional,
);

const issueAndRecord = Effect.fn("LicenceCli.issue")(function* (
  grant: Omit<LicenceGrant, "id">,
  key: LicenceSigningKey,
  backup: Option.Option<LicenceBackupKey>,
  file: Option.Option<string>,
) {
  const store = yield* OperatorStore;
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const id = LicenceId.make(yield* Effect.orDie(crypto.randomUUIDv4()));
  const issued = signLicence({ ...grant, id }, key, backup);
  yield* store.record(issued);
  if (Option.isSome(file)) {
    yield* fs
      .writeFileString(file.value, `${issued.text}\n`, { mode: PRIVATE_FILE })
      .pipe(
        Effect.mapError(
          (cause) => new OperatorFailure({ message: `Could not write the file. ${cause.message}` }),
        ),
      );
  }
  yield* Console.error(describe(issued.licence, yield* Clock.currentTimeMillis));
  yield* Console.log(issued.text);
});

const keygen = Command.make(
  "keygen",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Key id written into every licence this key signs"),
      Flag.withSchema(KeyId),
    ),
    development: Flag.Boolean("development").pipe(
      Flag.withDescription("Mark the key as accepted by unpackaged builds only"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ id, development }) {
    const store = yield* OperatorStore;
    const key = generateSigningKey(id, development);
    const file = yield* store.saveKey(key);
    yield* Console.error(
      `Private key written to ${file}. Paste this entry into packages/licence/src/keys.ts:`,
    );
    yield* Console.log(
      `{ id: ${JSON.stringify(key.id)}, publicKey: ${JSON.stringify(key.publicKey)}, developmentOnly: ${String(key.developmentOnly)} },`,
    );
  }),
).pipe(Command.withDescription("Create a signing key"));

const issue = Command.make(
  "issue",
  {
    shopName: Flag.String("shop-name").pipe(
      Flag.withDescription("Shop name shown in the app"),
      Flag.withSchema(ShopName),
    ),
    shopId: Flag.String("shop-id").pipe(
      Flag.withDescription("Existing shop id; a new one is generated when omitted"),
      Flag.withSchema(ShopId),
      Flag.optional,
    ),
    days: Flag.Int("days").pipe(
      Flag.withDescription("Days from the issue date until expiry"),
      Flag.withSchema(Days),
      Flag.withDefault(365),
    ),
    issuedDaysAgo: Flag.Int("issued-days-ago").pipe(
      Flag.withDescription("Backdate the issue date, to make test licences in any state"),
      Flag.withSchema(DaysAgo),
      Flag.withDefault(0),
    ),
    backup: Flag.Boolean("backup").pipe(
      Flag.withDescription("Turn cloud backup on and include the shop's backup key"),
      Flag.withDefault(false),
    ),
    key: Flag.String("key").pipe(Flag.withDescription("Signing key id"), Flag.optional),
    out,
  },
  Effect.fn(function* (input) {
    const store = yield* OperatorStore;
    const crypto = yield* Crypto.Crypto;
    const key = yield* signingKey(input.key);
    const shopId = yield* Option.match(input.shopId, {
      onSome: (id) => Effect.succeed(id),
      onNone: () => Effect.map(Effect.orDie(crypto.randomUUIDv4()), (id) => ShopId.make(id)),
    });
    const issuedAt = (yield* Clock.currentTimeMillis) - input.issuedDaysAgo * DAY_MILLIS;
    const backup = input.backup
      ? Option.some({
          keyVersion: FIRST_BACKUP_KEY_VERSION,
          key: deriveBackupKey(yield* store.backupSecret, shopId, FIRST_BACKUP_KEY_VERSION),
        })
      : Option.none();
    yield* issueAndRecord(
      {
        shopId,
        shopName: input.shopName,
        issuedAt,
        expiresAt: issuedAt + input.days * DAY_MILLIS,
      },
      key,
      backup,
      input.out,
    );
  }),
).pipe(Command.withDescription("Issue a licence for a shop"));

const renew = Command.make(
  "renew",
  {
    licence: Flag.String("licence").pipe(
      Flag.withDescription("The shop's current licence, as text or a file path"),
    ),
    days: Flag.Int("days").pipe(
      Flag.withDescription(
        "Days added after the current expiry, or after today when it has passed",
      ),
      Flag.withSchema(Days),
      Flag.withDefault(365),
    ),
    key: Flag.String("key").pipe(Flag.withDescription("Signing key id"), Flag.optional),
    out,
  },
  Effect.fn(function* (input) {
    const key = yield* signingKey(input.key);
    const current = yield* readLicence(input.licence);
    const issuedAt = yield* Clock.currentTimeMillis;
    const { backup } = current.licence;
    yield* issueAndRecord(
      {
        shopId: current.licence.shopId,
        shopName: current.licence.shopName,
        issuedAt,
        expiresAt: Math.max(issuedAt, current.licence.expiresAt) + input.days * DAY_MILLIS,
      },
      key,
      backup === null
        ? Option.none()
        : Option.map(current.backupKey, (held) => ({
            keyVersion: backup.keyVersion,
            key: Redacted.value(held),
          })),
      input.out,
    );
  }),
).pipe(Command.withDescription("Issue a later licence for the same shop and backup key"));

const list = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const store = yield* OperatorStore;
    const issued = yield* store.issued;
    if (issued.length === 0) return yield* Console.log("No licences issued yet.");
    yield* Effect.forEach(
      issued,
      ({ licence }) =>
        Console.log(
          `${day(licence.expiresAt)}  ${licence.shopId}  ${licence.shopName}  (${licence.id})`,
        ),
      { discard: true },
    );
  }),
).pipe(Command.withDescription("List issued licences: expiry, shop id, shop name"));

const show = Command.make(
  "show",
  {
    licence: Argument.String("licence").pipe(
      Argument.withDescription("Licence text or a file path"),
    ),
  },
  Effect.fn(function* ({ licence }) {
    const verified = yield* readLicence(licence);
    yield* Console.log(describe(verified.licence, yield* Clock.currentTimeMillis));
  }),
).pipe(Command.withDescription("Decode and verify a licence"));

Command.make("licence").pipe(
  Command.withDescription("Issue and inspect Tabaaq licences"),
  Command.withSubcommands([keygen, issue, renew, list, show]),
  Command.run({ version: "1" }),
  Effect.provide(OperatorStore.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  Effect.tapErrorTag("OperatorFailure", (failure) => Console.error(failure.message)),
  NodeRuntime.runMain,
);
