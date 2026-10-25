import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Api } from "./apps/server/api.ts";
import { ApiLive } from "./apps/server/infra.ts";
import { Edge } from "./infra/edge.ts";

export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const auth = yield* Auth;
    const api = yield* Api;
    const edge = yield* Edge;
    return {
      stage,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
      edge,
    };
  }).pipe(Effect.provide(AuthLive.pipe(Layer.provideMerge(ApiLive)))),
);
