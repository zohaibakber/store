# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session` and `GET /api/auth/get-session`
- `GET /api/powersync/credentials`
- `POST /api/inventory/mutations`
- `POST /api/inventory/imports`
- `POST /api/inventory/invoices`
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions
live in D1.

Inventory is authoritative in Neon Postgres. The Worker authenticates and
validates catalog write commands, commits each command in one Postgres
transaction, and returns that transaction ID. PowerSync publishes
organization-scoped table changes to TanStack DB clients. There is no
organization Durable Object and no `/api/sync/live` route.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and inventory
Postgres project into one stack.

Alchemy provisions the auth D1 database, Neon Postgres, Hyperdrive, Workers AI,
and a product-scan rate limiter. PowerSync receives the direct Neon connection;
Worker commands use Hyperdrive for pooled Postgres access.

Run deployments from the repository root and always pass a stage:

```sh
pnpm run plan:dev
pnpm run deploy:dev
pnpm run plan:prod
pnpm run deploy:prod
```

Secrets come from gitignored `.env.dev` and `.env.prod` files. Use different
JWT keys and peppers for each stage. Set `POWERSYNC_URL` to that stage's
PowerSync endpoint; configure its source with the direct Neon connection, the
auth Worker's JWKS URL, and audience `tabaaq-api`.

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

PowerSync credentials reuse the short-lived access token. The checked-in sync
config filters every query by its signed `org` claim; clients cannot supply the
source credentials or replace the tenant filter.

Inventory writes go through typed catalog commands. The server derives
organization and actor metadata from the session, records an idempotency
receipt, and obtains `pg_current_xact_id()` inside the same transaction as the
domain writes. PowerSync durably queues simple catalog changes and streams
canonical Postgres rows back into TanStack DB.
