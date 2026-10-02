# Store

pnpm workspace for offline-first inventory: an Electron desktop app, the same
renderer as a web app, an Expo Android app, and Cloudflare Worker API and auth
services. Inventory commands commit in Postgres through Hyperdrive. The system
design is in [`docs/architecture.md`](docs/architecture.md).

## Workspace boundaries

- `apps/web` owns the product UI: the React app, routes, components, styles,
  and the host contract (`src/host`) that says what a host must provide. It
  builds and deploys alone as a browser SPA: an HttpOnly refresh cookie, an
  in-memory access token, and the IndexedDB replica. It never imports from
  `apps/desktop`.
- `apps/desktop` owns the Electron shell: main process, preload, workers,
  updater, tests, and packaging. It uses the web app as its renderer and
  implements the host contract, importing only `@store/web/host/*` and
  `@store/web/vite`. The renderer uses hash history; the main process keeps
  encrypted refresh credentials and proxies authenticated sync HTTP. Live
  inventory is the local replica, owned by a main-process worker on
  `@effect/sql-sqlite-node` over `node:sqlite`. The renderer never sees SQL.
- `apps/mobile` is the Expo Android app. Its replica is op-sqlite through
  `@effect/sql-sqlite-react-native`.
- `apps/auth` is the first-party Cloudflare Worker for password, OTP, Google
  OAuth, access tokens, and refresh sessions.
- `apps/server/src` is the Worker API. `/api/sync/*` commits inventory commands
  in Postgres through Hyperdrive.
- `packages/contracts` owns shared store and server contracts.
- `packages/client-db` owns the replica handles hosts open, catalog writes,
  row models, and the reactive collections the renderer reads.
- `packages/db` owns the authentication, Postgres authority, and replica
  schemas and their migrations.
- `packages/sync` owns the host-agnostic replica engine: command outbox,
  pending projections, coverage, the polling scheduler, and the typed
  `SyncHttpApi` client. Its shared entrypoint (`@store/sync`) is native-free;
  the SQLite adapter lives behind `@store/sync/sqlite` and the IndexedDB
  adapter behind `@store/sync/replica/indexeddb`.
- `packages/inventory-react` owns the React bindings over the replica shared by
  the desktop renderer and mobile.
- `packages/workspace` owns shared session HTTP and organization clients.
- `packages/auth` owns auth schemas, ES256 access tokens, password hashing, and
  the shared Effect HTTP client.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains.
Shared helpers stay next to the tests that use them. `apps/web` has no unit
tests; the UI is tested end to end by hand.

Web app components are grouped by feature. `components/app` owns the application
shell, `components/shared` holds reusable application components, and
`components/ui` is the registry-managed primitive layer.

Desktop inventory reads come from TanStack DB live queries over the local
replica. Analytics use one bounded aggregate read instead: the replica groups
sales by product and local day (`readInsights`), and `@store/services/insights`
turns those facts into forecasts, reorder points, and ranked alerts. Sales (`issueInvoice`) and catalog changes (`catalogWrite`) are both
sync commands: they commit locally first, project pending rows, then upload to
`/api/sync/commands`, where one organization-locked PostgreSQL transaction
decides them and appends to the change log that `/api/sync/pull` serves.
Replicas hard-delete on a `delete` change. The signed organization claim scopes
every pull.

## Run locally

```sh
vp install
vp run dev
```

`vp run` starts the API/auth Workers and the desktop workspace in parallel. The
desktop's plain `vp dev` task serves the web app as its renderer on `:5174`,
builds main and preload, and launches Electron. Use `vp run @store/desktop#dev` when you only
need one workspace.

```sh
vp run dev:web
```

That starts the same Workers and serves `apps/web` in the browser on
`http://localhost:5174`.

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in
`alchemy.run.ts` and the `infra.ts` modules beside the code that owns each
resource. There are two isolated cloud stages, `dev` and `prod`:

```sh
pnpm run plan:dev      # preview
pnpm run deploy:dev
pnpm run plan:prod
pnpm run deploy:prod
```

Create gitignored `.env.dev` and `.env.prod` at the repository root. Give each
stage its own ES256 key pair, refresh and ephemeral peppers, and Google OAuth
credentials. Worker setup and stage details live in `apps/server/README.md`.

GitHub Actions verifies every change. Pull requests do not create or update
Cloudflare resources. Every push to `main` deploys the production API, auth,
database, and edge rules, then publishes the desktop release.

Bootstrap its least-privilege Cloudflare
credentials once:

```sh
pnpm exec alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm run setup:ci
```

The bootstrap stack creates the `Development` and `Production` GitHub
environments and stores `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
repository secrets. Alchemy only binds Worker `Config` keys that are present in
the deploy job's environment, so GitHub must pass every auth setting the Worker
reads.

Each GitHub Environment must define:

- Secret `AUTH_JWT_PRIVATE_JWK` and variable `AUTH_JWT_PUBLIC_JWK`.
- Secrets `AUTH_REFRESH_TOKEN_PEPPER`, `AUTH_EPHEMERAL_PEPPER`, and
  `GOOGLE_OAUTH_CLIENT_SECRET`.
- Variable `GOOGLE_OAUTH_CLIENT_ID`.
- Variable `GOOGLE_OAUTH_NATIVE_CLIENT_IDS` (optional). Comma-separated iOS and
  Android OAuth client IDs, accepted as ID token audiences alongside the web
  client ID.
- Variables with code defaults (optional): `ELECTRON_PROTOCOL`
  (`com.tabaaq.desktop`), `MOBILE_PROTOCOL` (`com.tabaaq.mobile`),
  `AUTH_TRUSTED_ORIGINS` (comma-separated `https://` origins, bare hosts, or
  wildcard patterns), and `AUTH_DEV_OTP`. Blank values are treated as unset.

The `Production` environment must also define these variables. There is no
domain baked into source. Published deploys fail if `PRODUCTION_DOMAIN` is
missing.

- `PRODUCTION_DOMAIN`. Base hostname (example: `tabaaq.app`). It serves the web
  app and derives the API and auth hostnames.
- `VITE_API_URL`. API origin (example: `https://api.tabaaq.app`) baked into the
  desktop release. If unset, the API hostname is `api.<PRODUCTION_DOMAIN>`.
- `VITE_AUTH_URL`. Auth origin (example: `https://auth.tabaaq.app`). If unset,
  the auth hostname is `auth.<PRODUCTION_DOMAIN>`.
- `AUTH_TRUSTED_ORIGINS`. Additional trusted origins for CORS and OAuth redirects.
- `ELECTRON_PROTOCOL` = `com.tabaaq.desktop` (optional; same default as the
  Worker).

Configure the Google OAuth client callback as
`https://auth.<domain>/v1/oauth/google/callback`. The auth Worker redirects back
to the desktop custom scheme, or to the web app's `/sign-in`, after PKCE
verification.

The admin profile can mint API tokens. Use it only for this bootstrap stack.

Desktop releases are built by electron-builder
(`electron-builder --publish always`) alongside each production deploy. Each
run bumps the latest GitHub release patch and uploads a draft, which CI
publishes once both the deploy and the Linux artifacts succeed, or deletes if
the deploy fails. `workflow_dispatch` on `.github/workflows/release.yml`
remains available for a packaging-only rebuild; it does not deploy
infrastructure.

Run all workspace checks with `vp check`, `vp run -r check` (Drizzle schema
and migration bundle), and `vp test`, or produce the packaged
desktop app with `vp run build:desktop` (electron-builder). Production
deploys run `pnpm exec alchemy deploy`, which serves the web app from
`PRODUCTION_DOMAIN`, the API from `api.<PRODUCTION_DOMAIN>`, and auth at
`auth.<PRODUCTION_DOMAIN>`. The `dev` stage has no web app deployment; use
`vp run dev:web`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
