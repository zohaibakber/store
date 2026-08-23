# Store

Bun workspace for offline-first inventory: a TanStack web app, an Electron
desktop app, an Expo mobile app, and a Cloudflare Worker API. Postgres is the
authoritative inventory database. Electric streams organization-scoped shapes
into persisted TanStack DB collections on each client.

## Workspace boundaries

- `apps/web` is the Vite + TanStack Router SPA (web-first, same model as T3 Code).
  Alchemy deploys it with `Cloudflare.Website.Vite` so the production hostname
  serves the app and `/api/*` on the same origin. Locally `alchemy dev` listens
  on `:5174`; standalone `vp dev` proxies `/api` to `:8787`.
- `apps/desktop` is the Electron shell. `electron` holds the main process and
  preload. It loads the web renderer with hash history, persists TanStack DB
  collections in SQLite, and keeps encrypted refresh credentials in the main
  process.
- `apps/auth` is the first-party Cloudflare Worker for password, OTP, Google
  OAuth, access tokens, and refresh sessions.
- `apps/server/src` is the Worker API. It writes inventory commands to Postgres
  through Hyperdrive and proxies authenticated Electric shape requests.
- `packages/contracts` owns shared store, server, and compatibility sync contracts.
- `packages/client-db` owns the shared Electric collection configuration, row
  models, and Postgres mutation clients.
- `packages/db` owns the authentication and Postgres schemas. Its Durable Object
  schema is preserved for compatibility and migration work.
- `packages/workspace` owns shared session HTTP and organization clients.
- `packages/auth` owns auth schemas, ES256 access tokens, password hashing, and
  the shared Effect HTTP client.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains.
Reusable fixtures and harnesses live under `test/lib`.

Web components are grouped by feature. `components/app` owns the application
shell, `components/shared` holds reusable application components, and
`components/ui` is the registry-managed primitive layer.

Inventory reads come from TanStack DB live queries. Browser clients persist
collections with WASQLite, Electron uses its SQLite persistence adapter, and
Expo uses its SQLite persistence adapter. Mutations go through authenticated
`/api/inventory/*` commands, commit in Postgres, and return through Electric
shapes. The Worker proxies `/api/electric/*` so the organization in the access
token defines every shape.

The original Cloudflare Durable Object, outbox, and `/api/sync/live` WebSocket
implementation remains in the repository as production compatibility and
migration source. It is not the active persistence path for migrated clients.
Do not delete that implementation, its schema, or its contracts until an
explicit retirement removes the remaining production dependency.

## Run locally

```sh
vp install
vp run dev:web
```

That starts the API Worker (`:8787`), auth Worker (`:8788`), and browser app
(`:5174`). Use `vp run dev:desktop` instead to run the same backend stack and
web renderer inside the Electron shell. The two commands are separate on
purpose: `apps/web` owns the renderer, while `apps/desktop` owns only Electron's
main process, preload bridge, packaging, and native integrations.

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in
`alchemy.run.ts` and the `infra.ts` modules beside the code that owns each
resource. There are two isolated cloud stages, `dev` and `prod`:

```sh
pnpm run plan:dev      # preview
pnpm run deploy:dev
pnpm run deploy:prod
```

Create gitignored `.env.dev` and `.env.prod` at the repository root. Give each
stage its own ES256 key pair, refresh and ephemeral peppers, and Google OAuth
credentials. Worker setup and stage details live in `apps/server/README.md`.

GitHub Actions verifies every change. Pull requests do not create Cloudflare
resources. A push to `main` deploys `prod`. `alchemy deploy` builds the SPA.
CI does not run a separate Vite build. Bootstrap its least-privilege Cloudflare
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
domain baked into source. Prod deploys fail if `PRODUCTION_DOMAIN` is missing.

- `PRODUCTION_DOMAIN`. Site hostname only (example: `tabaaq.app`). Website Worker.
- `VITE_API_URL`. API origin (example: `https://api.tabaaq.app`). Desktop and the
  production SPA. If unset, the API hostname is `api.<PRODUCTION_DOMAIN>`.
- `VITE_AUTH_URL`. Auth origin (example: `https://auth.tabaaq.app`). If unset,
  the auth hostname is `auth.<PRODUCTION_DOMAIN>`.
- `AUTH_TRUSTED_ORIGINS`. Site origin for CORS and OAuth redirects.
- `EXPO_PUBLIC_API_URL`. Same origin as `VITE_API_URL`. The mobile app reads it.
- `EXPO_PUBLIC_AUTH_URL`. Same origin as `VITE_AUTH_URL`.
  The EAS production profile uses the EAS `production` environment, not GitHub
  vars.
- `ELECTRON_PROTOCOL` = `com.tabaaq.desktop` (optional; same default as the
  Worker).

Configure the Google OAuth client callback as
`https://auth.<domain>/v1/oauth/google/callback`. The auth Worker redirects back
to the trusted web origin or native custom scheme after PKCE verification. Web
and desktop use that redirect flow.

Mobile does not. It signs in through Google's own SDK, which presents Google's
account picker, and posts the resulting ID token to
`POST /v1/oauth/google/native`. The Worker verifies the token with Google and
issues the same session as every other route. That needs:

- OAuth clients of type iOS and Android in the same Google Cloud project, with
  the mobile bundle ID / package name and the Android signing SHA-1.
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the web client ID, so Google mints an ID
  token) and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` at build time. The iOS client ID
  becomes the reversed URL scheme when `expo prebuild` runs the config plugin.
- A development build or a release build. The SDK is native code, so Expo Go
  cannot run it. Without `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` the app builds fine
  and hides the Google action.

The admin profile can mint API tokens. Use it only for this bootstrap stack.

Android EAS builds run from `.github/workflows/android.yml` on a push to
`main` and on `workflow_dispatch`, and from the Expo GitHub app if that is
connected. They stay on Expo as an internal APK. Nothing is submitted to
Google Play. GitHub Actions `eas` still needs repository secret `EXPO_TOKEN`;
builds started by the Expo GitHub app do not.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged
desktop app with `vp run build`. Production deploys run `pnpm exec alchemy deploy`,
which serves the SPA from `PRODUCTION_DOMAIN` and the API from
`api.<PRODUCTION_DOMAIN>`, with auth at `auth.<PRODUCTION_DOMAIN>`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
