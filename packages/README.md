# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `contracts`. Public data contracts grouped into `server`, `store`, and `sync`.
- `db`. Drizzle schemas and migrations for authentication, local storage, and Durable Objects.
- `persistence`. Local database, inventory, analytics, and synchronization services. Import
  `@store/persistence/browser` in the web app (no `node:fs`); Node and Electron use the root
  export.
- `workspace`. Authenticated workspace runtime shared by the desktop main process and the web
  replica.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`; shared test utilities belong in `test/lib`.
