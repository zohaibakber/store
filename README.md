# Store Electron

This Bun-workspace Turborepo contains an offline-first Electron demo built with Effect v4, Drizzle ORM RC, and Turso Sync.

## Workspace boundaries

- `apps/desktop` owns Electron lifecycle, typed IPC, preload security, and the React UI.
- `packages/contracts` owns the renderer/main data contract and Effect schemas.
- `packages/persistence` owns the Drizzle schema, Turso Sync driver, and Effect services.

All reads and writes go to the local database under Electron's `userData` directory. Sync is an explicit `push()` followed by `pull()`, so a failed network request never prevents local CRUD.

## Run locally

```sh
vp install
bun run dev
```

The demo works without credentials in local-only mode. To enable Turso Cloud sync:

```sh
TURSO_DATABASE_URL="libsql://your-database.turso.io" \
TURSO_AUTH_TOKEN="your-token" \
bun run dev
```

You can also point `TURSO_DATABASE_URL` at a local Turso sync server; a token is optional for a local server.

Run all workspace checks with `bun run check`, or produce the packaged desktop app with `bun run build`. The Electron build keeps `@tursodatabase/sync` external and unpacks its native `.node` binary from ASAR.
