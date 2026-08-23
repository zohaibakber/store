# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session` and `GET /api/auth/get-session`
- `GET /api/electric/:table`
- `GET /api/sync/live` (legacy WebSocket compatibility)
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
validates commands, commits each command in one Postgres transaction, and
returns that transaction ID. Electric publishes organization-scoped table
changes to TanStack DB clients.

The existing `ORGANIZATION_STORE` Durable Object class, binding, schema, and
`/api/sync/live` WebSocket route remain in place for deployed clients whose
local outboxes still synchronize with the legacy inventory database. This is a
compatibility path, not a dual-write path: new clients use Postgres/Electric,
while legacy clients continue to use their existing Durable Object. Do not
rename or remove the class or binding until production data has been exported,
backfilled, and verified and the legacy clients have completed cutover.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and inventory
Postgres project into one stack.

Alchemy provisions the auth D1 database, Neon Postgres, Hyperdrive, Workers AI,
and product-scan rate limiter, and preserves the existing
`ORGANIZATION_STORE` binding. Electric receives the direct Neon connection;
Worker commands use Hyperdrive for pooled Postgres access.

Run deployments from the repository root and always pass a stage:

```sh
pnpm run plan:dev
pnpm run deploy:dev
pnpm run plan:prod
pnpm run deploy:prod
```

Secrets come from gitignored `.env.dev` and `.env.prod` files. Use different
JWT keys and peppers for each stage. Electric configuration uses
`ELECTRIC_URL`, `ELECTRIC_SOURCE_ID`, and `ELECTRIC_SOURCE_SECRET`.

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
`packages/db/src/postgres/schema.ts`. The retained legacy Durable Object schema
and migrations live under `packages/db/src/do` and `packages/db/migrations/do`;
they must remain available while the compatibility binding exists.

## Data flow

Electric proxy routes choose an allowlisted table and inject the authenticated
organization filter. Clients cannot supply the source credentials or replace
the tenant filter.

Inventory writes go through typed commands. The server derives organization and
actor metadata from the session, records an idempotency receipt, and obtains
`pg_current_xact_id()` inside the same transaction as the domain writes.
TanStack DB keeps optimistic state until Electric reports that transaction ID.
