# Store API Worker

The Cloudflare Worker exposes:

- `GET /api/health`
- `GET|POST /api/auth/*`
- `POST /api/sync`
- `POST /api/uploads`

Better Auth stores global identity and organization membership in D1 through `AUTH_DB`. Each
organization's inventory and sync log live in its own SQLite-backed Durable Object through
`ORGANIZATION_STORE`. The desktop only communicates with these authenticated HTTP routes.

## Local development

Generate Worker types after changing bindings:

```sh
cd apps/server
vp run typegen
```

Apply local D1 migrations and start the Worker:

```sh
wrangler d1 migrations apply store-auth --local
vp run dev
```

The local Worker listens on port 8787. Set `STORE_API_URL` or `VITE_API_URL` for the desktop when
using another origin.

## Deployment

Set the authentication secret once:

```sh
cd apps/server
wrangler secret put BETTER_AUTH_SECRET
```

Apply the production D1 migrations and deploy:

```sh
wrangler d1 migrations apply store-auth --remote
vp run deploy
```

Durable Object schema migrations are bundled from `packages/db/migrations/do` and applied when an
organization runtime starts.

## Sync model

The authenticated session supplies the authoritative organization and user. The sync module
validates operation identity and payload hashes before committing a request in one Durable Object
SQLite transaction.

`sync_inbox` makes retries idempotent. `sync_change_log` stores accepted snapshots and tombstones,
and responses return organization-scoped changes after the supplied cursor.
