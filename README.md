# Store

Bun workspace for an offline-first inventory stack: a TanStack web app, an
Electron desktop app, and a Cloudflare Worker API. Inventory written in the
browser, on desktop, or on mobile syncs through the same authenticated
live socket at `/api/sync/live`.

## Workspace boundaries

- `apps/web` is the Vite + TanStack Router SPA (web-first, same model as T3 Code).
  Alchemy deploys it with `Cloudflare.Website.Vite` so the production hostname
  serves the app and `/api/*` on the same origin. Locally `alchemy dev` listens
  on `:5174`; standalone `vp dev` proxies `/api` to `:8787`.
- `apps/desktop` is the Electron shell. `electron` holds the main process and
  preload. It loads the web renderer with hash history and keeps native libSQL
  plus encrypted refresh credentials in the main process.
- `apps/auth` is the first-party Cloudflare Worker for password, OTP, Google
  OAuth, access tokens, and refresh sessions.
- `apps/server/src` is the Worker API and the per-organization Durable Object
  sync service.
- `packages/contracts` owns shared store, server, and sync contracts.
- `packages/db` owns local, Durable Object, and authentication database schemas.
- `packages/persistence` owns local libSQL access, inventory stores, analytics,
  and sync. The browser replica lives at `@store/persistence/browser` (WASM/OPFS).
  Node and Electron import the package root.
- `packages/workspace` owns the authenticated workspace runtime shared by desktop
  and web.
- `packages/sync-client` owns the Effect coordinator, retries, page draining, and
  sync status state machine used by local replica adapters.
- `packages/auth` owns auth schemas, ES256 access tokens, password hashing, and
  the shared Effect HTTP client.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains.
Reusable test fixtures and harnesses live under `test/lib`.

Web components are grouped by feature. `components/app` owns the application
shell, `components/shared` holds reusable application components, and
`components/ui` is the registry-managed primitive layer.

Local business transactions commit an outbox operation alongside their data. A
shared single-flight sync runtime pushes those operations through an
authenticated Worker and pulls the organization's ordered change feed in the same
Durable Object transaction. Foreground web and desktop clients keep a hibernated
WebSocket at `/api/sync/live` for correlated exchanges and invalidation. Network
failures leave local writes pending in FIFO order; retryable
transport errors do not burn the outbox toward quarantine.

## Run locally

```sh
vp install
vp run dev
```

That starts the API Worker (`:8787`), auth Worker (`:8788`), desktop
Vite/Electron renderer (`:5173`), and web SPA (`:5174`). Sign-in is optional.
Local inventory works without an account; authenticated writes sync through
`/api/sync/live`.

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in
`alchemy.run.ts` and the `infra.ts` modules beside the code that owns each
resource. There are two isolated cloud stages, `dev` and `prod`:

```sh
bun run plan:dev      # preview
bun run deploy:dev
bun run deploy:prod
```

Copy `.env.example` to `.env.dev` and `.env.prod`. Give each stage its own ES256
key pair, refresh and ephemeral peppers, and Google OAuth credentials. Worker
setup and stage details live in `apps/server/README.md`.

GitHub Actions verifies every change, deploys each same-repository pull request
to an isolated `pr-<number>` stage, comments its Website URL on the pull request,
removes that stage when the pull request closes, and deploys `main` to `prod`.
`alchemy deploy` builds the SPA. CI does not run a separate Vite build. Bootstrap
its least-privilege Cloudflare credentials once:

```sh
bun alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:ci
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
to the trusted web origin or native custom scheme after PKCE verification.

The admin profile can mint API tokens. Use it only for this bootstrap stack.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged
desktop app with `vp run build`. Production deploys run `bun alchemy deploy`,
which serves the SPA from `PRODUCTION_DOMAIN` and the API from
`api.<PRODUCTION_DOMAIN>`, with auth at `auth.<PRODUCTION_DOMAIN>`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
