# Store

Shared vocabulary for inventory, sales, and how each client scopes work to an
organization.

## Language

**Authenticated workspace.**
The signed-in user's selected organization, plus its isolated local catalog
replica. At most one authenticated workspace is active.
_Avoid_: Session, active organization

**Catalog layout.**
The physical columns for catalog entities in authoritative Postgres and in the
SQLite catalog projection. Persistence only; not a business aggregate.
_Avoid_: Store schema, replica tables

**Catalog.**
The organization's products, categories, batches, invoices, and stock
movements as one business record, not a bag of replica internals.
_Avoid_: Inventory bag, collections

**Catalog replica.**
The local copy of the catalog, applied from the authority's change log.
Desktop keeps it in SQLite owned by a main-process worker; the web host keeps
it in IndexedDB. Replicas hard-delete on a `delete` change and hold no
`deletedAt`.
_Avoid_: Local database, client DB, live inventory

**Catalog write.**
The `catalogWrite` sync command: an ordered row list that changes categories,
products, or batches. It commits locally as pending rows, then the PlanetScale
Postgres authority decides it in the same organization-locked transaction as
`issueInvoice` and publishes it through the change log.
_Avoid_: SyncOperation, live sync, mutation envelope

**Pending projection.**
The provisional rows a saved command writes into the replica, marked with its
operation id and journalled so rejection restores the prior image. Integration
replaces them with authoritative rows.
_Avoid_: Optimistic cache, shadow state, draft rows

**Command state.**
Where a saved command stands: pending, sending, accepted awaiting integration,
integrated, rejected, or abandoned. It is read through the replica handle, never
as SQL across IPC.
_Avoid_: Sync status, queue state

**Invoice.**
A recorded sale against catalog stock.
_Avoid_: Bill, order, receipt

**Update workflow.**
Main-process lifecycle that checks for releases, runs a user-requested download,
publishes progress, and installs the downloaded build.
_Avoid_: Updater timer, update hook
