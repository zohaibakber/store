# Shared packages

- `auth`: Better Auth server and Electron client setup.
- `contracts`: public data contracts grouped into `server`, `store`, and `sync`.
- `db`: Drizzle schemas and migrations for authentication, local storage, and Durable Objects.
- `persistence`: local database, inventory, analytics, and synchronization services.
- `services`: application services shared by multiple apps.

Package tests mirror the source domains under `test`; shared test utilities belong in `test/lib`.
