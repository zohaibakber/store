# Products catalog

Products is the catalog list. A signed-in user browses products, opens one, imports a file, or adds a product with name, category, and related fields.

## Sub-features

- `products-list` opens `/products` with heading `Products`.
- `products-add-open` opens the add form from `Add product`.
- `products-import-open` opens `/products/upload` from `Import`.
- `products-create` submits `Create product` and the new row is visible on the list.

## How to get to it (user POV)

- Choose `Products` in the sidebar.
- Open `/products`.
- From the list, choose `Add product` or `Import`.
- Open a row to `/products/$productId`.

## Driving it with Cursor browser

Preconditions:

- Doctor reports `spa ok` and `api ok`.
- A signed-in organization session exists.
- For `products-create`, no product is named `Verify Panadol 500mg`.

- **Open list.** Choose `Products` or go to `http://127.0.0.1:5174/products`. The `h1` is `Products`. Controls `Import` and `Add product` are visible. An empty table is allowed; an alert `Could not load products` is a failure unless doctor already showed the API down (then skip).
- **Open add form.** Choose `Add product`. URL is `/products/new`. Heading is `Add product`. Buttons `Cancel` and `Create product` are visible. Field `Product name` is present.
- **Cancel add.** Choose `Cancel`. URL returns to `/products` and the `h1` is `Products`. No new row named `Verify Panadol 500mg`.
- **Create product.** Choose `Add product` again. Fill `Product name` with `Verify Panadol 500mg`. Fill any other required fields the form still blocks on until `Create product` is enabled. Choose `Create product`. Return to `/products` (or land on the product detail). The catalog shows `Verify Panadol 500mg`.
- **Open import.** From `/products` choose `Import`. URL is `/products/upload`.
- **Proof.** Save list and form snapshots under `artifacts/products/`. Creation proof must include the list (or detail) after submit, not only the form.

## Gotchas

- `Create product` stays disabled until the form’s required fields validate. Do not call `/api/inventory/*` to insert the row.
- Category uses “Search or add a category…”. Creating a category as a side effect is still the user path.
- Import while offline shows `You're offline` copy; that is not a list failure.
