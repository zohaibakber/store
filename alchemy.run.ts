import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Planetscale from "alchemy/Planetscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Api } from "./apps/server/api.ts";
import { ApiLive } from "./apps/server/infra.ts";
import { Website } from "./apps/web/infra.ts";
import { Edge } from "./infra/edge.ts";

export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Drizzle.providers(),
      Layer.unwrap(
        Effect.map(Alchemy.Stage, (stage) =>
          stage === "dev" ? Neon.providers() : Layer.empty,
        ),
      ),
      Layer.unwrap(
        Effect.map(Alchemy.Stage, (stage) =>
          stage === "dev" ? Layer.empty : Planetscale.providers(),
        ),
      ),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const auth = yield* Auth;
    const api = yield* Api;
    const websiteUrl = stage === "prod" ? (yield* Website).url : undefined;
    const edge = yield* Edge;
    return {
      stage,
      websiteUrl,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
      edge,
    };
  }).pipe(Effect.provide(AuthLive.pipe(Layer.provideMerge(ApiLive)))),
);
