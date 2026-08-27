---
title: Sync, network, and cold start
---

# Sync and network

Mechanisms only. Inventory truth is Postgres. PowerSync streams
organization-scoped rows into client SQLite. TanStack DB collections sit
in-process on that `PowerSyncDatabase`. D1 is auth. There is no organization
Durable Object and no `/api/sync/live` path.

## What store does today

- Postgres is the catalog authority. PowerSync replicates those rows into
  durable SQLite (`powersync-inventory-<hash>.sqlite`).
- Web and Electron open `@powersync/web` plus wa-sqlite in the renderer.
  Expo opens `@powersync/react-native`. Electron main does not run PowerSync.
  It proxies authenticated HTTP.
- TanStack DB collections come from `@store/client-db` via
  `powerSyncCollectionOptions`. Hosts construct `PowerSyncDatabase` and
  `DbClient` only.
- Catalog writes (category, product, batch) go through the PowerSync upload
  queue: `getNextCrudTransaction()`, HTTP `/api/inventory/mutations`, then
  `transaction.complete()` on success. Do not complete on halt.
- Imports and invoice issuance are online HTTP commands after the upload
  queue drains.
- `connect()` is fire-and-forget. Gate readiness with `waitForFirstSync()`.
- Logout, org switch, and scope change: `disconnectAndClear()` then `close()`,
  then drop the cached database. `close()` alone leaves the previous org's
  rows on disk.

Code: `packages/client-db`, `apps/web/src/lib/inventory`, `powersync/sync-config.yaml`,
`apps/server` inventory routes and PowerSync credentials.

## Lessons from Zero

Steal:

- Client answers from local SQLite first; network patches later.
- Auth refresh that keeps the session object alive, not teardown + reconnect
  storms.
- When inventory grows, keep query-shaped partial sync (PowerSync streams)
  instead of shipping the whole org on every connect.

Do not copy:

- Postgres + `zero-cache` IVM as a second cache tier in front of our
  PowerSync service.
- Official online-only writes (disconnected rejects mutations). Catalog
  edits stay on the upload queue.

## Lessons from PowerSync

This is the live stack, not a source of optional ideas. Follow the official
JS/TanStack patterns:

- Renderer `@powersync/web` in Electron (example-electron). No
  `@powersync/node`, no main-process DB, no query IPC.
- One `PowerSyncDatabase` per authenticated scope. Do not create or close it
  in a Strict Mode `useEffect`.
- Do not block download progress behind a stuck upload in a way that hides
  other devices' catch-up. Skip `ENTITY_CONFLICT` rows; halt permanent 4xx
  without `complete()`.

## Network checklist

- [ ] `connect()` without await; `waitForFirstSync()` when the UI needs rows.
- [ ] Drain `getUploadQueueStats` before multi-table HTTP commands.
- [ ] `disconnectAndClear()` then `close()` on logout or org change.
- [ ] Refresh auth before `fetchCredentials` returns an expired token.
- [ ] Do not open `/api/sync/live`. It is retired.
- [ ] Do not block `#boot-shell` on first sync.

## Contrast

| | Zero | PowerSync |
| --- | --- | --- |
| Local reads | IndexedDB + ZQL | SQLite |
| Partial sync | Query subscriptions | Sync streams |
| Live payload | Diff patches on WS | Stream ops |
| Offline writes | Rejected (official) | Upload queue |
| Server role | Cache + IVM over Postgres | CDC + streams over Postgres |

## Store cold start

`#boot-shell` in `apps/web/index.html` stays until `startWeb()` finishes.
Keep that path off PowerSync first sync.

Ordered work before paint:

1. Session bootstrap (`ensureFreshAccess` / session GET).
2. Mount the React shell.
3. Open the scoped `PowerSyncDatabase` after paint (InventoryProvider).
4. `void connect()`; collections preload from local SQLite.
5. `waitForFirstSync()` in the background. Loaders tolerate empty-until-live.

Unsigned browser: skip forced cookie refresh when there is no session.

Rules:

1. Do not block `#boot-shell` on `waitForFirstSync()`.
2. Defer first sync past paint. Keep loaders tolerant of empty-until-live.
3. Skip forced cookie refresh when unsigned; fail fast offline.
4. Prefer mounting a React shell earlier over holding the static logo through
   network.

Evidence trail: `apps/web` `start-web.tsx`, `mount-app.tsx`,
`apps/web/src/lib/inventory`.
