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
_Avoid_: Inventory bag, collections

**Catalog replica.**
A device's local copy of an organization's catalog, including changes awaiting
acceptance. It is not the authoritative catalog.
_Avoid_: Local database, client DB, live inventory

**Catalog write.**
A request to change categories, products, or batches together as one operation.
_Avoid_: SyncOperation, live sync, mutation envelope

**Batch.**
A separately tracked quantity of a product, with its own batch number and expiry
date when known.
_Avoid_: Product stock, stock lot

**Invoice allocation.**
The quantity of a product taken from one batch for an invoice item, including any
packs opened to supply loose units.
_Avoid_: Stock take, sale split

**Invoice.**
A recorded sale against catalog stock.
_Avoid_: Bill, order, receipt

**Update workflow.**
Main-process lifecycle that checks for releases, runs a user-requested download,
publishes progress, and installs the downloaded build.
_Avoid_: Updater timer, update hook
