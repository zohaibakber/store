---
title: Sync, network, and cold start
---

# Sync and network

Mechanisms only. Inventory truth is Postgres. The catalog replica is a
HashMap plus IndexedDB `KeyValueStore`. TanStack DB memory collections are a
UI projection. D1 is auth. There is no organization Durable Object and no
`/api/sync/live` path.

## What store does today

- Postgres is the catalog authority. `catalog_change_log` is the pull cursor
  (`bigint` identity, not 32-bit `xid`).
- Web and Electron persist replica snapshot + outbox JSON in IndexedDB.
  Never wa-sqlite, OPFS sqlite, or `PersistedQueue.layerStoreSql` in the
  renderer. Electron main proxies authenticated HTTP.
- TanStack DB collections come from `@store/client-db` via a custom `sync`
  `begin` / `write` / `commit` / `markReady`. Hosts construct `DbClient` only.
- Catalog writes (category, product, batch) go through the replica outbox,
  then HTTP `/api/inventory/mutations`. Invoices enqueue `/api/inventory/invoices`.
- Imports are online HTTP commands after the outbox drains, then `poke()` to
  pull.
- Hydrate is fire-and-forget. Do not block `#boot-shell` on first snapshot.
- Logout, org switch, and scope change: dispose the `ManagedRuntime` (closes
  IndexedDB). Opening another organization uses a different replica key.

Code: `packages/sync`, `packages/client-db`, `apps/web/src/lib/inventory`,
`apps/server` inventory pull/snapshot routes.

## Lessons from Zero

Steal:

- Client answers from the local replica first; network patches later.
- Auth refresh that keeps the session object alive, not teardown + reconnect
  storms.
- When inventory grows, keep slice-shaped partial sync (`catalog` | `sales`)
  instead of shipping the whole org on every connect.

Do not copy:

- Postgres + `zero-cache` IVM as a second cache tier in front of the replica.
- Official online-only writes (disconnected rejects mutations). Catalog
  edits stay on the outbox.
