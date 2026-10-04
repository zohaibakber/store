import { InventoryInsights, InventoryReads, InventoryStore } from "@store/contracts/replica";
import { SqliteReplica } from "@store/sync/sql-client";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Atom from "effect/reactivity/Atom";
import * as RpcTest from "effect/rpc/RpcTest";
import { SqlClient } from "effect/sql/SqlClient";

import { InsightsReports, layerInventoryInsights } from "./insights/handlers";
import { layerInventoryReads } from "./reads/handlers";
import type { SqliteReplicaServices } from "./replica/sql-client-session";
import { layerInventoryStore } from "./store/handlers";

export type InProcessReplica = Context.Context<SqliteReplicaServices>;

const layerReads = layerInventoryReads.pipe(
  Layer.provide(
    Layer.effect(
      SqlClient,
      SqliteReplica.use((replica) => Effect.succeed(replica.sql)),
    ),
  ),
);

const layerInsights = layerInventoryInsights.pipe(Layer.provide(InsightsReports.layerReplica));

const closed = Layer.effectContext(Effect.never);

export const inProcessLinks = (session: Atom.Atom<Option.Option<InProcessReplica>>) => {
  const within =
    <Handlers>(handlers: Layer.Layer<Handlers, never, SqliteReplicaServices>) =>
    (get: Atom.AtomContext): Layer.Layer<Handlers> =>
      Option.match(get(session), {
        onNone: () => closed,
        onSome: (services) => Layer.provide(handlers, Layer.succeedContext(services)),
      });
  return {
    reads: {
      protocol: within(layerReads),
      makeEffect: RpcTest.makeClient(InventoryReads, { flatten: true }),
    },
    store: {
      protocol: within(layerInventoryStore),
      makeEffect: RpcTest.makeClient(InventoryStore, { flatten: true }),
    },
    insights: {
      protocol: within(layerInsights),
      makeEffect: RpcTest.makeClient(InventoryInsights, { flatten: true }),
    },
  };
};
