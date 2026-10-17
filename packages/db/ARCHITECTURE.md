# `@store/db` schema ownership

This package owns physical persistence layouts and migration bundles. Domain
and wire codecs live in `@store/contracts`. Sync engines and client facades own
behaviour on top of these layouts.

## Seams

| Export               | Dialect     | Owns                                                                          | Callers                                                    |
| -------------------- | ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `./store.schema`     | SQLite      | Shared catalog tables (categories → stock movements) and managed-column names | Re-exported by the replica schema; contracts `entity-rows` |
| `./replica.schema`   | SQLite      | Client replica control tables + catalog via `store.schema`                    | Electron / sync SQLite adapter                             |
| `./authority.schema` | SQLite (DO) | Organization authority: catalog via `store.schema` + log, receipts, snapshots | `OrgAuthority` Durable Object                              |
| `./auth.schema`      | SQLite (D1) | Auth identity, orgs, sessions                                                 | Auth worker                                                |

## Rules

1. The authority schema re-exports the catalog tables from `store.schema` and
   must not redefine them. When the catalog shape changes, generate the replica
   and authority migrations separately.
2. Do not add domain Effect Schemas here; put those in `@store/contracts`.
3. Migrations stay append-only. Prefer additive columns with defaults over
   rewrites. Never edit applied migration SQL.
4. The replica schema may re-export catalog tables from `store.schema`; it must
   not redefine those tables.
