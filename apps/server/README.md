# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session` and `GET /api/auth/get-session`
- `GET /api/powersync/credentials`
- `POST /api/inventory/mutations`
- `POST /api/inventory/imports`
- `POST /api/inventory/invoices`
- `POST /api/sync/commands`, `POST /api/sync/replicas`, `POST /api/sync/pull`
- `POST /api/sync/snapshots`, `POST /api/sync/live-tickets`
- `GET /api/sync/live` (WebSocket upgrade)
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions
live in D1.

Nightly desktop inventory is authoritative in the organization Durable Object.
The Worker authenticates each `/api/sync/commands` call, commits it in one
SQLite transaction on that object, and returns the receipt. Catalog writes on
that path are unsupported. `dev` and `prod` still keep Neon Postgres as
authority for `/api/inventory/*` and PowerSync. Nightly skips Neon and
PowerSync.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and inventory
Postgres project into one stack.

Alchemy provisions the auth D1 database, Workers AI, organization Durable
Objects, an R2 snapshot bucket, and a product-scan rate limiter on every
published stage. `dev` and `prod` also provision Neon Postgres and Hyperdrive.
PowerSync receives that direct Neon connection; Worker catalog commands use
Hyperdrive for pooled Postgres access. Nightly skips Neon and PowerSync.

Run deployments from the repository root and always pass a stage:

```sh
pnpm run plan:dev
pnpm run deploy:dev
pnpm run plan:nightly
pnpm run deploy:nightly
pnpm run plan:prod
pnpm run deploy:prod
```

Secrets come from gitignored `.env.dev`, `.env.nightly`, and `.env.prod` files. Use different
JWT keys and peppers for each stage. For `dev` and `prod`, set `POWERSYNC_URL` to
that stage's PowerSync endpoint and configure its source with the direct Neon
connection, the auth Worker's JWKS URL, and audience `tabaaq-api`. Nightly does
not provision Neon or PowerSync.

## Local development

```sh
vp run dev
```

The API runs on port 8787. Development needs Cloudflare credentials and the
auth secrets documented in the repository `AGENTS.md`; Alchemy binds real
development-stage resources rather than emulating them locally.

## Migrations

Auth D1 migrations live under `packages/db/migrations/auth`. Inventory
Postgres migrations live under `packages/db/migrations/postgres`. Inventory
Durable Object migrations live under `packages/db/src/inventory`. The checked-in
Drizzle schemas are `packages/db/src/auth/schema.ts`,
`packages/db/src/postgres/schema.ts`, and
`packages/db/src/inventory/schema.ts`.

## Data flow

PowerSync credentials reuse the short-lived access token. The checked-in sync
config filters every query by its signed `org` claim; clients cannot supply the
source credentials or replace the tenant filter.

Organization-object sales go through typed sync commands. The server derives
organization and actor metadata from the session and commits the command in one
Durable Object SQLite transaction. Catalog writes on that path are unsupported.

On `dev` and `prod`, catalog writes still go through typed `/api/inventory/*`
commands. The server records an idempotency receipt and obtains
`pg_current_xact_id()` inside the same transaction as the domain writes.
PowerSync durably queues those catalog changes and streams canonical Postgres
rows back into TanStack DB. Android stays on that path.
