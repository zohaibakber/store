# Home dashboard

Home is the signed-in landing page. It shows inventory health from the active organization: totals, revenue, top products, recent invoices, expiring batches, and low stock.

## Sub-features

- `home-open` opens `/` with app chrome after an authenticated workspace is admitted.
- `home-tiles` shows dashboard sections when inventory data is available.
- `home-offline` shows a saved-inventory or unavailable alert when the live query errors.

## How to get to it (user POV)

- Sign in, then land on `/`.
- Choose `Home` in the sidebar.

## Driving it with Cursor browser

Preconditions:

- Doctor reports `spa ok` and `api ok`.
- A signed-in session with an active organization exists on this origin.
- Start at `/sign-in` only if that session is missing; complete Sign in first.

- **Open home.** Navigate to `http://127.0.0.1:5174/` or choose the `Home` sidebar link. The URL is `/`. App chrome includes `Home`, `Products`, `Invoices`, and `Settings`. The page is not the sign-in heading.
- **Read dashboard.** Snapshot the main region. Either inventory tiles/charts are present, or an alert titled `Showing saved inventory` / `Could not refresh the dashboard` / `Could not refresh` equivalent copy is visible. `Dashboard storage is unavailable.` or `Dashboard workspace is unavailable.` is a failure.
- **Proof.** Save `artifacts/home/home.aria.txt` and `artifacts/home/home.png` with the chrome and dashboard (or the error alert) visible.

## Gotchas

- Unauthenticated visits redirect to `/sign-in`. That is `sign-in-no-guest`, not a dashboard failure.
- Inventory tiles depend on PowerSync/local SQLite. An empty new organization can look sparse; the chrome and the absence of the storage-unavailable paragraph are still proof the route admitted.
