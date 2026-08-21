# Store API Worker

The Cloudflare Worker exposes:

- `GET /api/health`
- `GET /api/auth/session` (and `GET /api/auth/get-session`)
- `GET /api/sync/live` (WebSocket upgrade)
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions live
in D1. Each organization's inventory and sync log live in its own SQLite-backed
Durable Object through `ORGANIZATION_STORE`.
The desktop communicates through authenticated HTTP and a hibernated WebSocket.
Foreground clients exchange on the live socket. The Durable Object `exchange`
is the same transaction the socket frames call.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run), not
in a `wrangler.jsonc`. The Worker, its bindings, and the local dev port live in
`infra.ts`. The D1 database and its migrations live in
`packages/db/src/auth/infra.ts`. `alchemy.run.ts` at the repository root
composes them into one stack.

`infra.ts` attaches D1, Workers AI, rate limiting, and the organization Durable
Object through Alchemy's Effect-native binding services. HTTP handlers consume a
small typed runtime service, so route code never reaches into a raw Worker `env`
object.

## Stages

Two stages, fully isolated from each other. Separate Worker, D1 database,
Durable Object namespace, and state. Run these from the repository root:

```sh
bun run plan:dev      # preview changes without applying
bun run deploy:dev
bun run plan:prod
bun run deploy:prod
```

**Always pass a stage.** A bare `alchemy deploy` silently creates a personal
`dev_$USER` stage, which is why every script above pins one explicitly.

`prod` serves the SPA from `PRODUCTION_DOMAIN` (example: `tabaaq.app`) and the
API from `api.<PRODUCTION_DOMAIN>` (example: `api.tabaaq.app`) on that zone via
Alchemy. Cloudflare provisions DNS and certificates. Other stages stay on
generated `workers.dev` URLs. Desktop and mobile call `VITE_API_URL` /
`EXPO_PUBLIC_API_URL` (the API origin). Production browsers do the same. Locally
the Website Worker still proxies `/api/*` so `vp run dev` stays same-origin.

`bun alchemy deploy` builds `apps/web` itself. No separate `vite build` in CI.
Deep links fall back to `index.html`. Apex and API are different hostnames, so
one deploy attaches both.

Secrets come from gitignored `.env.dev` and `.env.prod` at the repository root.
Use a different JWT key pair and peppers per stage.

First-time setup on a new machine:

```sh
bun alchemy login
```

## CI/CD

GitHub Actions uses the same remote state store as local deploys. A push to
`main` deploys `prod`. Same-repository pull requests deploy isolated
`pr-<number>` stages and receive an updating preview comment. Closing a pull
request destroys its preview resources. Fork pull requests still run all checks
but do not receive deployment credentials.

Bootstrap the CI token and GitHub environments once from an admin profile:

```sh
bun alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:ci
```

`stacks/github.ts` scopes the resulting account-owned token to the Worker, D1,
and remote-state operations used by this stack, then writes the token and
account ID directly to GitHub Actions. Do not use the admin profile for ordinary
deployments.

Alchemy binds every `Config` read during Worker Init from the deploy job's
process env. CI must pass those keys from the GitHub Environment. After
bootstrap, set:

**Both `Development` and `Production` environments**

- Secret `AUTH_JWT_PRIVATE_JWK`. ES256 private JWK, unique per stage.
- Variable `AUTH_JWT_PUBLIC_JWK`. Matching ES256 public JWK.
- Secrets `AUTH_REFRESH_TOKEN_PEPPER` and `AUTH_EPHEMERAL_PEPPER`.
- Variable `GOOGLE_OAUTH_CLIENT_ID` and secret `GOOGLE_OAUTH_CLIENT_SECRET`.
- Variable `AUTH_DEV_OTP`. Set only in development when the OTP should be
  returned to the client and development logs.
- Variable `ELECTRON_PROTOCOL`. Optional, default `com.tabaaq.desktop`.
- Variable `MOBILE_PROTOCOL`. Optional, default `com.tabaaq.mobile`.
- Variable `AUTH_TRUSTED_ORIGINS`. Optional comma-separated HTTPS origins. A
  bare host (`app.example.com`) is read as `https://app.example.com`, and
  wildcard patterns (`*.example.com`, `https://*.example.com`) work too. Custom
  schemes belong in the protocol vars. A value that cannot be used, such as
  plain HTTP outside local development, a path, or a pattern broad enough to
  match origins this deployment does not own, is ignored rather than trusted,
  and logged as `auth.setting_rejected`. Sign-in keeps working from the origins
  that remain.

**`Production` environment only**

- Variable `PRODUCTION_DOMAIN`. Site hostname only (example: `tabaaq.app`).
  Required.
- Variable `PRODUCTION_API_DOMAIN`. Optional API hostname. Default
  `api.<PRODUCTION_DOMAIN>`.
- Variable `PRODUCTION_AUTH_DOMAIN`. Optional auth hostname. Default
  `auth.<PRODUCTION_DOMAIN>`.
- Variable `VITE_API_URL`. API origin (example: `https://api.tabaaq.app`).
- Variable `VITE_AUTH_URL`. Auth origin (example: `https://auth.tabaaq.app`).
- Variable `AUTH_TRUSTED_ORIGINS`. Site origin for CORS and OAuth redirects.
- Variable `EXPO_PUBLIC_API_URL`. Same origin as `VITE_API_URL` for EAS / mobile.
- Variable `EXPO_PUBLIC_AUTH_URL`. Same origin as `VITE_AUTH_URL`.
- Variable `ELECTRON_PROTOCOL` = `com.tabaaq.desktop`.

Unset GitHub variables interpolate as empty strings. The Worker treats blank
protocol and origin values as missing so they cannot override the defaults.
Missing auth credentials fail the deploy job before Alchemy runs.

## Local development

```sh
vp run dev
```

The Worker runs locally in workerd on port 8787, which is the desktop's default
API URL, so no extra configuration is needed. Set `STORE_API_URL` for the
desktop when pointing at another origin. `VITE_API_URL` is reserved for packaged
desktop builds and production web. The web SPA on `:5174` leaves `VITE_API_URL`
empty and talks to `/api` through the Website Worker (or Vite's proxy in
standalone `vp dev`).

`alchemy dev` runs your code locally but uses real cloud D1 and Durable Objects
from the `dev` stage. There is no local emulation, so this loop needs network
access.

The Worker's compatibility date is capped by the workerd binary that
`alchemy dev` runs locally, which is pinned exactly by alchemy's dev runtime and
lags Cloudflare's edge. Raising the date past what that binary supports breaks
`vp run dev` with a `WorkerdUserScript` config error while deploys keep
succeeding. Bump it only when alchemy's bundled workerd moves.

## Migrations

Auth D1 migrations are part of the deploy graph. `Drizzle.Schema` regenerates
pending SQL from `packages/db/src/auth/schema.ts` and the D1 resource applies it
before the Worker rolls out. Edit the schema, run a deploy, then review and
commit the generated files under `packages/db/migrations/auth`. Do not run
`drizzle-kit generate` for the auth schema by hand. The deploy owns it.
`db:generate` still owns the local and Durable Object schemas.

Durable Object schema migrations are bundled from `packages/db/migrations/do`
into `packages/db/src/do/migrations.ts` and applied when an organization runtime
starts. Alchemy owns the DO namespace and class lifecycle. The application owns
the SQL inside each object.

## Sync model

The authenticated session supplies the authoritative organization and user. The
sync module validates operation identity and payload hashes before committing a
request in one Durable Object SQLite transaction.

`sync_inbox` makes retries idempotent. `sync_change_log` stores accepted
snapshots and tombstones, and protocol-v2 responses return byte-limited
organization pages with `nextCursor`, `headCursor`, and `hasMore`.
`sync_devices` records authenticated device checkpoints used for diagnostics and
future retention decisions.

The live route uses the same first-party session and membership middleware as
HTTP sync. Browsers pass `access_token` on the upgrade query because they cannot
set WebSocket headers; Electron sends `Authorization` and `electron-origin`.
After authorization, the Worker forwards only trusted organization, user, device,
and session expiry metadata to the organization's Durable Object. The object
accepts the socket through the hibernation API, serializes that metadata as a
socket attachment, and immediately sends a `hello` cursor.

Client frames on that socket are `exchange` (protocol-v2 `SyncRequest`) and
sparse `ping`. Server frames are `hello`, `invalidate`, `exchange-result`,
`exchange-error`, and `pong`. A successful sync transaction that applied new
operations broadcasts an `invalidate` cursor after commit, skipping the
originating connection. Failed and duplicate-only transactions broadcast
nothing. Clients reconnect with capped jittered backoff. A hello always pulls.
Inbox idempotency makes a timed-out socket exchange followed by a retry
safe.
