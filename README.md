# Store Electron

This Bun-workspace Turborepo contains an offline-first Electron app built with Better Auth,
Effect v4, Drizzle ORM, PGlite, and PostgreSQL.

## Workspace boundaries

- `apps/desktop` owns Electron lifecycle, typed IPC, preload security, and the React UI.
- `packages/contracts` owns the renderer/main data contract and Effect schemas.
- `packages/db` owns the PostgreSQL schema used by both the embedded and remote databases.
- `packages/persistence` owns the filesystem PGlite driver, transactional outbox, and Effect
  services.

All reads and writes go to a filesystem-backed PGlite database under Electron's `userData`
directory. Better Auth provides users, sessions, and organization membership. Each organization
opens a separate local PGlite directory, while every organization's shared data lives in the same
server-side PostgreSQL database and is scoped by `organization_id`. Electron main owns the session
token, and the renderer receives only narrow typed bridges.

Every local business transaction also commits a durable outbox operation. An Effect-managed sync
worker pushes those operations through the authenticated API and pulls the organization's ordered
change feed. Network failures leave local writes intact and pending for retry; the desktop never
receives a PostgreSQL connection string.

Invoice IDs and display numbers are device-safe, and invoice/stock operations retain immutable
organization, user, device, and operation attribution. Concurrent members can still sell the same
limited stock while independently offline; preventing that strictly requires online coordination
or per-device stock allocation. Reconcile inventory after replicas reconnect until one of those
product policies is implemented.

## Run locally

```sh
vp install
vp run dev
```

The API environment and deployment variables are documented in `apps/api/README.md`. For local
development, run the API and desktop together and configure the Better Auth/PostgreSQL variables
there.
Apply both `packages/auth` and `packages/db` migrations to the same `DATABASE_URL` before starting
the API.
An authenticated user can continue using a previously opened organization offline; a first sign-in
and organization creation require the API.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged desktop app with
`vp run build`. The Electron build keeps PGlite external so its PostgreSQL WASM and data assets are
packaged intact.
