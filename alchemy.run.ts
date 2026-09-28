import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Planetscale from "alchemy/Planetscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Website } from "./apps/desktop/infra.ts";
import { Api, ApiLive } from "./apps/server/infra.ts";
import { Edge } from "./infra/edge.ts";
import { InventoryDatabaseId } from "./packages/db/src/postgres/infra.ts";
import {
  stageUsesInventoryPostgres,
  stageUsesNeonInventory,
  stageUsesPlanetscaleInventory,
} from "./packages/db/src/postgres/stage.ts";

export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Drizzle.providers(),
      Layer.unwrap(
        Alchemy.Stage.pipe(
          Effect.map((stage) =>
            stageUsesNeonInventory(stage)
              ? Neon.providers()
              : stageUsesPlanetscaleInventory(stage)
                ? Planetscale.providers()
                : Layer.empty,
          ),
        ),
      ),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const auth = yield* Auth;
    const api = yield* Api;
    const websiteUrl = stage === "prod" || stage === "nightly" ? (yield* Website).url : undefined;
    const edge = yield* Edge;
    if (!stageUsesInventoryPostgres(stage)) {
      return {
        stage,
        websiteUrl,
        authUrl: auth.url,
        apiUrl: api.url,
        workerName: api.workerName,
        edge,
      };
    }
    const inventoryDatabaseId = yield* InventoryDatabaseId;
    return {
      stage,
      websiteUrl,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
      edge,
      inventoryDatabaseId,
    };
  }).pipe(Effect.provide(Layer.mergeAll(ApiLive, AuthLive))),
);
