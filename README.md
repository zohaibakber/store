# Store

Bun workspace for offline-first inventory: an Electron desktop app, a native
Android app, and a Cloudflare Worker API. Postgres is the
authoritative inventory database. PowerSync streams organization-scoped rows
into durable SQLite-backed TanStack DB collections on each client.

## Workspace boundaries

- `apps/android` is the native Kotlin + Jetpack Compose client (`com.tabaaq.mobile`).
  First slice: sign-in, Home / Products / Settings, catalog writes, and label
  scan. Setup is in `apps/android/README.md`.
- `apps/desktop` owns the complete Electron application: main process, preload,
  React renderer, Vite configuration, tests, and packaging. The renderer uses
  hash history, while the main process keeps encrypted
  refresh credentials in the main process. Main also proxies authenticated
  inventory HTTP. Live inventory SQLite is `@powersync/web` plus wa-sqlite in
  the renderer. There is no main-process
  PowerSync. Desktop requires sign-in before inventory.
- `apps/auth` is the first-party Cloudflare Worker for password, OTP, Google
  OAuth, access tokens, and refresh sessions.
- `apps/server/src` is the Worker API. It writes inventory commands to Postgres
  through Hyperdrive and issues authenticated PowerSync connection credentials.
- `packages/contracts` owns shared store and server contracts.
- `packages/client-db` owns the catalog replica (`openCatalog`), catalog writes,
  PowerSync schema and connector, row models, and Postgres mutation clients.
- `packages/db` owns the authentication and Postgres schemas.
- `packages/workspace` owns shared session HTTP and organization clients.
- `packages/auth` owns auth schemas, ES256 access tokens, password hashing, and
  the shared Effect HTTP client.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains.
Shared helpers stay next to the tests that use them, for example
`apps/desktop/test/lib`.

Desktop renderer components are grouped by feature. `components/app` owns the application
shell, `components/shared` holds reusable application components, and
`components/ui` is the registry-managed primitive layer.

Inventory reads come from TanStack DB live queries over PowerSync SQLite.
Electron opens that database in the renderer with `@powersync/web`.
Native Android uses `com.powersync:core`. Category, product, and batch
mutations are durably queued offline, uploaded through authenticated
`/api/inventory/*` commands, committed in Postgres, and streamed back by
PowerSync. The signed organization claim defines every sync stream.

## Run locally

```sh
vp install
vp run dev
```

Turborepo starts the API/auth Workers and the desktop workspace. The desktop's
plain `vp dev` task starts the renderer on `:5174`, builds main and preload, and
launches Electron. Use a Turbo filter when you only need one workspace.

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in
`alchemy.run.ts` and the `infra.ts` modules beside the code that owns each
resource. There are three isolated cloud stages: `dev`, `nightly`, and `prod`:

```sh
pnpm run plan:dev      # preview
pnpm run deploy:dev
pnpm run plan:nightly  # preview the shared pre-production stack
pnpm run deploy:nightly
pnpm run deploy:prod
```

Create gitignored `.env.dev`, `.env.nightly`, and `.env.prod` at the repository root. Give each
stage its own ES256 key pair, refresh and ephemeral peppers, and Google OAuth
credentials. Worker setup and stage details live in `apps/server/README.md`.

GitHub Actions verifies every change. Pull requests do not create Cloudflare
resources. A push to `nightly` deploys the isolated `nightly` stage, while a
push to `main` deploys `prod`. `alchemy deploy` deploys the API, auth, database,
and sync infrastructure. The renderer is built by the desktop release job.
Bootstrap its least-privilege Cloudflare
credentials once:

```sh
pnpm exec alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm run setup:ci
```

The bootstrap stack creates the `Development`, `Nightly`, and `Production` GitHub
environments and stores `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
repository secrets. Alchemy only binds Worker `Config` keys that are present in
the deploy job's environment, so GitHub must pass every auth setting the Worker
reads.

Each GitHub Environment must define:

- Secret `AUTH_JWT_PRIVATE_JWK` and variable `AUTH_JWT_PUBLIC_JWK`.
- Secrets `AUTH_REFRESH_TOKEN_PEPPER`, `AUTH_EPHEMERAL_PEPPER`, and
  `GOOGLE_OAUTH_CLIENT_SECRET`.
- Variable `GOOGLE_OAUTH_CLIENT_ID`.
- Variable `POWERSYNC_URL`, pointing to that stage's PowerSync endpoint.
- Variable `GOOGLE_OAUTH_NATIVE_CLIENT_IDS` (optional). Comma-separated iOS and
  Android OAuth client IDs, accepted as ID token audiences alongside the web
  client ID.
- Variables with code defaults (optional): `ELECTRON_PROTOCOL`
  (`com.tabaaq.desktop`), `MOBILE_PROTOCOL` (`com.tabaaq.mobile`),
  `AUTH_TRUSTED_ORIGINS` (comma-separated `https://` origins, bare hosts, or
  wildcard patterns), and `AUTH_DEV_OTP`. Blank values are treated as unset.

The `Nightly` and `Production` environments must also define these variables.
There is no domain baked into source. Published deploys fail if
`PRODUCTION_DOMAIN` is missing. In `Nightly`, the name still refers to that
environment's public hostname, not the production hostname.

- `PRODUCTION_DOMAIN`. Base hostname (example: `tabaaq.app`) used to derive the
  API and auth hostnames.
- `VITE_API_URL`. API origin (example: `https://api.tabaaq.app`) baked into the
  desktop release. If unset, the API hostname is `api.<PRODUCTION_DOMAIN>`.
- `VITE_AUTH_URL`. Auth origin (example: `https://auth.tabaaq.app`). If unset,
  the auth hostname is `auth.<PRODUCTION_DOMAIN>`.
- `AUTH_TRUSTED_ORIGINS`. Additional trusted origins for CORS and OAuth redirects.
- `ELECTRON_PROTOCOL` = `com.tabaaq.desktop` (optional; same default as the
  Worker).

Use a separate base hostname such as `nightly.tabaaq.app` for `Nightly`. Nightly
uses its own auth keys, peppers,
Postgres project, D1 database, KV namespace, and PowerSync endpoint.

Configure the Google OAuth client callback as
`https://auth.<domain>/v1/oauth/google/callback`. The auth Worker redirects back
to the desktop custom scheme after PKCE verification.

Android does not. It signs in through Google Identity Services, which presents
Google's account picker, and posts the resulting ID token to
`POST /v1/oauth/google/native`. The Worker verifies the token with Google and
issues the same session as every other route. That needs:

- An Android OAuth client in the same Google Cloud project, with package
  `com.tabaaq.mobile` and the signing SHA-1.
- `GOOGLE_WEB_CLIENT_ID` in `apps/android/local.properties` (the web client ID,
  so Google mints an ID token). Without it the app builds and hides the Google
  action. Release CI writes this from `GOOGLE_OAUTH_CLIENT_ID`.

The admin profile can mint API tokens. Use it only for this bootstrap stack.

Android release APKs run from `.github/workflows/android.yml` on a push to
`main` or `nightly`, and on `workflow_dispatch`. They build the Gradle app in
`apps/android`. Nightly builds remain 14-day workflow artifacts. The moving
`android` GitHub release is updated only from `main`. Nothing is submitted to
Google Play.

Desktop releases run from CI after a successful production deploy on
`main` via electron-builder (`electron-builder --publish always`). Each run
bumps the latest GitHub release patch and publishes a draft until Linux
artifacts are present. A version tag is no longer required.
`workflow_dispatch` on `.github/workflows/release.yml` remains for a manual
rebuild.

The `nightly` branch follows the same verified deploy-and-package path against
the `Nightly` GitHub Environment. Its desktop builds use SemVer versions such as
`0.3.78-nightly.412.1`, publish as GitHub prereleases, and read only the
`nightly` update feed. Stable desktop builds continue to read `latest`, so they
never install a nightly build. Promote tested work by merging `nightly` into
`main`.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged
desktop app with `vp run build:desktop` (electron-builder). Production
deploys run `pnpm exec alchemy deploy`, which serves the API from
`api.<PRODUCTION_DOMAIN>` and auth at `auth.<PRODUCTION_DOMAIN>`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
