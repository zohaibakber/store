import {
  makeAnalyticsStore,
  openAnalyticsDatabase,
  openInventorySource,
} from "@store/client-db/node-analytics";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  analyticsNoticeOf,
  AnalyticsWorkerFailure,
  AnalyticsWorkerRpcs,
  type AnalyticsWorkerBoot,
} from "./analytics-rpc";
import { makeAnalyticsScheduler, type AnalyticsScheduler } from "./analytics-scheduler";

const failure = (cause: unknown) =>
  new AnalyticsWorkerFailure({
    message: cause instanceof Error ? cause.message : "The insights worker failed.",
  });

const unavailable = () =>
  new AnalyticsWorkerFailure({ message: "The insights worker could not open its databases." });

export const makeAnalyticsWorkerHandlers = <R>(
  boot: Effect.Effect<typeof AnalyticsWorkerBoot.Type, unknown, R>,
) =>
  AnalyticsWorkerRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* boot;
      const opened = yield* Effect.gen(function* () {
        const database = yield* openAnalyticsDatabase(config.analyticsDatabasePath);
        const source = yield* openInventorySource(config.replicaDatabasePath);
        const store = makeAnalyticsStore(database);
        const scheduler = yield* makeAnalyticsScheduler({ source, store });
        return { store, scheduler };
      }).pipe(
        Effect.tapError((cause) => Effect.logError("AnalyticsWorker.open_failed", cause)),
        Effect.option,
      );
      const read = <A>(
        use: (current: {
          readonly store: ReturnType<typeof makeAnalyticsStore>;
          readonly scheduler: AnalyticsScheduler;
        }) => Effect.Effect<A, unknown>,
      ) =>
        Option.match(opened, {
          onNone: () => Effect.fail(unavailable()),
          onSome: (current) => use(current).pipe(Effect.mapError(failure)),
        });

      return AnalyticsWorkerRpcs.of({
        Ready: () =>
          Option.match(opened, {
            onNone: () => Effect.fail(unavailable()),
            onSome: () => Effect.succeed("ready" as const),
          }),
        Notify: ({ notice }) =>
          Option.match(opened, {
            onNone: () => Effect.void,
            onSome: ({ scheduler }) => scheduler.notify(analyticsNoticeOf(notice)),
          }),
        ReadSummary: ({ context }) =>
          read(({ store, scheduler }) =>
            Effect.gen(function* () {
              const status = yield* scheduler.observe(context);
              const published = yield* Effect.try(() => store.published());
              return { summary: published?.summary ?? null, status };
            }),
          ),
        ReadProducts: ({ context, ids }) =>
          read(({ store, scheduler }) =>
            Effect.gen(function* () {
              const status = yield* scheduler.observe(context);
              const found = yield* Effect.try(() => store.products(ids));
              return { run: found.run ?? null, insights: found.insights, status };
            }),
          ),
        ReadRestockPage: ({ context, request }) =>
          read(({ store, scheduler }) =>
            Effect.gen(function* () {
              const status = yield* scheduler.observe(context);
              const page = yield* Effect.try(() => store.restockPage(request));
              return page === undefined
                ? { run: null, rows: [], nextCursor: null, total: 0, cursorExpired: false, status }
                : { ...page, status };
            }),
          ),
        Changes: () =>
          Option.match(opened, {
            onNone: () => Stream.empty,
            onSome: ({ scheduler }) => scheduler.events,
          }),
      });
    }),
  );
