# Store Electron

This Bun-workspace monorepo contains an offline-first Electron app built with Clerk,
Effect, Drizzle ORM, libSQL, and Cloudflare Workers.

## Workspace boundaries

- `apps/desktop/src` contains the React renderer; `electron` contains the main process and preload.
- `apps/server/src` contains the Worker API and per-organization Durable Object sync service.
- `packages/contracts` owns shared store, server, and sync contracts.
- `packages/db` owns local, Durable Object, and authentication database schemas.
- `packages/persistence` owns local libSQL access, inventory stores, analytics, and sync.
- `packages/sync-client` owns the framework-neutral Effect coordinator, retries,
  page draining, and sync status state machine used by local replica adapters.
- `packages/auth` owns Clerk token verification and the Durable Object org-id binding.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains. Reusable test
fixtures and harnesses live under `test/lib`.

Desktop components are grouped by feature. `components/app` owns the application shell,
`components/shared` holds reusable application components, and `components/ui` remains the
registry-managed primitive layer.

Local business transactions commit an outbox operation alongside their data. A shared single-flight
sync runtime pushes those operations through the authenticated Worker and transactionally pulls the
organization's ordered change feed. Foreground clients poll HTTP on a short interval. Network
failures leave local writes pending in strict FIFO order.

## Run locally

```sh
vp install
vp run dev
```

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in `alchemy.run.ts` and
the `infra.ts` modules beside the code that owns each resource. There are two isolated cloud
stages, `dev` and `prod`:

```sh
bun run plan:dev      # preview
bun run deploy:dev
bun run deploy:prod
```

Copy `.env.example` to `.env.dev` and `.env.prod` (both gitignored) and give each stage its own
`CLERK_SECRET_KEY`. The Worker setup and stage details are documented in `apps/server/README.md`.
An authenticated user can continue using a previously opened organization offline; a first sign-in
and organization creation require the API.

Existing Durable Object inventory is preserved across the Clerk migration: the Worker binds each
Clerk organization to the Better Auth organization id that already names `ORGANIZATION_STORE`.
The first Clerk organization that authenticates for an email inherits that store; later Clerk
orgs get new empty Durable Objects. Do not rename the Durable Object class or pass Clerk org
ids into `getByName`.

GitHub Actions verifies every change, deploys each same-repository pull request to an isolated
`pr-<number>` stage, comments its API URL on the pull request, removes that stage when the pull
request closes, and deploys `main` to `prod`. Bootstrap its least-privilege Cloudflare credentials
once:

```sh
bun alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:ci
```

The bootstrap stack creates the `Development` and `Production` GitHub environments and stores
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. Alchemy only binds
Worker `Config` keys that are present in the deploy job's environment, so GitHub must pass
every auth setting the Worker reads.

Each GitHub Environment must define:

- **Secret:** `CLERK_SECRET_KEY` from the Clerk Dashboard. Use a different Clerk instance (or
  at least a different secret) per environment.
- **Variables (optional, have code defaults):** `ELECTRON_PROTOCOL` (`com.tabaaq.desktop`),
  `MOBILE_PROTOCOL` (`com.tabaaq.mobile`), `AUTH_TRUSTED_ORIGINS` (comma-separated `https://`
  origins), `CLERK_JWT_AUDIENCE` if you mint a custom JWT template. Blank values are treated as
  unset.
- **Optional secret:** `CLERK_JWT_KEY` (PEM) for networkless JWT verify.

The `Production` environment must also define these **variables** for desktop releases:

- `VITE_API_URL` = `https://tabaaq.zohaibakber.com`
- `VITE_CLERK_PUBLISHABLE_KEY` = the Clerk publishable key
- `ELECTRON_PROTOCOL` = `com.tabaaq.desktop` (optional; same default as the Worker)
- `VITE_CLERK_JWT_TEMPLATE` if you created a JWT template (optional)

The admin profile can mint API tokens and should only be used for this bootstrap stack.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged desktop app with
`vp run build`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
