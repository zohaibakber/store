# Shared packages

- `auth`. First-party auth schemas, ES256 JWTs, password hashing, trusted-origin
  policy, and the shared Effect client.
- `client-db`. Host-facing replica handles, catalog writes, row models, and the
  reactive collections the desktop renderer reads.
- `contracts`. Public data contracts grouped into `server`, `store`, and catalog
  write domains.
- `db`. Drizzle schemas and migrations for authentication, the Postgres
  authority, and the SQLite replica.
- `sync`. Host-agnostic replica engine: command outbox, pending projections,
  coverage and digest cadence, the polling scheduler with typed transport
  failures, and the typed `SyncHttpApi` client. The shared entrypoint
  (`@store/sync`) stays native-free (`test/browser-boundary.test.ts` enforces
  it); SQLite lives behind `@store/sync/sqlite` and IndexedDB behind
  `@store/sync/replica/indexeddb`.
- `inventory-react`. React bindings over the replica (atoms, queries, sync
  status, insights) shared by the desktop renderer and the mobile app.
- `workspace`. Shared session HTTP, token renewal, and organization clients.
- `services`. Application services shared by multiple apps.

Package tests mirror the source domains under `test`.

`@store/client-db` owns the replica open used by each host. Hosts supply a
replica opener plus authenticated fetch. Electron opens the replica in a
main-process Node worker over `node:sqlite` and proxies sync HTTP; the browser
host opens the IndexedDB replica; mobile opens op-sqlite. See
`docs/architecture.md` for the whole system. Replicas hard-delete on a `delete` change.
