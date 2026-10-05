import {
  LicenceRefusal,
  LicenceState,
  licenceStateOf,
  type Licence,
  type ShopId,
} from "@store/contracts";
import { verifyLicenceText, type LicenceTrust } from "@store/licence";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { readPrivateText, replacePrivateText } from "./files";

const RECHECK_EVERY = Duration.minutes(1);
const REMEMBER_CLOCK_EVERY = Duration.minutes(10);

const sameState = Schema.toEquivalence(LicenceState);

const decodeSeen = Schema.decodeUnknownOption(
  Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
);

const refuse = (reason: LicenceRefusal["reason"]) => new LicenceRefusal({ reason });

export class LicenceService extends Context.Service<
  LicenceService,
  {
    readonly current: Effect.Effect<LicenceState>;
    readonly states: Stream.Stream<LicenceState>;
    readonly enter: (
      text: string,
      databaseShop: Effect.Effect<Option.Option<ShopId>>,
    ) => Effect.Effect<Licence, LicenceRefusal>;
  }
>()("@store/desktop/LicenceService") {
  static readonly layer = (options: {
    readonly directory: string;
    readonly trust: LicenceTrust;
  }): Layer.Layer<LicenceService, never, FileSystem.FileSystem | Path.Path> =>
    Layer.effect(
      LicenceService,
      Effect.gen(function* () {
        const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
        const path = yield* Path.Path;
        const licenceFile = path.join(options.directory, "licence.txt");
        const seenFile = path.join(options.directory, "last-seen");
        const turn = yield* Semaphore.make(1);
        const oneAtATime = <A, E>(work: Effect.Effect<A, E>) => turn.withPermit(work);

        const read = (file: string) =>
          readPrivateText(file).pipe(
            Effect.provideContext(context),
            Effect.catch((failure) =>
              Effect.as(
                Effect.logWarning("LicenceService.read_failed", failure),
                Option.none<string>(),
              ),
            ),
          );

        const write = (file: string, text: string) =>
          replacePrivateText(file, text).pipe(Effect.provideContext(context));

        const stored = Option.flatMap(yield* read(licenceFile), (text) =>
          Result.getSuccess(verifyLicenceText(text, options.trust)),
        );
        const held = yield* Ref.make(Option.map(stored, (verified) => verified.licence));
        const seen = yield* Ref.make(
          Option.getOrElse(Option.flatMap(yield* read(seenFile), decodeSeen), () => 0),
        );
        const remembered = yield* Ref.make(0);

        const guardedNow = Effect.flatMap(Clock.currentTimeMillis, (system) =>
          Ref.updateAndGet(seen, (latest) => Math.max(latest, system)),
        );

        const judge = Effect.gen(function* () {
          const now = yield* guardedNow;
          return Option.match(yield* Ref.get(held), {
            onNone: () => licenceStateOf(null, now),
            onSome: (licence) => licenceStateOf(licence, Math.max(now, licence.issuedAt)),
          });
        });

        const rememberClock = Effect.gen(function* () {
          const now = yield* Ref.get(seen);
          yield* write(seenFile, String(now));
          yield* Ref.set(remembered, now);
        }).pipe(
          Effect.catch((failure) => Effect.logWarning("LicenceService.clock_not_saved", failure)),
        );

        const state = yield* SubscriptionRef.make(yield* judge);
        yield* rememberClock;

        const recheck = Effect.gen(function* () {
          yield* SubscriptionRef.set(state, yield* judge);
          const due = (yield* Ref.get(remembered)) + Duration.toMillis(REMEMBER_CLOCK_EVERY);
          if ((yield* Ref.get(seen)) >= due) yield* rememberClock;
        }).pipe(oneAtATime);

        yield* recheck.pipe(
          Effect.repeat(Schedule.spaced(RECHECK_EVERY)),
          Effect.delay(RECHECK_EVERY),
          Effect.forkScoped,
        );

        const enter = Effect.fn("LicenceService.enter")(function* (
          text: string,
          databaseShop: Effect.Effect<Option.Option<ShopId>>,
        ) {
          const { licence, text: accepted } = yield* Effect.fromResult(
            verifyLicenceText(text, options.trust),
          );
          const owner = yield* databaseShop;
          if (Option.isSome(owner) && owner.value !== licence.shopId) {
            return yield* refuse("otherShop");
          }
          const current = yield* Ref.get(held);
          if (
            Option.isSome(current) &&
            current.value.shopId === licence.shopId &&
            licence.expiresAt <= current.value.expiresAt
          ) {
            return yield* refuse("notNewer");
          }
          yield* Effect.orDie(write(licenceFile, accepted));
          yield* Ref.set(held, Option.some(licence));
          yield* Ref.set(seen, yield* Clock.currentTimeMillis);
          yield* rememberClock;
          yield* SubscriptionRef.set(state, yield* judge);
          return licence;
        }, oneAtATime);

        return LicenceService.of({
          current: SubscriptionRef.get(state),
          states: SubscriptionRef.changes(state).pipe(Stream.changesWith(sameState)),
          enter,
        });
      }),
    );
}
