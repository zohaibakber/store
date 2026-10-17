# Store API Worker

The Cloudflare Worker exposes authenticated inventory and support APIs:

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/sync/commands`, `POST /api/sync/replicas`, `POST /api/sync/pull`
- `GET /api/sync/receipts/:operationId`
- `POST /api/sync/snapshots`, `GET /api/sync/snapshots/:snapshotId/parts/:partNumber`
- `GET /api/sync/live` (WebSocket upgrade; the bearer token travels in
  `Sec-WebSocket-Protocol` and the socket is held by the organization's
  `OrgHub` Durable Object, which fans out each commit and stores nothing)
- `POST /api/uploads`
- `POST /api/product-scans`

The auth Worker issues short-lived ES256 JWTs. The API verifies them locally
from `Authorization: Bearer` and trusts the organization membership in the
signed claims. Auth users, organizations, memberships, and refresh sessions
live in D1.

Inventory commands are authoritative in the organization's `OrgAuthority`
Durable Object, which keeps the catalog, receipts, and change log in its own
SQLite storage. Each sync route verifies the token and calls the organization's
object, which decides the command in one storage transaction.

## Infrastructure

Infrastructure is declared in TypeScript with [Alchemy](https://alchemy.run).
The Worker, its bindings, and the local dev port live in `infra.ts`.
`alchemy.run.ts` composes the API Worker, auth Worker, website, and edge rules
into one stack.

Alchemy provisions the auth D1 database, Workers AI, rate limiters, and the
`OrgAuthority` and `OrgHub` Durable Objects on each stage. Maintenance runs on
each `OrgAuthority` object's own alarm, armed after writes: it expires leases,
prunes or rebuilds snapshots, advances the retention floor, and trims change-log
history within a time budget, then re-arms only while work remains.

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

Auth D1 migrations live under `packages/db/migrations/auth`. `OrgAuthority`
SQLite migrations live under `packages/db/migrations/authority` and apply when
the object activates. The checked-in Drizzle schemas are
`packages/db/src/auth/schema.ts` and `packages/db/src/authority/schema.ts`.

## Data flow

Sales and catalog writes go through typed sync commands on
`/api/sync/commands`: `issueInvoice` and `catalogWrite`. The server derives
organization and actor metadata from the session, then commits the command in
one storage transaction in the organization's `OrgAuthority` object. The same
transaction records the idempotency receipt and advances the change log used by
`/api/sync/pull`.

Catalog conflicts are decided server-side: an upsert with no expected row
version is an insert and a taken id is `ENTITY_CONFLICT`; category and product
fields are last-writer-wins; changing `unitsPerPack` and every batch upsert
require a matching row version, because batch quantities are absolute and
create a `stock_in` or `adjustment` movement; deleting a category requires a
matching row version and no active products.

Deletes are published as `delete` changes carrying the row image. Replicas and
the authority both hard-delete.

`/api/sync/pull` returns whole transaction groups within a row and encoded-byte
budget, and computes the partition digest only when the client sends
`digestVersion` and the page reaches the horizon. Clients ask for one on the
shared cadence policy, not on every pull.
