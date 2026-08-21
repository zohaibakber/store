---
title: Sync, network, and cold start
---

# Sync and network

Mechanisms only. Store truth is the organization Durable Object + change log,
local SQLite, and an outbox. Do not replace that with Zero or PowerSync stacks.

## What store does today

- Local-first SQLite + outbox; LWW by `rowVersion`.
- Exchange RPC: one request pushes ≤100 ops and pulls change-log since
  `cursor` (`hasMore` / multi-round drain).
- Live path multiplexes exchange on the same WebSocket.
- Live payload is a contentless poke: `{ type: 'invalidate', headCursor }`.
  Client coalesces (sliding queue size 1) and re-runs `exchangeOnce` under a
  semaphore. Safety poll ~5m when live.
- Auth: access token in live URL on open; DO closes expired sockets. No
  mid-session token refresh API yet.
- Scope: whole organization change log, not query/bucket partial sync.

Code: `packages/sync-client`, `packages/persistence` sync engine,
`apps/server` organization store, `packages/contracts` sync schema.

## Lessons from Zero

Steal:

- Client answers from local store first; network patches later.
- Auth refresh that keeps the client/session object alive
  (`connect({ auth })` style), not teardown + reconnect storms.
- When inventory grows, move toward query-shaped partial sync and serve diffs
  on the wire instead of invalidate-only pokes.

Do not copy:

- Postgres + `zero-cache` IVM as the source of truth.
- Official online-only writes (disconnected rejects mutations). This product
  needs offline inventory writes.

## Lessons from PowerSync

Steal:

- Buckets / streams style partial sync and resume from op IDs when full org
  log bandwidth hurts.
- Checkpoint + checksum thinking if multi-table txn consistency becomes
  user-visible.
- Keep UI reads on local SQLite; never block reads on network.

Do not copy:

- Blocking download progress on a non-empty upload queue. That stalls
  multi-device catch-up behind one stuck outbox op. Store quarantines instead.

## Network checklist

- [ ] One long-lived socket; reuse for push + pull.
- [ ] Coalesce invalidations; single-flight exchange under Semaphore.
- [ ] Batch ops (store cap 100); drain with `hasMore` / max rounds / yield.
- [ ] Auth refresh before connect or reconnect; avoid URL-token-only storms.
- [ ] Prefer delta frames over invalidate → full catch-up when fan-out grows.
- [ ] Add partial sync before bandwidth hurts, not after.
- [ ] Do not open a socket per exchange.

## Contrast

| | Zero | PowerSync | Store |
| --- | --- | --- | --- |
| Local reads | IndexedDB + ZQL | SQLite | SQLite |
| Partial sync | Query subscriptions | Buckets/streams | Full org log |
| Live payload | Diff patches on WS | Bucket ops stream | Invalidate hint |
| Offline writes | Rejected (official) | Upload queue | Outbox |
| Server role | Cache + IVM over Postgres | CDC + buckets | Org DO + change log |

## Store cold start

`#boot-shell` in `apps/web/index.html` stays until `startWeb()` finishes.
That path currently awaits the full authenticated bootstrap before React
mounts.

Ordered blockers before paint:

1. `WebAuthBroker.initialize` → forced `ensureFreshAccess(true)` (network).
2. Session GET when tokens exist (network).
3. OfflineStore open: ManagedRuntime + OPFS libSQL + migrations (local I/O).
4. Live WS open during store construction (network handshake).
5. **`await store.sync()`** until first pull drains (highest signed-in cost).

Unsigned browser: refresh still runs; Locked open throws
`GuestWorkspaceRefused`; logo stick ≈ auth RTT only.

Rules:

1. Do not block `#boot-shell` on `store.sync()` or live WS.
2. Defer first sync past paint (background fiber / post-mount). Keep loaders
   tolerant of empty-until-live, or soft-block only loaders that need rows.
3. Do not open live WS until after first paint or first navigation. Open store
   without `syncTransport`, then attach.
4. Skip forced cookie refresh when unsigned; fail fast offline. Signed-in:
   one refresh is enough; do not serialize it with work that could overlap
   after paint.
5. Prefer mounting a React shell earlier over holding the static logo through
   network.

Evidence trail: `apps/web` `start-web.tsx`, `mount-app.tsx`, workspace
`#activate`, `host.ts`, sync `engine.ts` / `runtime.ts`.
