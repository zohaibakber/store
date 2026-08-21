import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra";
import { Api, ApiLive } from "./apps/server/infra";
import { Website } from "./apps/web/infra";

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
    const website = yield* Website;

    return {
      stage,
      websiteUrl: website.url,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
    };
  }).pipe(Effect.provide(Layer.mergeAll(ApiLive, AuthLive))),
);
