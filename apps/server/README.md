# Store API Worker

The Cloudflare Worker exposes:

- `GET /api/health`
- `GET /api/auth/session` (and `GET /api/auth/get-session`)
- `POST /api/sync`
- `POST /api/uploads`
- `POST /api/product-scans`

Clerk verifies session JWTs (`Authorization: Bearer`). D1 `AUTH_DB` keeps only a
`clerk_org_binding` table so migrated Clerk organizations retain their existing Durable Object
names. Each organization's
inventory and sync log live in its own SQLite-backed Durable Object through
`ORGANIZATION_STORE` — named by the **store** organization id, never the Clerk org id.
The desktop communicates through authenticated HTTP. Foreground clients poll `/api/sync`
on a short interval; HTTP remains the data and correctness path.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run), not in a
`wrangler.jsonc`. The Worker, its bindings, and the local dev port live in `infra.ts`; the D1
database and its migrations live in `packages/db/src/auth/infra.ts`; `alchemy.run.ts` at the
repository root composes them into one stack.

`infra.ts` attaches D1, Workers AI, rate limiting, and the organization Durable Object through
Alchemy's Effect-native binding services. HTTP handlers consume a small typed runtime service, so
route code never reaches into a raw Worker `env` object.

## Stages

Two stages, fully isolated from each other — separate Worker, D1 database, Durable
Object namespace, and state. Run these from the repository root:

```sh
bun run plan:dev      # preview changes without applying
bun run deploy:dev
bun run plan:prod
bun run deploy:prod
```

**Always pass a stage.** A bare `alchemy deploy` silently creates a personal `dev_$USER` stage,
which is why every script above pins one explicitly.

`prod` serves the SPA from `PRODUCTION_DOMAIN` (example: `tabaaq.app`) and the API
from `api.<PRODUCTION_DOMAIN>` (example: `api.tabaaq.app`) on that zone via Alchemy.
Cloudflare provisions DNS and certificates. Other stages stay on generated
`workers.dev` URLs. Desktop and mobile call `VITE_API_URL` / `EXPO_PUBLIC_API_URL`
(the API origin). Production browsers do the same; locally the Website Worker still
proxies `/api/*` so `vp run dev` stays same-origin.

`bun alchemy deploy` builds `apps/web` itself (no separate `vite build` in CI). Deep links fall
back to `index.html`. Apex and API are different hostnames, so one deploy attaches both.

Secrets come from `.env.dev` and `.env.prod` at the repository root (both gitignored — copy
`.env.example`). Use a **different** `CLERK_SECRET_KEY` per stage.

First-time setup on a new machine:

```sh
bun alchemy login
```

## CI/CD

GitHub Actions uses the same remote state store as local deploys. A push to `main` deploys `prod`;
same-repository pull requests deploy isolated `pr-<number>` stages and receive an updating preview
comment; closing a pull request destroys its preview resources. Fork pull requests still run all
checks but do not receive deployment credentials.

Bootstrap the CI token and GitHub environments once from an admin profile:

```sh
bun alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:ci
```

`stacks/github.ts` scopes the resulting account-owned token to the Worker, D1, and remote-state
operations used by this stack, then writes the token and account ID directly to GitHub Actions.
Do not use the admin profile for ordinary deployments.

Alchemy binds every `Config` read during Worker Init from the deploy job's process env. CI
must pass those keys from the GitHub Environment. After bootstrap, set:

**Both `Development` and `Production` environments**

- Secret `CLERK_SECRET_KEY` — required, unique per Clerk instance/stage
- Secret `CLERK_JWT_KEY` — optional PEM for networkless JWT verify
- Variable `CLERK_JWT_AUDIENCE` — optional; must match a Clerk JWT template audience
- Variable `ELECTRON_PROTOCOL` — optional, default `com.tabaaq.desktop`
- Variable `MOBILE_PROTOCOL` — optional, default `com.tabaaq.mobile`
- Variable `AUTH_TRUSTED_ORIGINS` — optional comma-separated HTTPS origins. A bare host
  (`app.example.com`) is read as `https://app.example.com`, and wildcard patterns
  (`*.example.com`, `https://*.example.com`) work too. Custom schemes belong in the protocol
  vars. A value that cannot be used — plain HTTP outside local development, a path, a pattern
  broad enough to match origins this deployment does not own — is ignored rather than trusted,
  and logged as `auth.setting_rejected`. Sign-in keeps working from the origins that remain.

**`Production` environment only**

- Variable `PRODUCTION_DOMAIN` — site hostname only (example: `tabaaq.app`). Required.
- Variable `PRODUCTION_API_DOMAIN` — optional API hostname. Default `api.<PRODUCTION_DOMAIN>`.
- Variable `VITE_API_URL` — API origin (example: `https://api.tabaaq.app`)
- Variable `AUTH_TRUSTED_ORIGINS` — site origin (example: `https://tabaaq.app`) for CORS / Clerk
- Variable `VITE_CLERK_PUBLISHABLE_KEY`
- Variable `VITE_CLERK_JWT_TEMPLATE` — optional
- Variable `EXPO_PUBLIC_API_URL` — same origin as `VITE_API_URL` for EAS / mobile
- Variable `ELECTRON_PROTOCOL` = `com.tabaaq.desktop`

Unset GitHub variables interpolate as empty strings. The Worker treats blank protocol and
origin values as missing so they cannot override the defaults. A missing
`CLERK_SECRET_KEY` fails the deploy job before Alchemy runs.

## Local development

```sh
vp run dev
```

The Worker runs locally in workerd on port 8787, which is the desktop's default API URL, so no
extra configuration is needed. Set `STORE_API_URL` for the desktop when pointing at another origin.
`VITE_API_URL` is reserved for packaged desktop builds and production web. The web SPA on `:5174` leaves
`VITE_API_URL` empty and talks to `/api` through the Website Worker (or Vite's proxy in
standalone `vp dev`).

Note that `alchemy dev` runs your _code_ locally but uses **real** cloud D1 and Durable
Objects from the `dev` stage — there is no local emulation, so this loop needs network access.

The Worker's compatibility date is capped by the workerd binary that `alchemy dev` runs locally,
which is pinned exactly by alchemy's dev runtime and lags Cloudflare's edge. Raising the date past
what that binary supports breaks `vp run dev` with a `WorkerdUserScript` config error while deploys
keep succeeding — so bump it only when alchemy's bundled workerd moves.

## Migrations

Auth D1 migrations are part of the deploy graph: `Drizzle.Schema` regenerates pending SQL from
`packages/db/src/auth/schema.ts` and the D1 resource applies it before the Worker rolls out. Edit
the schema, run a deploy, then review and commit the generated files under
`packages/db/migrations/auth`. Do not run `drizzle-kit generate` for the auth schema by hand — the
deploy owns it. `db:generate` still owns the local and Durable Object schemas.

Durable Object schema migrations are bundled from `packages/db/migrations/do` into
`packages/db/src/do/migrations.ts` and applied when an organization runtime starts. Alchemy owns
the DO namespace and class lifecycle; the application owns the SQL inside each object.

## Sync model

The authenticated session supplies the authoritative organization and user. The sync module
validates operation identity and payload hashes before committing a request in one Durable Object
SQLite transaction.

`sync_inbox` makes retries idempotent. `sync_change_log` stores accepted snapshots and tombstones,
and protocol-v2 responses return byte-limited organization pages with `nextCursor`, `headCursor`,
and `hasMore`. `sync_devices` records authenticated device checkpoints used for diagnostics and
future retention decisions.

The live route uses the same Clerk session and active-membership middleware as HTTP sync.
After authorization, the Worker forwards only trusted organization, user, device, and session
expiry metadata to the organization's Durable Object. The object accepts the socket through the
hibernation API, serializes that metadata as a socket attachment, and immediately sends a `hello`
cursor. A successful sync transaction that applied new operations broadcasts an `invalidate`
cursor after commit; failed and duplicate-only transactions broadcast nothing. Clients reconnect
with capped jittered backoff and always perform an HTTP pull after `hello`.
