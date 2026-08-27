# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `client-db`. Catalog replica open, catalog writes, PowerSync configuration,
  row models, and authenticated Postgres mutation clients for web, Electron,
  and Expo.
- `contracts`. Public data contracts grouped into `server`, `store`, and catalog
  write domains.
- `db`. Drizzle schemas and migrations for authentication and authoritative
  Postgres data.
- `workspace`. Shared session HTTP, token renewal, and organization clients.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`.

`@store/client-db` owns `openCatalog`. Hosts supply a PowerSync database factory
and authenticated fetch. Web and Electron use `@powersync/web` plus wa-sqlite in
the renderer. Expo uses `@powersync/react-native`. Electron's main process does
not open the catalog database; it proxies HTTP.
