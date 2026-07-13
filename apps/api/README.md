# Store invoice API

A Hono app, deployed to Vercel as a Vercel Function, that accepts invoice attachments and returns
structured inventory lines.

```sh
bunx vercel --prod
```

Set `AI_GATEWAY_API_KEY` in the Vercel project. The service uses AI SDK through Vercel AI Gateway,
so the selected model can come from any supported provider. Run `bun run vercel:dev` for local
development — it serves `src/index.ts` directly with Vercel's local emulation and automatically
refreshed Gateway development credentials.

Set `STORE_API_URL` (preferred) or `VITE_API_URL` in the desktop app to the deployed API origin.
Values ending in `/api` are also accepted. During local development, `http://localhost:8787` is
used by default.

## Authentication and organizations

Better Auth lives in the shared `@store/auth` package (`packages/auth`) — email/password,
organization, signed bearer, and Electron plugins, backed by Postgres (Neon's serverless HTTP
driver). This API mounts it in-process at `/api/auth/*` (`app.on(["GET","POST"], "/api/auth/*", ...)`
in `src/index.ts`) and calls `auth.api.getSession`/`auth.api.getActiveMember` directly — no network
hop. Sign-in and sign-up responses expose the session token in the `set-auth-token` header.
Electron must keep that token in main-process secure storage and send it as
`Authorization: Bearer <token>`; never expose it to the renderer. `GET /api/models`,
`POST /api/uploads`, and `POST /api/sync` require a valid session, an active organization, and
current membership in that organization.

Production requires these server-only variables:

- `BETTER_AUTH_SECRET`: high-entropy secret of at least 32 bytes.
- `BETTER_AUTH_URL`: public API origin, such as `https://api.example.com`.
- `DATABASE_URL`: PostgreSQL connection string for the single auth and store database.
- `AUTH_TRUSTED_ORIGINS`: comma-separated exact browser origins. Never use `*`.
- `ELECTRON_PROTOCOL`: reverse-domain application protocol; defaults locally to `com.tabaaq.desktop`.

The API never sends database credentials to Electron. `POST /api/sync` accepts a device id, a
change-log cursor, and a bounded batch of locally committed operations. The authenticated session
is authoritative for the organization and actor; matching identity claims and each operation's
canonical SHA-256 payload hash are validated before any write.

The server applies a request in one PostgreSQL transaction. Operation receipts in `sync_inbox`
make retries idempotent by organization and operation id, while the payload hash prevents an id
from being reused with different content. Entity input is copied through explicit field allowlists,
tenant ownership is always supplied by the server, and accepted row snapshots or tombstones are
appended to `sync_change_log`. Responses contain acknowledgements and at most 500 organization-
scoped changes after the requested cursor; callers continue while `hasMore` is true.

The sync database boundary uses `@effect/sql-pg` through Drizzle's Effect PostgreSQL adapter.
`DATABASE_URL` is required through Effect `Config.redacted`; there is no local development database
fallback in the runtime.

Stock movements are immutable ledger facts. A sync transaction locks affected batches in stable
order and recomputes their quantities from movement deltas before publishing a canonical batch
snapshot. This lets concurrent offline sales converge without one device's absolute quantity
silently replacing another's.

The same `DATABASE_URL` must contain both migration sets before the API serves traffic:

```sh
cd packages/auth && vp run db:migrate
cd ../db && vp run db:migrate
```

The auth package owns Better Auth tables; `packages/db` owns store and sync tables. Run
`vp run auth:generate` in `packages/auth` only after changing Better Auth plugins/schema, and run
the corresponding package's `db:generate` command after changing either Drizzle schema.

`POST /uploads` accepts at most five multipart `files` (PDF or CSV), limits each file to 10 MB and
the request to 25 MB, and returns the extraction
review. The desktop applies approved changes to its filesystem-backed PGlite database first, then
its durable outbox triggers the authenticated PostgreSQL sync endpoint.
