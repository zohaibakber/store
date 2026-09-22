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
The local SQLite copy of the catalog. Desktop reads the organization Durable
Object projection.
_Avoid_: Local database, client DB, live inventory

**Catalog write.**
A row-list command that changes categories, products, or batches. On `dev` and
`prod`, Postgres still commits it. Desktop live inventory does not accept
catalog commands.
_Avoid_: SyncOperation, live sync, mutation envelope

**Invoice.**
A recorded sale against catalog stock.
_Avoid_: Bill, order, receipt

**Update workflow.**
Main-process lifecycle that checks for releases, runs a user-requested download,
publishes progress, and installs the downloaded build.
_Avoid_: Updater timer, update hook
