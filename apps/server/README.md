# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session` and `GET /api/auth/get-session`
- `POST /api/sync/commands`, `POST /api/sync/replicas`, `POST /api/sync/pull`
- `POST /api/sync/snapshots`, `POST /api/sync/live-tickets`
- `GET /api/sync/live` (WebSocket upgrade)
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions
live in D1.

Inventory commands are authoritative in PlanetScale Postgres. The Worker
authenticates each `/api/sync/commands` call and commits it in one PostgreSQL
transaction through Hyperdrive. Nightly does not provision that database.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and inventory
Postgres database into one stack.

Alchemy provisions the auth D1 database, Workers AI, an R2 snapshot bucket, and
a product-scan rate limiter on every published stage. `dev` and `prod` also
provision PlanetScale Postgres and Hyperdrive. Nightly skips that database.

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
JWT keys and peppers for each stage. Nightly does not provision PlanetScale.

## Local development

```sh
vp run dev
```

The API runs on port 8787. Development needs Cloudflare credentials and the
auth secrets documented in the repository `AGENTS.md`; Alchemy binds real
development-stage resources rather than emulating them locally.

## Migrations

Auth D1 migrations live under `packages/db/migrations/auth`. Inventory Postgres
migrations live under `packages/db/migrations/postgres`. The checked-in Drizzle
schemas are `packages/db/src/auth/schema.ts` and
`packages/db/src/postgres/schema.ts`.

## Data flow

Sales and catalog writes go through typed sync commands on
`/api/sync/commands`. The server derives organization and actor metadata from
the session, then commits the command in one PostgreSQL transaction through
Hyperdrive. The same transaction records the idempotency receipt and advances
the change log used by `/api/sync/pull`.
