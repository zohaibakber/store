# Store

Shared vocabulary for inventory, sales, and how each client scopes work to an
organization.

## Language

**Authenticated workspace.**
The signed-in user's selected organization, plus its isolated local catalog
replica. At most one authenticated workspace is active.
_Avoid_: Session, active organization

**Catalog.**
The organization's products, categories, batches, invoices, and stock
movements as one business record, not a bag of replica internals.
_Avoid_: Inventory bag, collections, PowerSync database

**Catalog replica.**
The local IndexedDB copy of the catalog pulled from Postgres. Clients read it;
they do not treat it as authority.
_Avoid_: Local database, client DB, live inventory

**Catalog write.**
A row-list command that changes categories, products, or batches. Postgres
commits it; the replica uploads it.
_Avoid_: SyncOperation, live sync, mutation envelope

**Invoice.**
A recorded sale against catalog stock.
_Avoid_: Bill, order, receipt

**Update workflow.**
Main-process lifecycle that checks for releases, runs a user-requested download,
publishes progress, and installs the downloaded build.
_Avoid_: Updater timer, update hook
