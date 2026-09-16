# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `client-db`. Organization-object replica engine, catalog writes, row models,
  and authenticated Postgres mutation clients for Electron.
- `contracts`. Public data contracts grouped into `server`, `store`, and catalog
  write domains.
- `db`. Drizzle schemas and migrations for authentication, Postgres, inventory
  authority, and replica data.
- `sync`. Host-agnostic SQLite command library, replica overlay/outbox, and
  typed `SyncHttpApi` client. The organization Durable Object is the desktop
  authority adapter.
- `workspace`. Shared session HTTP, token renewal, and organization clients.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`.

`@store/client-db` owns the organization-object replica open used by desktop.
Hosts supply a replica SQLite opener plus authenticated fetch. Electron opens
the replica in a renderer worker. Electron's main process does not open the
catalog database; it proxies HTTP.
