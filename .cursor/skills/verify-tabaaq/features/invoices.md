# Invoices

Invoices lists sales for the active organization. A signed-in user searches the list, opens a sale, or starts a new sale.

## Sub-features

- `invoices-list` opens `/invoices` with heading `Invoices`.
- `invoices-search` filters from the `Search invoices` field.
- `invoices-new-open` opens `/invoices/new` with heading `New sale`.

## How to get to it (user POV)

- Choose `Invoices` in the sidebar.
- Open `/invoices`.
- Choose `New sale`.
- Open a row to `/invoices/$invoiceId`.

## Driving it with Cursor browser

Preconditions:

- Doctor reports `spa ok` and `api ok`.
- A signed-in organization session exists.

- **Open list.** Choose `Invoices` or go to `http://127.0.0.1:5174/invoices`. The `h1` is `Invoices`. Control `New sale` and a `Search invoices` field are visible. `Could not load invoices.` is a failure (skip if API is down).
- **Open new sale.** Choose `New sale`. URL is `/invoices/new`. The `h1` is `New sale`.
- **Proof.** Save `artifacts/invoices/list.png` (heading `Invoices`) and `artifacts/invoices/new.png` (heading `New sale`) plus matching ARIA snapshots.

## Gotchas

- Creating a completed sale is a longer path than opening the form. Opening `New sale` proves the entry; do not claim a persisted invoice unless a second view shows it on `/invoices`.
- Row click goes to detail. Assert the customer/title from the list, not an internal id in the URL alone.
