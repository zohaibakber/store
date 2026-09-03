# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session` and `GET /api/auth/get-session`
- `POST /api/inventory/mutations`
- `POST /api/inventory/imports`
- `POST /api/inventory/invoices`
- `POST /api/inventory/pull`
- `POST /api/inventory/snapshot`
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions
live in D1.

Inventory is authoritative in Neon Postgres. The Worker authenticates and
validates catalog write commands, commits each command in one Postgres
transaction, appends `catalog_change_log` rows, and returns that log cursor.
Clients pull and snapshot over HTTP. There is no organization Durable Object
and no `/api/sync/live` route.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and inventory
Postgres project into one stack.

Alchemy provisions the auth D1 database, Neon Postgres, Hyperdrive, Workers AI,
and a product-scan rate limiter. Worker commands use Hyperdrive for pooled
Postgres access.

Run deployments from the repository root and always pass a stage:

```sh
pnpm run plan:dev
pnpm run deploy:dev
pnpm run plan:prod
pnpm run deploy:prod
```

Secrets come from gitignored `.env.dev` and `.env.prod` files. Use different
JWT keys and peppers for each stage.

## Local development

```sh
vp run dev
```

The API runs on port 8787. Development needs Cloudflare credentials and the
auth secrets documented in the repository `AGENTS.md`; Alchemy binds real
development-stage resources rather than emulating them locally.

## Migrations

Auth D1 migrations live under `packages/db/migrations/auth`. Inventory
Postgres migrations live under `packages/db/migrations/postgres`. The checked-in
Drizzle schemas are `packages/db/src/auth/schema.ts` and
`packages/db/src/postgres/schema.ts`.

## Data flow

Catalog pull and snapshot reuse the short-lived access token. Every query is
scoped to the signed organization claim.

Inventory writes go through typed catalog commands. The server derives
organization and actor metadata from the session, records an idempotency
receipt, and appends change-log rows inside the same transaction as the domain
writes. Clients drain an IndexedDB outbox and pull canonical Postgres rows
into TanStack DB.
