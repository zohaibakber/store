# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `client-db`. Shared inventory row models, PowerSync configuration, and
  authenticated Postgres mutation clients for web, Electron, and Expo.
- `contracts`. Public data contracts grouped into `server`, `store`, and
  compatibility `sync` domains.
- `db`. Drizzle schemas and migrations for authentication and authoritative
  Postgres data. The Durable Object schema remains as production compatibility
  and migration source.
- `workspace`. Shared session HTTP, token renewal, and organization clients.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`; shared test utilities belong in `test/lib`.

TanStack DB persistence lives in host adapters instead of a shared hand-rolled
store. The web renderer uses WASQLite, Electron uses SQLite in the main process,
and Expo uses `expo-sqlite`. PowerSync fills the persisted collections from
organization-scoped Postgres streams.

The retained Cloudflare Durable Object implementation, schema, migrations,
contracts, and WebSocket protocol document the production path that preceded
Postgres and PowerSync. Preserve that compatibility source until an explicit
retirement confirms that no production migration or rollback depends on it.
