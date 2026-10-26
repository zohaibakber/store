import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { expect, layer } from "@effect/vitest";
import { LicenceId, LicenceRefusal, ShopId, ShopName, type LicenceState } from "@store/contracts";
import type { LicenceTrust } from "@store/licence";
import { generateSigningKey, publicKeyOf, signLicence } from "@store/licence/sign";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { LicenceService } from "../../electron/licence/service";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 5);

const key = generateSigningKey("test", false);
const trust: LicenceTrust = { keys: [publicKeyOf(key)], packaged: true };

const SHOP_A = ShopId.make("shop-a");
const SHOP_B = ShopId.make("shop-b");

const licenceText = (shopId: ShopId, expiresAt: number) =>
  signLicence(
    {
      id: LicenceId.make(`${shopId}-${expiresAt}`),
      shopId,
      shopName: ShopName.make("Test Pharmacy"),
      issuedAt: NOW - DAY,
      expiresAt,
    },
    key,
    Option.none(),
  ).text;

const Files = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const atStart = <A, E, R>(test: Effect.Effect<A, E, R>) =>
  TestClock.setTime(NOW).pipe(Effect.andThen(test));

const launch = (directory: string) =>
  Layer.build(
    Layer.fresh(LicenceService.layer({ directory, trust }).pipe(Layer.provide(Files))),
  ).pipe(Effect.map((built) => Context.get(built, LicenceService)));

const tagOf = (service: LicenceService["Service"]) =>
  Effect.map(service.current, (state) => state._tag);

const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(
    Effect.map((failure) => (failure instanceof LicenceRefusal ? failure.reason : failure)),
  );

const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));

const advance = Effect.fnUntraced(function* (
  service: LicenceService["Service"],
  duration: Duration.Input,
  until: LicenceState["_tag"],
) {
  yield* TestClock.adjust(duration);
  for (let step = 0; step < 20 && (yield* tagOf(service)) !== until; step += 1) {
    yield* settle;
    yield* TestClock.adjust("1 minute");
  }
});

const rememberedSince = Effect.fnUntraced(function* (directory: string, time: number) {
  const fs = yield* FileSystem.FileSystem;
  for (let step = 0; step < 200; step += 1) {
    if (Number(yield* fs.readFileString(`${directory}/last-seen`)) >= time) return;
    yield* settle;
  }
});

const unclaimed = Effect.succeed(Option.none<ShopId>());
const ownedBy = (shop: ShopId) => Effect.succeed(Option.some(shop));

const temporaryDirectory = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "licence-service-" }),
);

layer(Files)("licence service", (it) => {
  it.effect(
    "moves from valid to expiring, grace and expired as time passes, without a restart",
    () =>
      atStart(
        Effect.gen(function* () {
          const service = yield* launch(yield* temporaryDirectory);
          const seen: Array<LicenceState["_tag"]> = [];
          yield* service.states.pipe(
            Stream.runForEach((state) => Effect.sync(() => seen.push(state._tag))),
            Effect.forkScoped({ startImmediately: true }),
          );
          yield* service.enter(licenceText(SHOP_A, NOW + 40 * DAY), unclaimed);
          yield* advance(service, "11 days", "expiring");
          expect(yield* service.current).toMatchObject({ _tag: "expiring", daysLeft: 29 });
          yield* advance(service, "30 days", "grace");
          expect(yield* service.current).toMatchObject({ _tag: "grace", daysLeft: 13 });
          yield* advance(service, "13 days", "expired");
          expect(yield* tagOf(service)).toBe("expired");
          expect(seen.filter((tag, index) => tag !== seen[index - 1])).toEqual([
            "missing",
            "valid",
            "expiring",
            "grace",
            "expired",
          ]);
        }),
      ),
  );

  it.effect("keeps judging against the latest time it has seen when the clock is set back", () =>
    atStart(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* launch(directory);
            yield* service.enter(licenceText(SHOP_A, NOW + 40 * DAY), unclaimed);
            yield* advance(service, "60 days", "expired");
            expect(yield* tagOf(service)).toBe("expired");
            yield* TestClock.setTime(NOW);
            yield* advance(service, "5 minutes", "valid");
            expect(yield* tagOf(service)).toBe("expired");
            yield* rememberedSince(directory, NOW + 60 * DAY);
          }),
        );
        yield* TestClock.setTime(NOW);
        const restarted = yield* launch(directory);
        expect(yield* tagOf(restarted)).toBe("expired");
        yield* advance(restarted, "2 days", "valid");
        expect(yield* tagOf(restarted)).toBe("expired");

        yield* restarted.enter(licenceText(SHOP_A, NOW + 400 * DAY), ownedBy(SHOP_A));
        expect(yield* tagOf(restarted)).toBe("valid");
      }),
    ),
  );

  it.effect(
    "counts the time the app runs while the clock is held back, and saves it on close",
    () =>
      atStart(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const fs = yield* FileSystem.FileSystem;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const service = yield* launch(directory);
              yield* service.enter(licenceText(SHOP_A, NOW + 40 * DAY), unclaimed);
              yield* advance(service, "20 days", "expiring");
              yield* TestClock.setTime(NOW - 300 * DAY);
              yield* advance(service, "25 days", "grace");
              expect(yield* tagOf(service)).toBe("grace");
              yield* TestClock.setTime(NOW - 300 * DAY);
              yield* advance(service, "15 days", "expired");
              expect(yield* tagOf(service)).toBe("expired");
              yield* TestClock.setTime(NOW - 300 * DAY);
              yield* TestClock.adjust("3 minutes");
            }),
          );
          expect(Number(yield* fs.readFileString(`${directory}/last-seen`))).toBeGreaterThanOrEqual(
            NOW + 60 * DAY + 3 * 60_000,
          );
          expect(yield* tagOf(yield* launch(directory))).toBe("expired");
        }),
      ),
  );

  it.effect(
    "keeps the stored licence across restarts and refuses one that is not newer or for another shop",
    () =>
      atStart(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const first = yield* launch(directory);
          expect(yield* tagOf(first)).toBe("missing");
          expect(yield* reasonOf(first.enter("not a licence", unclaimed))).toBe("malformed");
          const entered = yield* first.enter(licenceText(SHOP_A, NOW + 365 * DAY), unclaimed);
          expect(entered.shopName).toBe("Test Pharmacy");

          const second = yield* launch(directory);
          expect(yield* second.current).toMatchObject({ _tag: "valid", licence: entered });
          expect(
            yield* reasonOf(second.enter(licenceText(SHOP_A, NOW + 365 * DAY), ownedBy(SHOP_A))),
          ).toBe("notNewer");
          expect(
            yield* reasonOf(second.enter(licenceText(SHOP_A, NOW + 100 * DAY), ownedBy(SHOP_A))),
          ).toBe("notNewer");
          expect(
            yield* reasonOf(second.enter(licenceText(SHOP_B, NOW + 900 * DAY), ownedBy(SHOP_A))),
          ).toBe("otherShop");
          expect(yield* second.current).toMatchObject({ _tag: "valid", licence: entered });
          const renewed = yield* second.enter(
            licenceText(SHOP_A, NOW + 730 * DAY),
            ownedBy(SHOP_A),
          );
          expect(renewed.expiresAt).toBe(NOW + 730 * DAY);
        }),
      ),
  );

  it.effect("treats a stored licence that no longer verifies as missing", () =>
    atStart(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const fs = yield* FileSystem.FileSystem;
        const service = yield* launch(directory);
        yield* service.enter(licenceText(SHOP_A, NOW + 365 * DAY), unclaimed);
        const file = `${directory}/licence.txt`;
        const forged = licenceText(SHOP_A, NOW + 9_000 * DAY).split(".");
        const stored = (yield* fs.readFileString(file)).trim().split(".");
        yield* fs.writeFileString(file, [stored[0], forged[1], stored[2]].join("."));
        expect(yield* tagOf(yield* launch(directory))).toBe("missing");
      }),
    ),
  );
});
