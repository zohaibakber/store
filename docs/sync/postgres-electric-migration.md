# Postgres, Electric, and TanStack DB

## Decision

Neon Postgres is the only inventory authority. Cloudflare Workers authenticate
and validate commands, execute business transactions through Hyperdrive, and
proxy organization-scoped Electric shapes. TanStack DB owns each client's live
query model and optimistic state; platform SQLite adapters provide a disposable
local read replica.

The active inventory path has no Durable Object and no custom WebSocket sync
engine. The existing production Durable Object namespace is retained as a
read-only migration source until its data has been exported and verified; a
deployment must not delete or rename that binding. Postgres command receipts
are ordinary database rows used to make HTTP retries idempotent; they are not a
second data authority.

## Ownership

| Concern                                       | Owner                              |
| --------------------------------------------- | ---------------------------------- |
| Inventory rows, constraints, and transactions | Neon Postgres                      |
| Auth, organization scope, and commands        | Cloudflare Worker                  |
| Postgres change delivery                      | Electric                           |
| Live queries and optimistic overlays          | TanStack DB                        |
| Browser replica                               | OPFS SQLite (`wa-sqlite`)          |
| Expo replica                                  | Expo SQLite                        |
| Electron replica                              | `better-sqlite3` behind narrow IPC |

Local replicas are caches. A schema-version change or corrupt cache may discard
and rebuild them from Electric without risking authoritative data.

## Reads

Clients request allowlisted `GET /api/electric/:table` routes. The Worker derives
the organization from the verified session, chooses the table, injects the
organization predicate, and keeps Electric source credentials server-side.

Collection modes reflect cardinality:

- categories: eager
- products, batches, invoices, invoice items: progressive
- stock movements: on demand

The application reads these collections through TanStack live queries. It does
not query platform SQLite directly.

## Writes

Simple category, product, and batch edits use `POST /api/inventory/mutations`.
The Worker treats authenticated organization and user claims as authoritative,
checks row versions, and commits the submitted entity operation in Postgres.

Cross-table rules use named commands:

- `POST /api/inventory/invoices` allocates stock and writes invoice, items,
  batches, and stock movements atomically.
- `POST /api/inventory/imports` reuses or creates products and writes batches
  and matching `stock_in` movements atomically.

Every command has a stable command/operation ID. A Postgres receipt stores the
canonical payload hash and result needed to acknowledge a lost-response retry
without applying the command twice. The response includes the Postgres
transaction ID; affected TanStack Electric collections wait for that ID before
the UI treats the write as confirmed.

Writes are currently online-first. Persisted TanStack collections make reads
available offline, but they do not create a durable write queue. If offline
writes become a product requirement, add TanStack Offline Transactions as a
separate client outbox; do not reintroduce a Durable Object or make SQLite an
authority.

## Infrastructure

Alchemy provisions the Neon project with logical replication, applies the
checked-in Drizzle Postgres migrations, and configures Hyperdrive for Worker
writes. Electric uses Neon's direct connection; Hyperdrive uses the direct
origin in production and the pooled development origin locally.

Required deployment settings are:

- `NEON_API_KEY` for Alchemy provisioning
- `ELECTRIC_URL`
- optional `ELECTRIC_SOURCE_ID`
- optional secret `ELECTRIC_SOURCE_SECRET`

Electric routes fail closed when `ELECTRIC_URL` is absent.

## Platform boundaries

- Browser persistence is dynamically imported only by the browser host.
- Electron persistence is dynamically imported only by the Electron renderer;
  its main process accepts one fixed SQLite IPC protocol.
- Electron's authenticated HTTP bridge allows Electric GETs and only the three
  inventory POST command routes.
- Expo constructs TanStack and Electric collections inside its own dependency
  graph to avoid duplicate runtime identity.
- Replica namespaces use API source plus organization, not user identity.

## Operational checks

- Electric proxy parameters cannot override table, organization predicate,
  source ID, or source secret.
- Command retries with the same ID and payload are idempotent; the same ID with
  a different payload is rejected.
- Invoice and import transactions never expose partial rows.
- Browser multi-tab coordination, Expo resume, Electron cache corruption
  recovery, and schema-version resync are verified against the real adapters.
- Existing Durable Object data must be exported to Postgres and verified. Keep
  the original Cloudflare namespace, class, binding, and migrations deployed
  until an explicit, separately approved retirement. There is no runtime
  dual-write bridge.
