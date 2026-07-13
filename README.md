# Store Electron

This Bun-workspace Turborepo contains an offline-first Electron app built with Better Auth,
Effect v4, Drizzle ORM, and Turso Sync.

## Workspace boundaries

- `apps/desktop` owns Electron lifecycle, typed IPC, preload security, and the React UI.
- `packages/contracts` owns the renderer/main data contract and Effect schemas.
- `packages/persistence` owns the Drizzle schema, Turso Sync driver, and Effect services.

All reads and writes go to a local database under Electron's `userData` directory. Better Auth
provides users, sessions, and organization membership. Each organization opens a separate local
replica and remote Turso database; Electron main owns session and database credentials, while the
renderer receives only narrow typed bridges. Sync is an explicit `push()` followed by `pull()`, so
a failed network request never prevents local CRUD after a successful sign-in.

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
development, run the API and desktop together and configure the Better Auth/Turso variables there.
An authenticated user can continue using a previously opened organization offline; a first sign-in
and organization creation require the API.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged desktop app with
`vp run build`. The Electron build keeps `@tursodatabase/sync` external and unpacks its native
`.node` binary from ASAR.
