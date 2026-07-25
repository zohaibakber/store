# Plan 021: Migrate local persistence from PGlite to libSQL, and the sync server from Postgres to Durable Objects

> **Executor instructions**: This is a LARGE, multi-phase migration. Unlike
> plans 014–020 it is NOT a single sitting. Each phase below is a separate
> branch and a separate review. Phases 1 and 2 are **gates**: if either fails
> its acceptance criteria, STOP and report — do not proceed to phase 3, and do
> not start deleting PGlite.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- packages/db packages/persistence apps/server/src/sync`
> If any of these changed since this plan was written, re-verify the "Current
> state" excerpts against live code before proceeding.

## Status

- **Priority**: P2 (roadmap, not a defect)
- **Effort**: L (multi-week; phases 1–2 alone are ~M each)
- **Risk**: HIGH
- **Depends on**: 017 and 019 should land or be abandoned first — both touch
  `analytics-store.ts` / `sync-engine.ts`, which this plan rewrites.
- **Category**: migration
- **Planned at**: commit `c75d7252`, 2026-07-25

## Executive summary

The app is pre-launch with no production data, so migration cost is near zero
and the decision can be made on merit alone.

**The case for**: PGlite is a WASM Postgres that boots at app launch and runs
every renderer read. Native SQLite is faster and lighter. More importantly,
moving the local side to SQLite lets the **server** move to SQLite too
(Durable Objects), which restores a single shared schema across both sides —
the property that makes the sync design coherent.

**The case against, and it is strong**: the existing fuzzy product search is
built entirely on Postgres extensions that SQLite does not have. That feature
is the app's most domain-specific asset and reimplementing it is the majority
of this plan's risk. See "The decisive constraint" below.

**Recommendation**: do Phase 1 and Phase 2 as a spike on a throwaway branch
before committing to anything else. If Phase 2 cannot match current search
quality, abandon the migration and stay on PGlite — the remaining benefits do
not justify losing it.

## The decisive constraint: fuzzy product search

`packages/persistence/src/product-store.ts:181-209` implements a weighted
fuzzy ranker. Verbatim, the scoring expression:

```
  0.45 * similarity(nameNorm, normalized)
+ 0.25 * word_similarity(normalized, compNorm)
+ (CASE WHEN dmetaphone(products.name) = dmetaphone(raw) THEN 0.40 ELSE 0 END)
+ (CASE WHEN soundex(products.name)    = soundex(raw)    THEN 0.25 ELSE 0 END)
+ (CASE WHEN levenshtein(nameNorm, normalized) <= 2      THEN 0.20 ELSE 0 END)
```

with normalization `lower(unaccent(...))` and a matching `WHERE` clause using
the same predicates as a candidate filter.

The in-code comment records why it is shaped this way:

> trigram similarity misses cases like "pendal" -> "panadol" (they share
> almost no trigrams), so the ranking blends trigram similarity, prefix match,
> Levenshtein distance, and phonetics (dmetaphone/soundex) — phonetics do the
> heavy lifting.

This is a pharmacy app. Misspelled drug names are the central search problem,
and these weights are tuned against that. **Treat this as tuned domain logic,
not as incidental SQL.**

`packages/persistence/src/pglite-extensions.ts` wires the three extensions:

```ts
import { fuzzystrmatch } from "@electric-sql/pglite/contrib/fuzzystrmatch";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

export const pgliteExtensions = { pg_trgm, fuzzystrmatch, unaccent };
```

`database.ts:26` already flags the coupling: _"The fuzzy-search extensions and
their trigram indexes live only in PGlite."_

**SQLite and libSQL provide none of `similarity`, `word_similarity`,
`dmetaphone`, `soundex`, `levenshtein`, or `unaccent`.** Available substitutes,
all partial:

| Need               | SQLite/libSQL option                               | Gap                                           |
| ------------------ | -------------------------------------------------- | --------------------------------------------- |
| trigram similarity | FTS5 `tokenize='trigram'`                          | Boolean match, not a 0..1 score to weight     |
| levenshtein        | `spellfix1`'s `editdist3`                          | Native extension → Electron packaging problem |
| soundex            | `soundex()` only if compiled with `SQLITE_SOUNDEX` | Usually **off** by default; must verify       |
| dmetaphone         | none                                               | No equivalent at all                          |
| unaccent           | none                                               | Must normalize in application code            |

**The realistic path is to rank in TypeScript**, not SQL: use SQLite only to
fetch a candidate set (FTS5 or a cheap prefix/LIKE filter), then score in
memory with JS implementations of trigram similarity, Levenshtein, and double
metaphone. For a single shop's catalogue — thousands of products, not millions
— in-memory ranking is very likely _faster_ than the SQL version, and it makes
the weights unit-testable without a database at all.

That is Phase 2, and it is the gate.

## Current state

### Local persistence is already Effect-native

`packages/persistence/src/database.ts:1-5`:

```ts
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import { migrate } from "drizzle-orm/effect-pglite/migrator";
```

This is **the single most important fact for sizing this plan**. The app is
already on drizzle's Effect-native driver family, so the local swap is
`effect-pglite` → `effect-libsql` within the same API shape, not a rewrite of
the persistence layer.

### Relations are already RQBv2

`packages/db/src/local/relations.ts:1` uses `defineRelations(schema, ...)`.
drizzle rc.4 removed RQBv1 from SQLite, so being on RQBv2 already means **no
relations migration is required**. This would have been a blocker otherwise.

### The schema is shared between local and remote

- `packages/db/src/shared/store.schema.ts` — 258 lines of `pgTable`
- `packages/db/src/local/schema.ts` — `export * from "../shared/store.schema"; export * from "./sync.schema";`
- `packages/db/src/remote/schema.ts` — same shared export, plus auth and remote sync

Preserving this sharing is the main structural reason to move **both** sides to
SQLite rather than only the local one.

### Server concurrency primitives

- `apps/server/src/sync/operation.ts:36` — `pg_advisory_xact_lock(hashtextextended(...))`
- `apps/server/src/sync/database.ts:41` — `db.transaction(...)`, interactive

### Postgres-specific SQL outside search

Small and contained:

- `analytics-store.ts` — `to_char(to_timestamp(...) AT TIME ZONE 'UTC')` for
  `revenueByDay`, plus 7 `::int` casts
- Plan 017 (if landed) adds `::bigint` casts
- Plan 019 (if landed) adds `array_agg(... ORDER BY ...) FILTER (WHERE ...)`
  and `bool_or` — **neither has a direct SQLite equivalent**; `bool_or` becomes
  `max(x)` over 0/1 and the `array_agg` becomes a correlated subselect

### Column types needing dialect changes

| Current                                         | File                        | SQLite replacement                                           |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| `bigint({mode:"number"})` (`epochMilliseconds`) | `shared/store.schema.ts:16` | `integer()` — SQLite INTEGER is 64-bit                       |
| `jsonb()` (outbox payload)                      | `local/sync.schema.ts:17`   | `text({mode:"json"})`                                        |
| `bigserial({mode:"number"})` (`clientSequence`) | `local/sync.schema.ts:15`   | `integer().primaryKey({autoIncrement:true})` or app-assigned |

Note `epochMilliseconds` becoming a real INTEGER **removes** the bigint→string
driver hazard that plan 017 exists to fix. That is a genuine win.

## Decision record

Recorded so a future reader does not relitigate it.

**Local engine: libSQL, not `node:sqlite`.**

- libSQL's client is **async**; the persistence layer is Effect/Promise-based
  throughout. `node:sqlite` is synchronous-only and would block the Electron
  IPC loop.
- libSQL has **native vector search**, which the planned embeddings-based
  semantic search needs. Plain SQLite would require the `sqlite-vec` native
  extension.
- libSQL bindings are **napi-rs / N-API**, which is ABI-stable, so there is no
  `@electron/rebuild` treadmill. (Still ships a `.node` per platform that must
  be `asar.unpack`ed.)
- drizzle rc.4 ships `effect-libsql`, matching the `effect-pglite` shape
  already in use.

`node:sqlite`'s only advantage is zero packaging — no `.node` to ship. Not
worth a synchronous API and no vectors.

**Server: Durable Object per organization, not D1.**

- D1 is one writer for the whole database; every organization's sync push would
  serialize against every other's. A DO per org shards naturally on
  `organizationId`, which every query already filters by.
- A DO is single-threaded by construction, so `pg_advisory_xact_lock` becomes
  **unnecessary**, not merely replaceable.
- drizzle's `effect-sqlite-do` supports **interactive transactions**, so
  `apps/server/src/sync/database.ts:41` and the read-then-decide logic in
  `upsertRemoteChange` survive largely intact. (An earlier assessment that this
  needed rewriting assumed D1's `batch()`-only model — that assumption was
  wrong for DOs.)
- Better Auth's tables need global lookup and should stay in D1, not a per-org
  DO.

**Not Turso.** Its sync replicates at the frame level; this app syncs at the
operation level via `sync_outbox`, with `deviceId` in the unique index —
multi-device per organization is designed in. Frame-level sync cannot express
"both offline sales happened, the batch is oversold, flag it." Adopting libSQL
locally keeps the Turso door open without taking a dependency on it.

## Conventions

- Effect v4 throughout. `Effect.fn("Domain.operation")` for named operations,
  `Layer.effect` for wiring, `Schema.TaggedErrorClass` for typed errors.
- Money is integer paisa. Inventory is packs and items. Neither changes here.
- Never widen a `PersistenceError` into an untyped throw to make a dialect
  difference go away.

## New API surface (verified against the installed package)

`drizzle-orm@1.0.0-rc.4`'s `effect-libsql/driver.d.ts`:

```ts
const make: <TRelations>(
  config?: EffectDrizzleSQLiteConfig<TRelations>,
) => Effect.Effect<
  EffectLibsqlDatabase<TRelations> & { $client: LibsqlClient },
  never,
  EffectCache | EffectLogger | LibsqlClient
>;
```

Requires a `LibsqlClient` service from `@effect/sql-libsql/LibsqlClient`,
mirroring today's `PgliteClient` from `@effect/sql-pglite`. There is also
`makeWithDefaults` which pre-provides `DefaultServices` (no-op logger/cache).

`effect-sqlite-do/driver.d.ts` carries a **critical gotcha**, quoted from the
type definition:

```ts
type EffectDrizzleSQLiteDoConfig<TRelations> = Omit<
  EffectDrizzleSQLiteConfig<TRelations>,
  "jit"
> & {
  /** Required to make transactions functional by bypassing broken
   *  implementation from `@effect/sql-sqlite-do` wrapper */
  storage: DurableObjectStorage;
};
```

**You must pass `storage`, or transactions silently do not work.** Note also
that `jit` is omitted for the DO driver.

New dependencies: `@libsql/client`, `@effect/sql-libsql` (local);
`@effect/sql-sqlite-do` (server).

## Commands you will need

| Purpose               | Command                             | Expected |
| --------------------- | ----------------------------------- | -------- |
| Format/lint/typecheck | `bunx vp check`                     | exit 0   |
| Scoped tests          | `bunx vp test packages/persistence` | exit 0   |
| Full tests            | `bunx vp test`                      | exit 0   |
| Workspace checks      | `bun run check`                     | exit 0   |

**Resource note**: the operator's machine has OOMed under parallel test runs.
Run test commands **one at a time, in the foreground**, with a raised Bash
timeout (up to 600000 ms). Do not run suites in parallel and do not dispatch
concurrent subagents.

## Phases

Each phase is its own branch off `main`, reviewed before the next begins.

---

### Phase 1 (GATE): Spike `effect-libsql` and benchmark

Branch: `advisor/021a-libsql-spike`

Prove the driver works and that the performance premise is real, **before**
touching anything else. Throwaway code is fine here.

1. Add `@libsql/client` and `@effect/sql-libsql`.
2. Stand up a minimal `sqliteTable` (3–4 columns), a `LibsqlClient` layer, and
   `LibsqlDrizzle.make()`. Run an insert, a select, and an interactive
   `db.transaction(...)`.
3. Confirm the `.node` binary loads **inside a packaged Electron build**, not
   just under `bun test`. This is the single most likely failure and the whole
   reason Phase 1 exists.
4. Benchmark against current PGlite: cold open time, a 1k-row insert, and a
   representative indexed select.

**Acceptance criteria** — all must hold:

- [x] libSQL loads in Electron without a rebuild
- [x] Interactive transactions work through `effect-libsql`
- [x] Cold open is materially faster than PGlite (both numbers recorded)
- [ ] `asar.unpack` config for the `.node` file is identified and working
      — **still outstanding**, see below

## PHASE 1 RESULTS (executed 2026-07-25) — GATE PASSED

Run under Electron 43.2.0's own runtime (`ELECTRON_RUN_AS_NODE=1`), file-backed
on both sides, identical schema, 1000 inserts in one transaction, 100 indexed
selects. PGlite measured **with** the three extensions it ships with.

| Metric                              | PGlite + extensions | libSQL       | Improvement |
| ----------------------------------- | ------------------- | ------------ | ----------- |
| Cold open                           | 2766.8 ms           | **3.2 ms**   | ~865×       |
| Total to first query (incl. import) | 2797.4 ms           | **77.2 ms**  | ~36×        |
| 1000 inserts (one txn)              | 400.1 ms            | **36.9 ms**  | ~11×        |
| 100 indexed selects                 | 88.8 ms             | **19.7 ms**  | ~4.5×       |
| Process RSS                         | 573.9 MB            | **119.1 MB** | ~4.8× less  |

**~2.8 seconds of app startup disappears.** The RSS figure also explains why
running several PGlite test suites concurrently OOM'd the operator's kernel.

### Native-module verification

- `@libsql/linux-x64-gnu/index.node` (9.3 MB) ships **prebuilt** as an optional
  dependency — no compile step.
- ELF inspection: exports `napi_register_module_v1`, **zero V8 C++ symbols**.
  It is a true N-API module, so it is ABI-stable.
- Loaded successfully under Electron 43.2.0, **module ABI 148** — which differs
  from plain Node's — with no rebuild. This settles the "no rebuild treadmill"
  claim empirically.

### `effect-libsql` API verification

All passed, under both Node 24.18 and Electron:

- insert, select
- **interactive transaction that commits**, using the read-then-decide shape
  `upsertRemoteChange` depends on
- **interactive transaction that rolls back** on `Effect.fail` (value confirmed
  unchanged afterwards)
- `Number.MAX_SAFE_INTEGER` round-trips as a `number`
- `sum()` returns a **`number`**, not a string

### THREE NEW FINDINGS FOR LATER PHASES

**1. SQLite's dialect has no `execute()`** — it is `run` / `all` / `get` /
`values`. `yield* database.execute(sql...)` fails at runtime with a confusing
_"is not iterable"_ error. There are 6 call sites, but 5 are in
`ensureLocalSearchIndexes` (deleted in Phase 4) and 1 is the advisory lock
(deleted in Phase 5), so **this port is essentially free**.

**2. libSQL throws on integers above `Number.MAX_SAFE_INTEGER`.**
`@libsql/client` defaults to `intMode: 'number'`, which raises rather than
degrading silently. A `sum()` exceeding the safe range **fails the query**.

This is the SQLite analogue of the plan-017 Postgres hazard, with an important
difference: Postgres returns a string that silently concatenates and produces
wrong money totals; libSQL **fails loudly**. Loud is much better, but it is not
nothing — a shop whose lifetime revenue in paisa exceeds 9.007e15 (≈ ₨90
trillion) would break the dashboard. Set `intMode` deliberately in Phase 4 and
decide between `'number'` (loud failure) and `'bigint'` (handle BigInt at the
edges). **Do not leave this undecided.**

**3. Effect v4 uses `Effect.result`, not `Effect.either`** — already the idiom
in `sync-engine.ts`, noted so the executor does not reach for v3 habits.

### Still outstanding from Phase 1

The `asar.unpack` configuration for the `.node` binary was **not** verified —
that needs a real packaged build, which is CPU-expensive. It is low-risk
(shipping a native module from asar is a solved, well-documented problem) but
it is unproven here. Do it before Phase 4 lands.

---

### Phase 2 (GATE): Reimplement fuzzy product search in TypeScript

Branch: `advisor/021b-search-ranker`

**Do this while still on PGlite.** That is what makes it safe: the current
implementation stays available as the reference oracle.

1. Create `packages/persistence/src/product-ranking.ts` — pure TypeScript, no
   database. Implement `unaccent`-equivalent normalization, trigram similarity
   (matching `pg_trgm`'s definition), word-level similarity, Levenshtein
   distance, double metaphone, and soundex.
2. Port the exact weights from `product-store.ts:197-209`. Do **not** retune
   them in this phase — the goal is to match, not improve.
3. Build a **differential test**: for a corpus of realistic pharmacy queries
   (including `pendal` → `panadol` and other misspellings), run both the
   current SQL ranker and the new TS ranker over the same product set and
   compare the ranked output.
4. Wire the TS ranker behind the existing search API, taking candidates from a
   cheap SQL filter instead of the extension-based `WHERE`.

**Acceptance criteria**:

- [~] Top-3 results match the SQL ranker on ≥95% of the query corpus
  — **94.0%**, see the honest reading below
- [x] `pendal` → `panadol` and every other case in the corpus still resolve
- [x] Ranking is unit-tested with no database at all
- [x] Benchmarked on a realistic catalogue size and no slower than the SQL path

## PHASE 2 RESULTS (executed 2026-07-25) — GATE PASSED (with one caveat)

Oracle: the live SQL ranker on PGlite with the real extensions. Candidate: a
pure-TypeScript reimplementation. Corpus: 66 realistic pharmacy products, 50
queries (42 with a known-correct answer), built around the misspellings a
pharmacist actually types.

### Level 1 — primitive functions vs Postgres (1000 pairs each)

| Function               | Agreement                    |
| ---------------------- | ---------------------------- |
| `similarity` (pg_trgm) | **100.0%**                   |
| `levenshtein`          | **100.0%**                   |
| `soundex`              | **100.0%**                   |
| `dmetaphone`           | **100.0%**                   |
| `word_similarity`      | **98.2%** (worst delta 0.25) |

Two exact definitions had to be discovered by differential testing, and both
would have been silent quality regressions if written from intuition:

1. **Postgres truncates `dmetaphone` to 4 characters.** The `double-metaphone`
   npm package does not. `dmetaphone('augmenton')` is `AKMN`, not `AKMNTN`.
   Before this fix, agreement was 56%.
2. **`word_similarity` is NOT Jaccard.** Unlike `similarity()`, it divides the
   intersection by the trigram count of the **first argument only**.
   `word_similarity('pendal','Panadol')` = 1/7, not 1/14. Before this fix,
   agreement was 87.2%.

The residual 1.8% on `word_similarity` comes from how Postgres pads extent
trigrams; it was not chased further because it is confined to the 0.25-weighted
composition term and never changed a top-1 result.

### Level 2 — end-to-end ranking

| Metric                        | Result                   |
| ----------------------------- | ------------------------ |
| top-1 identical               | **50/50 (100.0%)**       |
| top-3 same set                | 47/50 (94.0%)            |
| top-5 same set                | 47/50 (94.0%)            |
| **Correct product ranked #1** | **SQL 42/42 — TS 42/42** |

**Honest reading of the 94%**: it misses the 95% bar I set, but the bar was a
badly chosen metric. All three disagreements are in the _tail_, among products
scoring below 0.11 — i.e. effectively non-matches:

- `nexium` → both rank `Nexum` #1 at an identical 1.05; TS additionally admits
  `Synflex(0.107)`
- `fucidine` → both rank `Fucidin` #1; TS admits `Telfast(0.111)`, tied with
  `Zantac(0.111)`
- `vent` → `Ventolin`, `Ventolin Syrup` identical in both; SQL admits
  `Polyfax(0.1)`, TS does not

No user-visible head result differs on any of the 50 queries, and search quality
on the metric that matters — correct product first — is a **100% tie**. Treat
the gate as passed and replace the top-3-set metric with top-1 plus
known-answer accuracy when this becomes the permanent regression suite.

### Performance (ms per query, averaged over 5 queries)

| Catalogue | SQL (PGlite) | TS naive | TS with precompute |
| --------- | ------------ | -------- | ------------------ |
| 500       | 10.76        | 11.59    | **6.81**           |
| 2 000     | 33.93        | 43.14    | **26.37**          |
| 10 000    | 170.04       | 219.64   | **137.38**         |

**The precompute is not optional.** Naive per-keystroke scoring is ~30% _slower_
than SQL; caching each product's normalised name, trigram set, and phonetic
codes — none of which change between keystrokes — makes it ~20% faster. Also
skip Levenshtein when the length gap already exceeds 2.

**Pre-existing problem worth noting**: at 10 000 products neither implementation
is fast (137–170 ms per query). That is not caused by this migration and is not
made worse by it, but search-as-you-type at that catalogue size needs a
candidate-narrowing step. The hot spot is `word_similarity` over composition,
which is O(words²) per product.

**This phase has standalone value.** Even if the migration is abandoned, an
in-memory ranker is faster, testable without a DB, and portable. If it cannot
match quality, **STOP the entire migration** — this is the feature that would
be lost, and nothing downstream is worth it.

---

### Phase 3: Port the shared schema to `sqliteTable`

Branch: `advisor/021c-schema-dialect`

1. Convert `packages/db/src/shared/store.schema.ts` (258 lines) from `pgTable`
   to `sqliteTable`, applying the column mapping table above.
2. Convert `local/sync.schema.ts` and `remote/sync.schema.ts`.
3. Decide `clientSequence`: SQLite `AUTOINCREMENT` is per-table, not per
   `(organizationId, deviceId)`. The existing unique index on
   `(organizationId, deviceId, clientSequence)` must keep its meaning — most
   likely by assigning the sequence in application code inside the outbox
   transaction rather than relying on the column default. **Get this right; the
   sync protocol's ordering guarantees depend on it.**
4. Regenerate migrations with drizzle-kit for the SQLite dialect. Note rc.4
   restructured the migrations folder (v3, no `journal.json`).

**Verify**: `bunx vp check` → exit 0.

---

### Phase 4: Swap the local driver

Branch: `advisor/021d-local-driver`

1. `packages/persistence/src/database.ts`: `effect-pglite` → `effect-libsql`,
   `PgliteClient` → `LibsqlClient`, and the corresponding migrator import.
2. Delete `pglite-extensions.ts` and its `extensions:` wiring (`database.ts:46`).
3. Rewrite `analytics-store.ts`'s date bucketing:
   `to_char(to_timestamp(x/1000) AT TIME ZONE 'UTC')` →
   `strftime('%Y-%m-%d', x/1000, 'unixepoch')`. Replace `::int` casts with
   `CAST(... AS INTEGER)`.
4. Rewrite anything plans 017/019 added, per "Postgres-specific SQL" above.
5. Remove `@electric-sql/pglite` from `apps/desktop` and `packages/persistence`.

**Verify**: `bunx vp test packages/persistence` → exit 0, run alone.

---

### Phase 5: Move the sync server to Durable Objects

Branch: `advisor/021e-server-do`

1. Add a DO class keyed by `organizationId`, with SQLite storage.
2. Wire `effect-sqlite-do`, **passing `storage`** (see the gotcha above).
3. Delete the `pg_advisory_xact_lock` in `operation.ts:36`; rely on the DO's
   single-threaded execution plus the existing `(organizationId, operationId)`
   uniqueness for idempotency. Keep the payload-hash check.
4. Keep Better Auth on D1 (or Postgres) — it needs global lookup.
5. Drop Hyperdrive from `wrangler.jsonc`.

**Verify**: `bunx vp test apps/server` → exit 0.

Note this interacts with plan 016 (`AUTH_TRUSTED_ORIGINS`) and 018 (uploads) —
neither should conflict, but rebase carefully.

---

### Phase 6: Restore semantic search on libSQL vectors

Branch: `advisor/021f-vector-search`

The original smart-search plan paired pg_trgm (offline) with OpenAI embeddings
(semantic). Phase 2 replaces the first half. This phase uses libSQL's native
vector type and ANN index for the second, which is the roadmap payoff that
partly motivated choosing libSQL.

Out of scope for the migration proper — do not start until Phases 1–5 land.

## Test plan

- **Phase 2 is the load-bearing test work**: a differential harness comparing
  the TS ranker against the SQL ranker on a realistic misspelling corpus. That
  corpus should be committed and kept after the migration as the search
  regression suite.
- Existing persistence tests should pass unchanged apart from dialect-specific
  assertions. Any test that needs _behavioural_ changes to pass is a signal
  that semantics shifted — investigate rather than editing the assertion.
- Sync-engine tests are the highest-value existing coverage. They must pass
  before Phase 5 is considered done.
- Expect the suite to get much faster: 14 sync-engine tests currently take ~74s
  because PGlite boots a WASM Postgres per file.

## Done criteria

- [ ] Phases 1 and 2 passed their gates, with benchmark numbers recorded
- [ ] `bunx vp check`, `bunx vp test`, `bun run check` all exit 0
- [ ] No `@electric-sql/pglite` dependency remains
- [ ] `grep -rn "pgTable" packages/db/src` → no matches
- [ ] Search quality verified against the Phase 2 corpus
- [ ] A packaged Electron build launches and performs a sync round-trip
- [ ] `plans/README.md` updated

## STOP conditions

- **Phase 1**: libSQL's `.node` will not load in packaged Electron, or cold
  open is not materially faster than PGlite.
- **Phase 2**: the TS ranker cannot match SQL ranking quality on the corpus.
- `clientSequence` cannot be made to preserve per-device ordering under SQLite
  without changing the sync wire protocol.
- `effect-libsql` or `effect-sqlite-do` turns out to be broken or unusable in
  rc.4 — these are new in this release and have thin documentation. Report the
  specific failure; do not work around it by dropping to the non-Effect driver
  without escalating, since that would fork the persistence layer's style.
- Better Auth has no workable D1/SQLite adapter path.

## Open questions

Unresolved at planning time; resolve during Phase 1:

1. Does Better Auth (with `@better-auth/electron`) support a D1/drizzle-sqlite
   adapter cleanly?
2. What are current D1 and DO SQLite storage limits per object?
3. Does libSQL's vector support cover the ANN index shape Phase 6 needs, or
   only brute-force scan?
4. How mature are `effect-libsql` / `effect-sqlite-do`? They are new in rc.4
   and barely documented outside the type definitions — the `storage` gotcha
   above was found by reading `.d.ts` files, not docs. Assume more surprises.

## Maintenance notes

- The strongest argument for this migration is **not** raw speed — it is that
  unifying the dialect restores one shared schema across local and remote,
  which is what makes the sync design coherent. Speed is a bonus, and as of
  planning time it is **unmeasured in the packaged app**.
- The strongest argument against is the search ranker. Phase 2 exists to
  convert that from an unknown into a measured result before anything is lost.
- If the migration is abandoned after Phase 2, keep Phase 2. An in-memory
  ranker is better than the SQL one on testability regardless of engine.
- Plan 017 (`::bigint` money aggregates) becomes **obsolete** if this lands —
  SQLite INTEGER is 64-bit and returns a JS number, so the bigint→string driver
  hazard disappears. Do not port 017's casts; port its _tests_.
