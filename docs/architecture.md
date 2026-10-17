# Architecture

Tabaaq is offline-first inventory and sales. The desktop and mobile clients keep
a local replica of their organization's catalog, writes commands to it first, and syncs with one
authoritative `OrgAuthority` Durable Object per organization through a stateless Cloudflare Worker.

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
locally, takes the organization from the signed claims, and calls one method on
that organization's `OrgAuthority` Durable Object (`getByName(organizationId)`).
The Worker-side services in `src/inventory` keep the route contracts and turn
the object's reply (`ok`, `refused` with a protocol code, or `malformed`) back
into typed errors.

| Route                                  | `OrgAuthority` method |
| -------------------------------------- | --------------------- |
| `POST /api/sync/replicas`              | `register`            |
| `POST /api/sync/commands`              | `submit`              |
| `GET /api/sync/receipts/:operationId`  | `receipt`             |
| `POST /api/sync/pull`                  | `pull`                |
| `POST /api/sync/snapshots`             | `acquireSnapshot`     |
| `GET /api/sync/snapshots/:id/parts/:n` | `readSnapshotPart`    |
| `POST /api/sync/imports/:id/parts/:n`  | `stageImportPart`     |
| `POST /api/sync/imports/:id/commit`    | `commitImport`        |
| `GET /api/sync/imports/:id`            | `importStatus`        |
| `GET /api/sync/live`                   | WebSocket to `OrgHub` |

Other routes: `/api/health`, `/api/auth/session`, `/api/uploads`, and
`/api/product-scans` (Workers AI, rate limited).

## Organization authority (`apps/server/src/authority`)

- One SQLite-backed Durable Object per organization owns its catalog (the
  shared `store.schema` tables), change log, receipts, replicas, snapshots,
  download leases and staged imports (`packages/db/src/authority/schema.ts`,
  migrations in `migrations/authority`, applied on activation).
- Every command runs in one storage transaction, which closes the object's
  input gate: the object is the organization lock. Decisions reuse the
  deciders the local authority runs (`@store/sync/authority`) over the settled
  catalog, so a local workspace and an organization decide alike.
- Pull returns whole transaction groups within a row and encoded-byte budget
  (`maxBytes`). A client asks for the digest by sending `digestVersion` 4.
- Snapshots are built on demand into parts of at most 2,000 rows or 768 KiB
  and served with a content ETag and immutable caching.
- Maintenance runs on the object's own alarm, armed after writes: it expires
  leases, rebuilds or prunes snapshots, advances the retention floor and trims
  the change log within a time budget, then re-arms only while work remains.
- Statements bind at most about 100 parameters (the Durable Object SQLite
  limit), so multi-row writes and `in (...)` reads are chunked.

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
- `migrations/authority`: the `OrgAuthority` Durable Object SQLite schema.
- `migrations/replica`: the local SQLite replica schema.

## Infrastructure and stages

Alchemy declares everything in `alchemy.run.ts` and the `infra.ts` modules next
to the code they deploy. There are two stages:

- `dev`: no web app deployment.
- `prod`: web app on `PRODUCTION_DOMAIN`,
  API on `api.<domain>`, auth on `auth.<domain>`, and zone WAF rules
  (`infra/edge.ts`) that block paths outside each host's surface and rate-limit
  `/api/` per IP.

## CI

`.github/workflows/ci.yml` runs `vp check`, `vp run -r check`, and `vp test` on
every change. Every push to `main` then deploys prod while `release.yml` bumps
the patch version and builds a draft desktop release through electron-builder.
CI publishes the draft only after the deploy succeeds. `infra.yml` is a manual plan or deploy for either
stage.
