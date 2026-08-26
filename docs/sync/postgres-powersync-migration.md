# Postgres, PowerSync, and TanStack DB

## Decision

Neon Postgres is the only inventory authority. PowerSync replicates those rows
to clients. TanStack DB is the application query and mutation layer, backed by
PowerSync SQLite on Electron and Expo.

Categories, products, and batches have a durable local write queue. Imports and
invoice issuance remain online commands because they span multiple tables.
Invoice data still syncs down for existing screens.

## Data flow

1. The auth Worker issues ES256 access tokens with the stable key ID
   `tabaaq-auth-v1` and publishes `/.well-known/jwks.json`.
2. The API returns the current access token and stage-specific PowerSync
   endpoint from `GET /api/powersync/credentials`.
3. PowerSync validates audience `tabaaq-api` and uses the signed `org` claim in
   `powersync/sync-config.yaml` to isolate every stream.
4. TanStack DB writes to PowerSync SQLite immediately. PowerSync durably queues
   changes and the connector uploads full category, product, or batch rows to
   the idempotent `/api/inventory/mutations` endpoint.
5. The Worker validates row versions and commits to Postgres. PowerSync then
   streams the canonical row back to every device in the organization.

The Worker never gives clients a Postgres credential. The PowerSync service
receives the logical-replication connection.

Idempotency receipts live in `inventory_mutation_receipts`. That table is the
live write-path ack store.

## Preview rollout

Do not point preview at production Postgres or the production Durable Object.
Use a separate preview Neon database, PowerSync project, auth keys, and
`POWERSYNC_URL`.

Before testing:

1. Export the production Durable Object inventory and import it into preview
   Postgres using the existing organization IDs. Treat this as a one-way seed,
   not continuous replication.
2. Compare per-table and per-organization counts for categories, products,
   batches, invoices, invoice items, and stock movements.
3. Configure the preview PowerSync source with the preview Postgres direct
   connection and apply `powersync/sync-config.yaml`.
4. Configure PowerSync JWT validation with the preview auth Worker's JWKS URL
   and audience `tabaaq-api`.
5. Set the Development GitHub Environment variable `POWERSYNC_URL` to the
   preview PowerSync endpoint, then deploy only the `dev` stage.

The repository does not automate the production-Durable-Object export yet.
That export is a separate safety gate: do not deploy this branch to production
until an idempotent exporter/importer and count reconciliation have run against
a preview copy.

## Existing local data

Authenticated clients have a durable PowerSync upload queue. There is no
hidden leftover authenticated queue from the previous read-replica client.

Desktop requires an authenticated organization before inventory. There is no
signed-out local catalog.

## Compatibility and retirement

Keep the `ORGANIZATION_STORE` Durable Object binding, class, migrations, and
legacy `/api/sync/live` route until production data is exported, reconciled,
and the rollback window closes. The retained route is compatibility code, not
a dual-write system. Do not delete production data as part of the PowerSync
cutover.

Run `vp run check:powersync-migration` to verify the runtime has no Electric
client dependency, no leftover catalog-upload migrator, and that tenant
filtering, JWKS, endpoint, and workflow configuration remain wired.
