# Store API Worker

The API is a Cloudflare Worker with three public surfaces:

- `GET /api/health`
- `GET|POST /api/auth/*`
- `POST /api/sync`

Authentication and sync use the same remote PostgreSQL database through the `HYPERDRIVE`
binding. The Worker never reads a development `DATABASE_URL`, and database credentials are never
sent to Electron. The only required Worker secret is `BETTER_AUTH_SECRET`.

The entry point is a native Hono Cloudflare app (`export default app`). Wrangler generates the
`CloudflareBindings` type, request middleware reads bindings from `c.env`, and deferred database
cleanup uses Hono's `c.executionCtx.waitUntil` integration.

The Worker intentionally does not host invoice upload or model-catalog routes. AI extraction and
catalog integrations live in `packages/services` so they can be attached to a dedicated runtime
later without adding Vercel-specific code to the sync API.

## Cloudflare setup

`wrangler.jsonc` contains the existing Hyperdrive configuration id and enables `nodejs_compat`,
which is required by the PostgreSQL drivers. Set the auth secret once for the Worker:

```sh
cd apps/server
vp run typegen
wrangler secret put BETTER_AUTH_SECRET
```

Run the remote-backed development Worker on the desktop app's default API port:

```sh
vp run dev
```

Deploy it with:

```sh
vp run deploy
```

Set `STORE_API_URL` (preferred) or `VITE_API_URL` in the desktop environment to the deployed
Worker origin. Values ending in `/api` are accepted.

## Authentication and organizations

Better Auth logic lives in `packages/auth`; its PostgreSQL schema lives in `packages/db`. The API
constructs Better Auth per request from the Hyperdrive connection string and mounts it in-process
at `/api/auth/*`. The official Better Auth Electron client encrypts its session cookies with
Electron `safeStorage`; only the main process can access them, and the renderer receives narrow IPC
results rather than credentials.

`POST /api/sync` requires a valid session, an active organization, and current membership. The
authenticated session is authoritative for both organization and user. The server validates those
claims and each operation's canonical SHA-256 hash before applying a bounded request in one
PostgreSQL transaction.

Operation receipts in `sync_inbox` make retries idempotent. Accepted snapshots and tombstones are
written to `sync_change_log`, and responses return at most 500 organization-scoped changes after
the supplied cursor. The Effect runtime and PostgreSQL pools are request-scoped; Worker resource
cleanup is attached to `ExecutionContext.waitUntil`.

## Schema migrations

The remote database must contain the unified auth, store, and sync migrations from `packages/db`.
Only the migration command needs a direct operator connection string:

```sh
cd packages/db
DATABASE_URL='postgresql://...' vp run db:migrate
```

Runtime traffic always uses Hyperdrive.
