import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra.ts";
import { Api } from "./apps/server/api.ts";
import { ApiLive } from "./apps/server/infra.ts";

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
    return {
      stage,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
    };
  }).pipe(Effect.provide(AuthLive.pipe(Layer.provideMerge(ApiLive)))),
);
