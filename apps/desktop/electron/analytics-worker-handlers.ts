import { InsightsReports, layerInventoryInsights } from "@store/client-db/insights";
import {
  makeAnalyticsStore,
  openAnalyticsDatabase,
  openInventorySource,
} from "@store/client-db/node-analytics";
import { layerNodeSqliteReadonlyReplica } from "@store/client-db/node-sqlite";
import { InventoryInsights } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcServer from "effect/rpc/RpcServer";

import {
  analyticsNoticeOf,
  AnalyticsWorkerFailure,
  AnalyticsWorkerRpcs,
  type AnalyticsWorkerBoot,
} from "./analytics-rpc";
import { makeAnalyticsScheduler } from "./analytics-scheduler";
import { makeRendererServers, noRendererServers } from "./renderer-servers";

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
        const insights = yield* Layer.build(
          layerInventoryInsights.pipe(
            Layer.provide(
              InsightsReports.layerAnalytics({
                store,
                observe: scheduler.observe,
                changes: scheduler.events,
              }),
            ),
            Layer.provide(layerNodeSqliteReadonlyReplica(config.replicaDatabasePath)),
          ),
        ).pipe(Effect.catchDefect(Effect.fail));
        return { store, scheduler, insights };
      }).pipe(
        Effect.tapError((cause) => Effect.logError("AnalyticsWorker.open_failed", cause)),
        Effect.option,
      );
      const renderers = Option.isNone(opened)
        ? noRendererServers
        : yield* makeRendererServers((protocol) =>
            RpcServer.layer(InventoryInsights).pipe(
              Layer.provide(Layer.succeedContext(opened.value.insights)),
              Layer.provide(protocol),
            ),
          );
      return AnalyticsWorkerRpcs.of({
        Ready: () =>
          Option.match(opened, {
            onNone: () => Effect.fail(unavailable()),
            onSome: () => Effect.succeed("ready" as const),
          }),
        AttachRenderer: ({ port }) => renderers.attach(port),
        Notify: ({ notice }) =>
          Option.match(opened, {
            onNone: () => Effect.void,
            onSome: ({ scheduler }) => scheduler.notify(analyticsNoticeOf(notice)),
          }),
      });
    }),
  );
