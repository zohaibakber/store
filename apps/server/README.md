# Store API Worker

The Cloudflare Worker exposes:

- `GET /api/health`
- `GET|POST /api/auth/*`
- `POST /api/sync`
- `POST /api/uploads`
- `POST /api/product-scans`

Better Auth stores global identity and organization membership in D1 through `AUTH_DB`. Each
organization's inventory and sync log live in its own SQLite-backed Durable Object through
`ORGANIZATION_STORE`. The desktop communicates through authenticated HTTP. Foreground clients
poll `/api/sync` on a short interval; HTTP remains the data and correctness path.

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

`prod` serves from `https://tabaaq.zohaibakber.com` on the existing `zohaibakber.com` zone;
Cloudflare provisions the DNS record and certificate. Other stages stay on their generated
`workers.dev` URL. Because a custom domain takes precedence in `worker.url`, the stack's `apiUrl`
output is the right value to feed a desktop release regardless of stage.

Secrets come from `.env.dev` and `.env.prod` at the repository root (both gitignored — copy
`.env.example`). Use a **different** `BETTER_AUTH_SECRET` per stage: sharing one would make a
dev-issued session valid against production.

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
After bootstrap, add distinct `BETTER_AUTH_SECRET` values to the generated `Development` and
`Production` GitHub environments. Do not use the admin profile for ordinary deployments.

## Local development

```sh
vp run dev
```

The Worker runs locally in workerd on port 8787, which is the desktop's default API URL, so no
extra configuration is needed. Set `STORE_API_URL` for the desktop when pointing at another origin.
`VITE_API_URL` is reserved for packaged builds.

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

The live route uses the same Better Auth session and active-membership middleware as HTTP sync.
After authorization, the Worker forwards only trusted organization, user, device, and session
expiry metadata to the organization's Durable Object. The object accepts the socket through the
hibernation API, serializes that metadata as a socket attachment, and immediately sends a `hello`
cursor. A successful sync transaction that applied new operations broadcasts an `invalidate`
cursor after commit; failed and duplicate-only transactions broadcast nothing. Clients reconnect
with capped jittered backoff and always perform an HTTP pull after `hello`.
