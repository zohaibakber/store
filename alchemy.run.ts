import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, AuthLive } from "./apps/auth/infra";
import { Api, ApiLive } from "./apps/server/infra";
import { Website } from "./apps/web/infra";

/**
 * Composition root for the Cloudflare stack. Resources live next to the code
 * that owns them. The API Worker in `apps/server/infra.ts`, the Vite SPA in
 * `apps/web/infra.ts`, the auth database in `packages/db/src/auth/infra.ts`.
 *
 * Every deploy targets an explicit stage:
 *
 *   bun run deploy:dev    # or plan:dev
 *   bun run deploy:prod
 *
 * Running `alchemy deploy` bare would silently create a `dev_$USER` stage, so
 * the package scripts always pass `--stage`. CI deploys `prod` from `main`
 * only; pull requests do not create Cloudflare stages.
 */
export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    // Remote state, so local deploys and CI converge on the same history.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const auth = yield* Auth;
    const api = yield* Api;
    const website = yield* Website;

    // Non-secret outputs only. Authentication secrets stay in Worker bindings.
    return {
      stage,
      websiteUrl: website.url,
      authUrl: auth.url,
      apiUrl: api.url,
      workerName: api.workerName,
    };
  }).pipe(Effect.provide(Layer.mergeAll(ApiLive, AuthLive))),
);
