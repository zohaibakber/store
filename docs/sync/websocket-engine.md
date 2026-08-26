# WebSocket sync engine

## Status

The Cloudflare Durable Object and `/api/sync/live` WebSocket engine is a
preserved compatibility implementation. Postgres, PowerSync, and TanStack DB are
the active inventory architecture for migrated clients.

Keep the WebSocket engine, its Durable Object schema and migrations, and its
shared sync contracts until an explicit retirement confirms that production no
longer needs migration or rollback compatibility. Do not treat unused imports
from a migrated client as proof that the server-side source is safe to delete.

## Active inventory data flow

Postgres is the authoritative inventory database. The active path has four
parts:

1. Electron and Expo read inventory through TanStack DB live queries.
2. PowerSync SQLite durably persists TanStack DB collections on Electron
   and Expo.
3. Authenticated `/api/inventory/*` commands write to Postgres through the
   Cloudflare Worker and Hyperdrive. Mutation receipts make replayed commands
   idempotent after a lost HTTP response.
4. PowerSync reads committed Postgres rows and applies the organization filter
   from the verified JWT before a client receives a stream.

TanStack DB combines PowerSync collections with durable local writes and
reactive queries. Clients no longer maintain a separate handwritten outbox,
pull cursor, or last-writer-wins apply loop for the migrated inventory path.

## Preserved compatibility implementation

The original engine stored each organization's inventory in a Cloudflare
Durable Object. A local SQLite transaction wrote both the business change and a
FIFO outbox entry. The client sent the outbox through a hibernated WebSocket at
`/api/sync/live`, and the Durable Object committed an inbox receipt and an
ordered changelog entry in the same transaction.

The protocol supported correlated `exchange`, `exchange-result`, and
`exchange-error` frames. `hello` and `invalidate` frames prompted clients to
pull from their changelog cursor. Retryable transport failures preserved the
outbox head, while non-retryable failures could quarantine a poison operation.

That design remains useful for three bounded purposes:

- serving any production client that has not completed migration;
- supplying source data or behavior during migration reconciliation;
- supporting rollback while the Postgres and PowerSync path is being adopted.

Compatibility does not make the Durable Object the authority for newly
migrated writes. New inventory work must use Postgres mutation commands,
PowerSync streams, and TanStack DB collections.

## Retirement condition

Remove the preserved engine only through an explicit retirement change. That
change must first establish that no deployed client calls `/api/sync/live`, no
production inventory remains only in Durable Object storage, and no rollback
plan depends on the old protocol. The retirement must remove the implementation,
schema, migrations, contracts, bindings, and deployment configuration as one
reviewed migration.
