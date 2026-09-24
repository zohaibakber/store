import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Planetscale from "alchemy/Planetscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Api, ApiLive } from "./apps/server/infra.ts";
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
    if (!stageUsesInventoryPostgres(stage)) {
      return {
        stage,
        authUrl: auth.url,
        apiUrl: api.url,
        workerName: api.workerName,
      };
    }
    const inventoryDatabaseId = yield* InventoryDatabaseId;
    return {
      stage,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
      inventoryDatabaseId,
    };
  }).pipe(Effect.provide(Layer.mergeAll(ApiLive, AuthLive))),
);
