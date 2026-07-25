# Plan 021: Dead-code register

Everything the libSQL migration leaves behind, why it is still there, and what
has to happen before it can go. Nothing in this list is load-bearing for new
work — it is all scheduled removal.

Keep this updated as phases land. When an item is deleted, strike it rather than
removing the row, so the reason it existed stays discoverable.

**Note**: `plans/` used to be gitignored, so everything here — including _why_
the advisory lock and the row locks were deleted — existed on one disk only. It
is tracked as of 2026-07-25. The directory stays at the repo root rather than
moving under `docs/`, because the `/improve` and `/improve-react` skills write
to `plans/` by name and would otherwise recreate it and split the history.

Status legend: 🔴 dead now, blocked · 🟡 dead after phase 5 · 🟢 deletable today

---

## ✅ Removed (2026-07-25)

| Item                                                                      | Outcome                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~`asarUnpack: ["**/*.node", "**/*.wasm", "**/*.data"]`~~                 | Trimmed to `["**/*.node"]`. The wasm/data globs existed for PGlite's WASM build and `.tar.gz` extension bundles.                                                                     |
| ~~`dataDir: path.join(..., "pglite")`~~                                   | Renamed to `"data"` across 9 test files **and** `electron/main.ts:308,323`. Note the main-process ones are real user-data paths — safe to change only because the app is pre-launch. |
| ~~`test-support.ts` on `PgliteClient`/`PgDrizzle`~~                       | Rewritten onto `LibsqlClient`. This one file was the root of all 20 remaining type errors; fixing it took the workspace to zero.                                                     |
| ~~`packages/persistence` → `@effect/sql-pglite`, `@electric-sql/pglite`~~ | Fully gone; no source or test in the package references PGlite any more.                                                                                                             |

## ✅ Phase 5 items — all resolved (verified 2026-07-25)

Every row in the table below has been carried out. Re-verified by search:
`store.schema.pg.ts`, `auth.database.ts`, `migrations/remote/`,
`drizzle.remote.config.ts` and the Hyperdrive binding no longer exist; `pg`,
`@types/pg`, `kysely`, `@effect/sql-pglite` and `@electric-sql/pglite` appear in
no manifest or catalog; and no source file imports `drizzle-orm/pg-core`,
`effect-postgres` or `@electric-sql/*`.

Two Postgres mentions survive **on purpose**, both explanatory comments saying
why something is absent — `do/sync.schema.ts:16` and `sync/operation.ts:33`, on
the removed advisory lock. Keep them; they are the record of a deliberate
deletion.

The table is retained below as history, per the striking rule at the top.

| Item                                                                                             | Why it existed                                                                                                                                                                                            | Resolved                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/shared/store.schema.pg.ts`                                                      | **The one deliberate duplication in the migration.** A verbatim Postgres copy of the shared store schema, so `apps/server` keeps compiling while the local side is on SQLite. Carries a delete-me header. | Phase 5. Until then **any change to `store.schema.ts` must be mirrored here** — this is the highest-risk item on this page, because drift is silent.                                                                                                                                                                                                                                                          |
| `packages/db/src/remote/schema.ts` + `remote/sync.schema.ts` re-pointing to `.pg`                | Same reason.                                                                                                                                                                                              | Phase 5 — repoint at `store.schema.ts` and delete the fork.                                                                                                                                                                                                                                                                                                                                                   |
| `packages/db` deps: `pg`, `@types/pg`, `kysely`                                                  | Used only by the remote/auth database path.                                                                                                                                                               | **Phase 5 — all three now go**, because auth moves to D1 (decided 2026-07-25). `pg` and `@types/pg` are unambiguously dead once that lands. `kysely` survives only if better-auth is wired through `kysely-d1`; using drizzle's D1 adapter instead removes it too and is more consistent with the rest of the codebase. This is also the transitive route by which `pg` reaches the desktop dependency graph. |
| `packages/db/src/remote/auth.database.ts`                                                        | Kysely + `PostgresDialect` + `pg.Pool`, built from `HYPERDRIVE.connectionString`.                                                                                                                         | Phase 5. Replaced by a D1-backed auth database.                                                                                                                                                                                                                                                                                                                                                               |
| `packages/db/src/remote/auth.schema.ts` — `pgTable`, `timestamp`, `boolean`                      | Postgres auth tables.                                                                                                                                                                                     | Phase 5 — port to `sqliteTable`. Note `timestamp()` has no SQLite equivalent; better-auth expects dates, so use `integer({ mode: "timestamp" })` rather than the epoch-millis helper the store schema uses.                                                                                                                                                                                                   |
| `apps/server/src/runtime/worker.ts:25` — `createAuthDatabase(c.env.HYPERDRIVE.connectionString)` | Wires auth to Postgres.                                                                                                                                                                                   | Phase 5 — becomes the D1 binding.                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server` deps: `@effect/sql-pglite`, `@electric-sql/pglite`                                 | PGlite is the server's **test** Postgres (`apps/server/src/sync/database.test.ts`).                                                                                                                       | Phase 5, when the server's store is DO SQLite and its tests run against that instead.                                                                                                                                                                                                                                                                                                                         |
| `@effect/sql-pglite` entry in the root `workspaces.catalog`                                      | Only `apps/server` still references it.                                                                                                                                                                   | Phase 5.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/sync/operation.ts:35-36` — `pg_advisory_xact_lock(hashtextextended(...))`       | Guards inbox idempotency against concurrent writers.                                                                                                                                                      | Phase 5. A Durable Object is single-threaded, so the lock becomes meaningless rather than merely replaceable. The `(organizationId, operationId)` uniqueness plus the payload-hash check carry the idempotency on their own. **Do not delete before the DO move** — under Postgres it is still doing real work.                                                                                               |
| `packages/db/migrations/remote/**` + `drizzle.remote.config.ts`                                  | Postgres migrations for the sync server.                                                                                                                                                                  | Phase 5, replaced by SQLite migrations for the DO.                                                                                                                                                                                                                                                                                                                                                            |
| Hyperdrive binding in `apps/server/wrangler.jsonc`                                               | Postgres connection pooling.                                                                                                                                                                              | Phase 5.                                                                                                                                                                                                                                                                                                                                                                                                      |

## Superseded plans

| Plan                              | Status                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 017 — `::bigint` money aggregates | **Obsolete if 021 lands.** SQLite INTEGER is 64-bit and returns a JS number, so the string-concatenation hazard cannot occur. Its casts are already gone from `analytics-store.ts` on this branch. **Port its tests, not its casts.** Branch `advisor/017-bigint-money-aggregates` should be closed unmerged once 021 lands. |
| 019 — outbox backoff              | Still valid and still wanted, but written against the Postgres sync-engine and currently has 2 failing tests. Rebase onto the SQLite engine rather than merging first. Its `array_agg(... ORDER BY ...) FILTER (WHERE ...)` and `bool_or` have no SQLite equivalents and need rewriting (`bool_or` → `max(...)` over 0/1).   |

## Not dead — do not remove

Recorded because they look removable and are not.

| Item                                                                                              | Why it stays                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/components/search-page.tsx`                                                     | Matched a `pg`-ish grep only incidentally. It consumes `searchProducts` through IPC and is dialect-agnostic.                                                                                                                                                                                                                                                                                                                                                                |
| `verify-after-pack.cjs` forbidden renderer markers (`categories_organization_id_name_uidx`, etc.) | These index names are unchanged in the SQLite schema, so the guard still works as written.                                                                                                                                                                                                                                                                                                                                                                                  |
| `epochMilliseconds()` helper name                                                                 | Now returns `integer({ mode: "number" })` rather than `bigint`, but the domain meaning is unchanged and it is used in ~20 places. Renaming is churn.                                                                                                                                                                                                                                                                                                                        |
| `"**/*.node"` in `asarUnpack`                                                                     | This is precisely what makes libSQL work in a packaged build.                                                                                                                                                                                                                                                                                                                                                                                                               |
| The ten unimported primitives in `apps/desktop/src/components/ui/`                                | **Owner decision, 2026-07-25 — do not delete these.** `ui/` is a registry surface managed by `components.json`, not application code. An unimported primitive there is inventory, not dead code, and removing it only means re-adding it from the registry later. The advisor finding at `plans/README.md:383` should be treated as closed, not pending. Application-level leftovers (`nav-projects`, `nav-secondary`, `use-mobile`) are a different case and were deleted. |

## Phase 5 ordering (why it cannot be sliced)

Phases 3 and 4 could land incrementally because the temporary `store.schema.pg.ts`
fork insulated the server. Phase 5 has no such seam: `remote/schema.ts` currently
barrels **auth (Postgres)** together with **store + sync (moving to SQLite)**, and
`drizzle.remote.config.ts` generates migrations from that barrel. Splitting it
breaks `apply-change.ts`, `operation.ts`, and `database.client.ts` the moment it
happens, so the schema split and the driver swap must land together.

Done so far (additive, nothing consumes it, workspace green):

- `packages/db/src/do/{sync.schema,schema,relations}.ts`
- `packages/db/drizzle.do.config.ts` + generated `migrations/do`

Remaining, in dependency order:

1. Port `remote/auth.schema.ts` to `sqliteTable`; replace `auth.database.ts` with
   a D1-backed database; add the D1 binding to `wrangler.jsonc`.
2. Point `remote/schema.ts` and `remote/relations.ts` at **auth only**; retarget
   `drizzle.remote.config.ts` at the D1 auth schema (dialect `sqlite`).
3. **Delete `shared/store.schema.pg.ts`** — the fork's whole purpose is served.
4. Swap `sync/database.client.ts` from `effect-postgres` to `effect-sqlite-do`.
   **Pass `storage: DurableObjectStorage`** — the drizzle types warn that
   transactions are silently broken without it.
5. Add the `OrganizationStore` Durable Object class keyed by `organizationId`,
   run `migrations/do` on first access, and route `/api/sync` to it.
6. Delete `pg_advisory_xact_lock` from `sync/operation.ts`.
7. Drop Hyperdrive, `pg`, `@types/pg`, and the PGlite test deps; rewrite
   `apps/server/src/sync/database.test.ts` against DO SQLite.

`makeDatabase(db)` in `sync/database.ts` already accepts only
`Pick<SyncDrizzle, "transaction">`, so the sync business logic itself needs no
changes — the work is all schema, client, and wiring.

## Cross-platform packaging note (found during the first packaged build)

`electron-builder` reported:

```
missing optional dependencies  dependencies=["@libsql/darwin-arm64", "@libsql/linux-arm64-gnu",
  "@libsql/darwin-x64", "@libsql/win32-x64-msvc", ...]
```

libSQL ships its prebuilt N-API binary as one optional dependency per platform,
and a package manager installs only the one matching the current machine. The
Linux x64 build is therefore fine, but **a macOS or Windows artifact must be
built on that platform** (or with those optional dependencies force-installed),
or the app will ship without a usable `index.node`.

`electron-builder.json5` targets mac (dmg), win (nsis) and linux (AppImage), so
whichever CI job builds each target needs the matching platform package present.
This did not exist as a concern under PGlite, which was pure WASM.

Verified on Linux x64: `app.asar.unpacked/node_modules/@libsql/linux-x64-gnu/index.node`
is present, the boundary guard passes (5.9 MB asar, 32 runtime packages), and
`@electron/rebuild` completes without compiling — N-API means no rebuild.

## Invariant introduced by this migration

Not dead code, but new and easy to violate — recorded here because this is the
page someone reads before deleting things.

**Outbox rows must never be hard-deleted.** `clientSequence` was a Postgres
`bigserial`; it is now allocated as `max(clientSequence) + 1` per
organization+device inside the enqueue transaction. Acknowledgement sets
`acknowledgedAt` and leaves the row. A future "prune acknowledged operations"
feature would let a sequence number be reused and silently corrupt sync
ordering. If pruning is ever wanted, move the counter into its own table first —
`invoiceCounters` is the established pattern.
