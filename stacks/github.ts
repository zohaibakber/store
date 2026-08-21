import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const repository = {
  owner: "zohaibakber",
  name: "store",
} as const;

export default Alchemy.Stack(
  "TabaaqGitHub",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const accountId = yield* Config.string("CLOUDFLARE_ACCOUNT_ID");

    const ciToken = yield* Cloudflare.ApiToken.AccountApiToken("CIToken", {
      name: "tabaaq-github-actions",
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: ["Secrets Store Write", "Workers Scripts Write", "D1 Write"],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
      ],
    });

    yield* GitHub.Environment("Development", {
      owner: repository.owner,
      repository: repository.name,
      name: "Development",
    });

    yield* GitHub.Environment("Production", {
      owner: repository.owner,
      repository: repository.name,
      name: "Production",
      deploymentBranchPolicy: { customBranchPolicies: ["main"] },
    });

    yield* GitHub.Secret("CloudflareApiToken", {
      owner: repository.owner,
      repository: repository.name,
      name: "CLOUDFLARE_API_TOKEN",
      value: ciToken.value,
    });

    yield* GitHub.Secret("CloudflareAccountId", {
      owner: repository.owner,
      repository: repository.name,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: Redacted.make(accountId),
    });

    return {
      repository: `${repository.owner}/${repository.name}`,
      tokenName: ciToken.name,
    };
  }),
);
