import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Api, ApiLive } from "./apps/server/infra.ts";
import { InventoryPostgres } from "./packages/db/src/postgres/infra.ts";

export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers(), Neon.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const auth = yield* Auth;
    const api = yield* Api;
    const inventoryPostgres = yield* InventoryPostgres;

    return {
      stage,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
      inventoryPostgresProjectId: inventoryPostgres.projectId,
    };
  }).pipe(Effect.provide(Layer.mergeAll(ApiLive, AuthLive))),
);
