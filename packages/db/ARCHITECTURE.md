# `@store/db` schema ownership

This package owns physical persistence layouts and migration bundles. Domain
and wire codecs live in `@store/contracts`. Sync engines and client facades own
behaviour on top of these layouts.

## Seams

| Export              | Dialect     | Owns                                                                          | Callers                                                    |
| ------------------- | ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `./store.schema`    | SQLite      | Shared catalog tables (categories → stock movements) and managed-column names | Re-exported by the replica schema; contracts `entity-rows` |
| `./replica.schema`  | SQLite      | Client replica control tables + catalog via `store.schema`                    | Electron / sync SQLite adapter                             |
| `./postgres/schema` | Postgres    | Authoritative PlanetScale catalog + receipts + sync control                   | Server inventory commands                                  |
| `./auth.schema`     | SQLite (D1) | Auth identity, orgs, sessions                                                 | Auth worker                                                |

## Rules

1. Catalog column meaning is shared across SQLite `store.schema` and Postgres
   `postgres/schema`, but the layouts are not generated from each other.
   Dialects differ (boolean, bigint timestamps, snake_case names). Change both
   when the catalog shape changes, then generate migrations separately.
2. Do not add domain Effect Schemas here; put those in `@store/contracts`.
3. Migrations stay append-only. Prefer additive columns with defaults over
   rewrites. Never edit applied migration SQL.
4. The replica schema may re-export catalog tables from `store.schema`; it must
   not redefine those tables.

## Managed columns

`storeManagedColumnNames` in `store.schema` is the single list of columns the
authority assigns. Contracts `omitManaged` strips them from client push rows.
