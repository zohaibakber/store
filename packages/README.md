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

Package tests mirror the source domains under `test`.

`@store/client-db` owns the PowerSync schema, connector, and TanStack DB
collection factory. Hosts construct `PowerSyncDatabase` and `DbClient` only.
Web and Electron use `@powersync/web` plus wa-sqlite in the renderer. Expo uses
`@powersync/react-native`. Electron's main process does not open the catalog
database; it proxies HTTP and reads the legacy Locked `store.db` snapshot.

The retained Cloudflare Durable Object implementation, schema, migrations,
contracts, and WebSocket protocol document the production path that preceded
Postgres and PowerSync. Preserve that compatibility source until an explicit
retirement confirms that no production migration or rollback depends on it.
