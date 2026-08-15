import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Api, ApiLive } from "./apps/server/infra";
import { Website } from "./apps/web/infra";

/**
 * Composition root for the Cloudflare stack. Resources live next to the code
 * that owns them — the API Worker in `apps/server/infra.ts`, the Vite SPA in
 * `apps/web/infra.ts`, the auth database in `packages/db/src/auth/infra.ts`.
 *
 * Every deploy targets an explicit stage:
 *
 *   bun run deploy:dev    # or plan:dev
 *   bun run deploy:prod
 *
 * Running `alchemy deploy` bare would silently create a `dev_$USER` stage, so
 * the package scripts always pass `--stage`.
 */
export default Alchemy.Stack(
  "Tabaaq",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers(), GitHub.providers()),
    // Remote state, so local deploys and CI converge on the same history.
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const api = yield* Api;
    const website = yield* Website;

    if (process.env.PULL_REQUEST) {
      yield* GitHub.Comment("PreviewComment", {
        owner: "zohaibakber",
        repository: "store",
        issueNumber: Number(process.env.PULL_REQUEST),
        body: Output.interpolate`
          ## Preview deployed

          **App:** ${website.url}
          **API:** same origin — \`/api/*\` (health at \`/api/health\`)

          The React SPA is deployed with \`Cloudflare.Website.Vite\`. Deep links
          fall back to \`index.html\`; \`/api/*\` is proxied to the API Worker so
          browser sessions and desktop/mobile replicas share one sync API.
          Built from commit ${process.env.GITHUB_SHA?.slice(0, 7) ?? "unknown"}.

          ---
          _This comment updates automatically with each push._
        `,
      });
    }

    // Non-secret outputs only — never surface CLERK_SECRET_KEY here.
    return {
      stage,
      websiteUrl: website.url,
      apiUrl: api.url,
      workerName: api.workerName,
    };
  }).pipe(Effect.provide(ApiLive)),
);
