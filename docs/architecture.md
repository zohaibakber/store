# Architecture

Tabaaq is offline-first inventory and sales. The desktop and mobile clients keep
a local replica of their organization's catalog, writes commands to it first, and syncs with one
authoritative Postgres database through a stateless Cloudflare Worker.

## Clients

- `apps/web`: the product UI and the website. One React app with two hosts,
  chosen at startup by whether the preload bridges are present. It defines the
  host contract in `src/host` and never imports from `apps/desktop`. In the
  browser it keeps the access token in memory and the refresh token in the auth
  Worker's HttpOnly cookie, and holds no replica: sign-in, organizations and
  settings work, and inventory screens point to the desktop app.
  Prod serves it on `PRODUCTION_DOMAIN`.
- `apps/desktop`: the Electron shell. It uses `apps/web` as its renderer and
  implements the host contract. The replica lives in a main-process Node worker
  on `@effect/sql-sqlite-node` over `node:sqlite`. The renderer reaches it
  over `MessagePort`s that main forwards once per attach: `InventoryReads`
  (named bounded reads, served by a read-only reader worker), `InventoryStore`
  (domain commands, commit and health streams, served by the writer),
  `InventoryInsights` (the analytics worker), and `DesktopRpcs` (main). No SQL
  or query IR crosses a process boundary. Preload IPC carries open, close,
  backup, restore, and publish only. The main process keeps the encrypted
  refresh token and pushes a short-lived access token to the writer, which
  makes its own sync HTTP calls.
- `apps/mobile`: Expo Android app. The replica is op-sqlite through
  `@effect/sql-sqlite-react-native`.
- `packages/inventory-react` holds the React bindings (atoms, queries, sync
  status, insights) shared by the web app and mobile.

## Local replica (`packages/sync`)

- The shared entrypoint (`@store/sync`) is host-agnostic and native-free.
  SQLite adapters live behind `@store/sync/sqlite`.
- Commands (`issueInvoice`, `catalogWrite`) commit to a local outbox and write
  pending projections: provisional rows tagged with the operation id and
  journalled so a rejection restores the prior image. Pending stock changes
  are relative per-command overlays on authoritative batch quantities, so
  other commits apply underneath them; a command's overlay is dropped when its
  own group integrates.
- The scheduler uploads the outbox, pulls committed transaction groups, and
  replaces pending rows with authoritative ones. Replicas hard-delete on a
  `delete` change and hold no `deletedAt`.
- Coverage tracks which history the replica holds. A replica with no usable
  cursor bootstraps from a snapshot, then pulls from the snapshot's sequence.
- The partition digest (v4) hashes `(entity, id, row_version)` for every
  entity, history, suppliers and purchase orders included. The replica names
  the version it wants; the authority still answers v3 over the original six
  entities for older builds. The replica requests it only on the cadence
  policy: when it believes it is caught up and the verification interval has
  elapsed. A mismatch triggers recovery.

## API Worker (`apps/server`)

The API is a thin gateway. Each request verifies the ES256 access token
locally, takes the organization from the signed claims, and runs one
`select sync.<fn>(...)` on Postgres through Hyperdrive. The SQL functions in
the `sync` schema own validation, organization locking, conflict decisions,
idempotency receipts, and the change log.

| Route                                  | SQL                     |
| -------------------------------------- | ----------------------- |
| `POST /api/sync/replicas`              | `sync.register_replica` |
| `POST /api/sync/commands`              | `sync.submit_command`   |
| `GET /api/sync/receipts/:operationId`  | `sync.receipt_frame`    |
| `POST /api/sync/pull`                  | `sync.pull`             |
| `POST /api/sync/snapshots`             | `sync.acquire_snapshot` |
| `GET /api/sync/snapshots/:id/parts/:n` | `snapshot_parts` read   |
| `GET /api/sync/live`                   | WebSocket to `OrgHub`   |

Other routes: `/api/health`, `/api/auth/session`, `/api/uploads`, and
`/api/product-scans` (Workers AI, rate limited).

- Pull returns whole transaction groups within a row and encoded-byte budget
  (`maxBytes`). A client asks for the digest by sending `digestVersion`.
- Snapshots are built on demand by `sync.build_snapshot` in one SQL statement
  and stored as parts in Postgres. Parts are served with a content ETag and
  immutable caching.
- A cron trigger (`*/5 * * * *`) runs `sync.maintain`: it advances retention
  floors, deletes old change-log history in bounded batches, expires leases,
  and prunes or rebuilds snapshots within a time budget.

## Live fan-out

Each organization has one `OrgHub` Durable Object holding hibernated
WebSockets. The bearer token travels in `Sec-WebSocket-Protocol`. After a
command commits, the Worker publishes the committed groups to the hub, which
broadcasts them and stores nothing. A client applies a frame only when it is
contiguous with its applied commit sequence and in the same epoch; otherwise it
pulls.

## Auth Worker (`apps/auth`)

- D1 holds users, credentials, OAuth accounts, organizations, memberships,
  refresh sessions, and single-use ephemeral records.
- Password, OTP, and Google OAuth (PKCE) sign-in. Access tokens are ES256 JWTs
  valid for one hour; the public JWK is served for local verification.
- Refresh tokens rotate through D1 and the refresh response carries the
  session workspace. See `packages/auth/ARCHITECTURE.md`.

## Data (`packages/db`)

- `migrations/auth`: D1 schema.
- `migrations/postgres`: inventory tables plus the `sync` schema functions.
- `migrations/replica`: the local SQLite replica schema.

## Infrastructure and stages

Alchemy declares everything in `alchemy.run.ts` and the `infra.ts` modules next
to the code they deploy. There are two stages:

- `dev`: inventory Postgres on Neon, no web app deployment.
- `prod`: inventory on PlanetScale Postgres, web app on `PRODUCTION_DOMAIN`,
  API on `api.<domain>`, auth on `auth.<domain>`, and zone WAF rules
  (`infra/edge.ts`) that block paths outside each host's surface and rate-limit
  `/api/` per IP.

## CI

`.github/workflows/ci.yml` runs `vp check`, `vp run -r check`, and `vp test` on
every change. Every push to `main` then deploys prod while `release.yml` bumps
the patch version and builds a draft desktop release through electron-builder.
CI publishes the draft only after the deploy succeeds. `infra.yml` is a manual plan or deploy for either
stage.
