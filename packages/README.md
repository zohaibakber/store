# Shared packages

- `auth`: Better Auth server, Electron client, and cookie-based web client setup.
- `contracts`: public data contracts grouped into `server`, `store`, and `sync`.
- `db`: Drizzle schemas and migrations for authentication, local storage, and Durable Objects.
- `persistence`: local database, inventory, analytics, and synchronization services. Import
  `@store/persistence/browser` in the web app (no `node:fs`); Node and Electron use the root
  export.
- `workspace`: authenticated workspace runtime shared by the desktop main process and the web
  replica.
- `services`: application services shared by multiple apps.

Package tests mirror the source domains under `test`; shared test utilities belong in `test/lib`.
