# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `client-db`. Catalog replica open, catalog writes, PowerSync configuration,
  organization-object replica engine, row models, and authenticated Postgres
  mutation clients for Electron and native Android.
- `contracts`. Public data contracts grouped into `server`, `store`, and catalog
  write domains.
- `db`. Drizzle schemas and migrations for authentication, Postgres, inventory
  authority, and replica data.
- `sync`. Host-agnostic SQLite command library, replica overlay/outbox, and
  typed `SyncHttpApi` client. The organization Durable Object is the nightly
  desktop authority adapter.
- `workspace`. Shared session HTTP, token renewal, and organization clients.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`.

`@store/client-db` owns `openCatalog` for the PowerSync path and the
organization-object replica open used by nightly desktop. Hosts supply a
PowerSync database factory and/or a replica SQLite opener plus authenticated
fetch. Electron's default is the organization-object replica in a renderer
worker. `STORE_INVENTORY_BACKEND=powerSync` keeps `@powersync/web` plus
wa-sqlite. Native Android uses `com.powersync:core`. Electron's main process
does not open the catalog database; it proxies HTTP.
