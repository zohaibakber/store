# Implementation Plans

> **Note**: `plans/` is currently gitignored (`.gitignore:42`), so everything
> here — including the rejected-findings record that exists specifically to
> stop re-litigation — lives on one machine only. Tracking this directory (or
> at minimum promoting the backlog and rejection sections into a tracked
> `docs/decisions.md`) is itself a recorded finding from the 2026-07-25 run.

Three audit runs have contributed plans:

- **2026-07-15** (commit `a98b4aa7`) — focus: Effect v4 patterns and React
  composition patterns; effort standard. Plans 001–006.
- **2026-07-19** (commit `fe1891d6`) — the complementary full audit:
  security, correctness of code added since `a98b4aa7`, performance,
  dependencies, DX, test coverage, docs, and direction; effort standard.
  Plans 007–011, plus a scope revision that unblocks plan 004.
- **2026-07-25** (commit `8b1efa49`) — full nine-category audit at effort
  standard, run as a reconciliation: all of 001–013 were DONE and the repo had
  moved substantially (the `apps/api` workspace is now `apps/server`, the
  upload backend shipped, the dashboard/analytics feature landed, and the
  shadcn→coss UI migration completed). Four parallel subagents; every reported
  finding re-verified against HEAD by hand before planning. Plans 014–020.

Verification baseline at `8b1efa49`: `bun run test` → 7 turbo tasks, all
passing (~56s; `packages/persistence` alone is 13 files / 40 tests).
`bun run check` → exit 0. Both were green **before** any plan in this run, so
a failure during execution is caused by the change, not inherited.

Execute in the order below unless dependencies say otherwise. Each executor:
read the plan fully before starting, honor its STOP conditions, and update
your row when done.

Both runs planned the top findings by leverage without interactive selection
(per the skill's non-interactive default); the remaining vetted findings are
in "Audit backlog" so a later run can plan them without re-auditing.

Verification baseline at `fe1891d6`: `vp test` → 11 files / 28 tests, all
passing (~52s). `vp check` → source clean; fails only on formatting of
UNTRACKED `.agents/skills/effect/*.md` files (not committed — CI would not
see them).

## Execution order & status

| Plan | Title                                                      | Priority | Effort | Depends on     | Status                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------- | -------- | ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001  | Preserve the underlying cause in PersistenceError          | P1       | S      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 002  | Sync-engine transport retry + periodic re-sync signal      | P1       | M      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 005  | Wire product delete, remove dead UI controls               | P1       | S      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 007  | Atomic bulk inventory import + safe upload retry           | P1       | M      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 008  | CI gate (check/lint/test on push+PR, Turbo test task)      | P1       | S      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 004  | Remove the `program` accessor wrappers                     | P2       | M      | — (before 003) | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 003  | Typed store errors across the Electron IPC boundary        | P2       | M      | 001, 004       | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 009  | Decode server/AI responses at the IPC boundary             | P2       | M      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 010  | Sync convergence characterization tests (server + client)  | P2       | M–L    | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 011  | Renderer Content-Security-Policy                           | P2       | S      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 006  | Decompose the invoice-upload page (provider + composition) | P2       | M      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 012  | Migrate the desktop UI from shadcn/ui to coss ui           | P2       | L      | —              | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 013  | Replace the homepage with an analytics dashboard           | P2       | M      | 012 (visual)   | DONE                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 014  | Make AGENTS.md and the READMEs describe the real code      | P1       | S      | —              | **Ready to merge.** Branch `advisor/014-agents-md-truth-up` corrects AGENTS.md to say Geist. Commit `ad20c1ce` had briefly switched the app to Inter, which would have made that claim false, but the font swap was reverted on 2026-07-25 at the user's request — the app is on Geist again (`main.tsx:9`, `styles.css:8`), so the plan is accurate as written. Re-verify the typography section against the code before merging |
| 015  | Renderer pricing tests + collect `.tsx` tests at all       | P1       | S      | —              | DONE — reviewed & approved; branch `advisor/015-renderer-pricing-tests` `d5f815c4`, unmerged                                                                                                                                                                                                                                                                                                                                      |
| 016  | Stop shipping `localhost` as a production trusted origin   | P1       | S      | —              | **DONE — landed on `main`** in commit `109053f0` as part of the 021 deploy, rather than merging the branch. `advisor/016-scope-trusted-origins` can be deleted; its `cors.test.ts` is still worth cherry-picking                                                                                                                                                                                                                  |
| 017  | Sum dashboard money aggregates as `bigint`                 | P1       | S      | —              | **OBSOLETE — do not merge.** Superseded by 021: SQLite INTEGER is 64-bit and returns a JS number, so the bigint→string hazard cannot occur. Its casts are already gone from `main`. Port its _tests_, then delete branch `advisor/017-bigint-money-aggregates`                                                                                                                                                                    |
| 018  | Reject oversized uploads before buffering the body         | P1       | S      | —              | DONE — reviewed & approved; branch `advisor/018-upload-size-precheck` `fa0ac8b8`, unmerged                                                                                                                                                                                                                                                                                                                                        |
| 019  | Sync outbox backoff + stuck-queue visibility               | P1       | M      | —              | **NEEDS REBASE.** Branch `advisor/019-…` (`8ff7b529`) has 2 failing tests and was written against the Postgres sync engine. Its `array_agg(... ORDER BY ...) FILTER (WHERE ...)` and `bool_or` have no SQLite equivalents (`bool_or` → `max(...)` over 0/1). Rebase onto `main`, do not merge first                                                                                                                               |
| 020  | Show typed store errors in product toasts                  | P2       | S      | —              | DONE — reviewed & approved; branch `advisor/020-renderer-typed-error-messages` `66832911`, unmerged                                                                                                                                                                                                                                                                                                                               |
| 021  | Migrate PGlite → libSQL, and sync server → Durable Objects | P2       | L      | —              | **DONE — merged to `main` (`ad20c1ce`), deployed and verified in production.** No Postgres remains. Worker live at `store-api.zohaibakber99.workers.dev`; D1 `store-auth`; one Durable Object per organization. Verified end-to-end: offline product → sync → Durable Object → pulled back by a second device. Packaged Electron build passes `verify-after-pack` (5.9 MB asar, 32 packages)                                      |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

- 003 requires 001 because the IPC contract serializes `PersistenceError`
  including its new `cause: Schema.Defect` field.
- 003 requires 004 because both rewrite the same region of
  `apps/desktop/electron/main.ts`; 004 is the mechanical one and must land
  first to keep diffs reviewable.
- 007 and 009 both touch `apps/desktop/src/components/uploads/upload-context.tsx`
  (different functions: `applyChanges` vs `analyse`/model loading) and
  `main.ts` (different handler groups) — no ordering requirement, but expect
  small merges if executed concurrently.
- 007 ADDS a `store:*` IPC handler in the region 003/004 rewrite — whichever
  lands second rebases mechanically; 007's "Coordination" section covers it.
- 013 depends on 012 only for the visual layer (coss components); its data
  layer (contracts/persistence/IPC) is independent and can be built first.
  Since 003/009 are DONE, 013's new IPC method must follow the typed-error
  and boundary-decode patterns now live in `main.ts`/`preload.ts`.
- 010 blocks the sync performance backlog items (PERF-02, PERF-03 below):
  characterization tests must exist before either loop is restructured.
- 008 is independent but highest-leverage early: every other plan's
  verification story improves once CI exists.

### 2026-07-25 run (plans 014–020)

None of 014–020 hard-depend on each other; all seven can be executed in
parallel worktrees. Recommended **order** is by leverage, not by dependency:

- **014 first.** It is the only convention document agents read before
  executing anything else, and every concrete claim in it is currently false.
  Landing it first means plans 015–020 are executed against a doc that
  no longer misleads.
- **015 second.** The `.tsx` test glob fix is groundwork: until it lands, any
  renderer test anyone writes is silently skipped by CI, so later renderer
  work could rot invisibly.
- **016, 017, 018** are the security/correctness batch — all S, all
  high-confidence, all with clean verification stories.
- **019** is the only M and the only MED risk in this run. It touches the sync
  engine, so it will conflict textually with any other sync work; execute it
  alone rather than concurrently with a future sync performance plan.
- **020** is mechanical and can land any time.

Cross-plan notes:

- 015 and 020 both touch `apps/desktop/src/components/` but different files
  (`invoices/` vs `products/`) — no conflict.
- 017 and 019 both touch `packages/persistence/src/` but different files
  (`analytics-store.ts` vs `sync-engine.ts`) — no conflict.
- 019 extends the `SyncStatus` contract with required fields. If a renderer
  plan that constructs `SyncStatus` is written later, it must land after 019.
- 016 and 018 both touch `apps/server/` but different files
  (`wrangler.jsonc`/`testing/app.ts` vs `routes/uploads.ts`). 016 changes
  `appFor`'s signature by appending an optional parameter; 018 adds tests that
  call `appFor` — whichever lands second rebases trivially.

## Audit backlog (vetted findings, not planned this round)

### From the 2026-07-25 run (verified by hand at `8b1efa49`)

Correctness (money path — highest severity first):

- **`unitsPerPack` is not snapshotted onto batches.** `products.unitsPerPack`
  (`packages/db/src/shared/store.schema.ts:67`) is the only source of the
  pack↔item ratio, but `batches` stores only `packQuantity`/`unitQuantity`
  (`:96-97`). `updateProduct` (`packages/persistence/src/product-store.ts:330-339`)
  writes a new ratio with no guard, so **editing a product silently re-values
  all existing stock** — 5 packs at 10/pack becomes 100 units after an edit to
  20/pack. Every allocation site multiplies by the _current_ ratio
  (`invoice-store.ts:189,203,213`). The same conflation is reachable through
  the primary bulk-entry flow: `importInventory` applies `line.unitsPerPack`
  **only** when creating a new product (`product-store.ts:595`); importing
  against an existing product reuses its id (`:582-583`) and stores the packs
  raw, giving a silent multiple-factor phantom-stock error. Effort L, risk
  MED. **Not planned this round** because it needs a schema migration plus
  server `row-validation.ts` changes, and deserves characterization tests
  first. This is the most severe unplanned finding in the backlog.
- **No `unitsPerPack >= 1` validation at any layer.** No `check()` constraint
  (`store.schema.ts:67`), no `Schema.check` on the contracts
  (`packages/contracts/src/store.schema.ts:74-80`). With `0`, selling exactly
  the loose-unit count computes `0 / 0 = NaN`
  (`invoice-store.ts:261`) and writes `NaN` quantities;
  `productStockValue` returns `Infinity` (`store-helpers.ts:24`). Negative
  values invert all pack↔unit math. `SearchProductsInput.limit`
  (`store.schema.ts:113`) is likewise an unchecked `Schema.Number`. Effort S.
- **Naive CSV splitting shifts columns.** `packages/services/src/invoice-extraction.ts:74-81`
  uses `headerRow.split(",")` and `row.split(",")` with no quote handling. A
  quoted comma in a product name (`"Panadol Extra, 500mg"`) shifts every later
  column; because `countField`/`priceField` coerce unparseable values to silent
  fallbacks, the import **succeeds with wrong stock and prices** rather than
  failing. Effort S, risk LOW — isolated pure function with an existing test
  file (`inventory-import.test.ts`).
- **`toLocaleLowerCase` makes import matching locale-dependent.**
  `product-store.ts:544,563` (contrast the locale-safe `toLowerCase()` at
  `:102`). On a Turkish/Azeri locale `"IBUPROFEN"` lowercases differently, so
  the same product splits into duplicates on one machine and then replicates.
  Effort S.
- **A failed organization switch breaks sync permanently.**
  `apps/desktop/electron/auth.ts:143-151` calls `setActive` **before**
  validating membership; if a later step throws, the server session has moved
  but `activateOrganization` never runs (`main.ts:417-421`). On restart,
  `#loadOrganizations` only re-issues `setActive` when the id differs
  (`auth.ts:194-199`), so it never self-heals; every sync then fails
  `ORGANIZATION_MISMATCH` → 403, which `main.ts:342-345` classifies as
  non-retryable. Effort M, risk MED.
- **Equal `rowVersion` remote changes have no tiebreak.**
  `sync-engine.ts:83,97,111,125,151` return early only on strictly-greater
  local versions, so equality falls through to the upsert. Convergence is
  currently rescued by _server_ renumbering
  (`apps/server/src/sync/row-validation.ts:138`) — the client is correct by
  accident and asserts nothing about it. Effort S; add a deterministic
  `(updatedAt, deviceId)` tiebreak and a test.
- **Soft-deleted rows collide with non-partial unique indexes.**
  `store.schema.ts:53` — `categories_organization_id_name_uidx` has no
  `WHERE deleted_at IS NULL`, while `createCategory`
  (`product-store.ts:124-143`) checks only live rows before a plain insert
  with a deterministic slugged id. Reachable today via replicated deletes.
  Effort S.
- **Updater state machine defects.** `apps/desktop/electron/updater.ts:97-98`
  resets `downloadState` to `"idle"` on _any_ error including when the state
  was `"downloaded"`, defeating the invariant its own comment at `:32-34`
  describes; `:113-117` sets `"downloading"` then awaits `downloadUpdate()`
  with no try/finally, so a rejection sticks that state forever and
  permanently blocks further checks and downloads. It also lacks the
  `app.isPackaged` guard `check()` has. `retryCheckTimer` is never cleared on
  quit. Effort S. Note this is the app's **only** update channel.
- **`before-quit` does not await the local database shutdown.**
  `apps/desktop/electron/main.ts:551-553` fires `void disposeRuntime()`;
  Electron does not wait for a floating promise, so the process can exit while
  PGlite is still flushing — losing the last transaction and any queued outbox
  operations. Effort S, risk MED (needs a `preventDefault` + re-entry guard).
  Confidence MED: the fire-and-forget is certain, the amount actually lost
  needs verification against the persistence finalizers.
- **Runtime activation is not serialized.** `main.ts:283-290` clears the
  module-level `runtime` _before_ awaiting disposal, and `activateOrganization`
  (`:319-376`) checks its guard before several awaits while setting
  `activeOrganizationId` only at the end. Two rapid auth transitions can build
  two `ManagedRuntime`s over the same PGlite `dataDir`; `forwardSyncStatus`
  (`:292-304`) also overwrites its stop handle unconditionally, leaking the
  previous stream fiber. Effort M.

Security:

- **No rate limiting on the AI-backed upload endpoint.**
  `apps/server/src/routes/uploads.ts:15` sits behind `requireOrganization` only;
  no limiter exists anywhere in `apps/server/src`. Each request runs document
  conversion plus a 4096-token inference (`ai/invoice-ai.ts:24-29`), so any
  authenticated member can drive uncapped, billed inference. Effort M — the
  design question is where counters live (Durable Object vs KV).
- **Untrusted document text is not fenced in the extraction prompt.**
  `packages/services/src/invoice-extraction.ts:163-170` passes uploaded-PDF
  markdown verbatim as the `user` message. Output is schema-constrained
  (`ai/invoice-ai.ts:26`), which caps this at _data_ manipulation rather than
  tool abuse — but the manipulated numbers become inventory and prices. Files
  are also accepted on **extension only** (`uploads.ts:10`); `file.type` is
  never checked. Separately, `invoice-extraction.ts:176,182-185` `console.error`
  the full model input/output, persisting complete supplier invoice contents
  (pricing, possibly counterparty PII) into Worker logs unredacted. Effort M.
- **Pulled sync rows bypass business-invariant validation.**
  `sync-engine.ts:65-68` validates _shape only_ (`createSelectSchema`) and
  `ensureIdentity` checks only org/entity id; the row is then upserted verbatim
  (`:85-116`). The store schema has exactly one `check()` constraint in total
  (`store.schema.ts:144`), so a compromised or buggy server can push negative
  stock, zero `unitsPerPack`, or negative prices into the local database — and
  the client re-emits them. The server has `row-validation.ts`; the client has
  no counterpart. Effort M, risk MED (a constraint that existing data violates
  would stall the pull transaction — audit before rollout).
- **`electron-origin` trust check accepts `Origin: null`.**
  `apps/server/src/auth/electron-origin.ts:5`. The header is client-supplied
  (`apps/desktop/electron/auth.ts:229`) and unforgeable by nothing. Browser
  abuse is largely blocked in practice (custom headers force a preflight;
  better-auth cookies default to `SameSite=Lax`), so this is hardening, not an
  open hole — but a genuine Electron custom-protocol request never sends
  `Origin: null`, so accepting it widens the surface for no benefit. Effort S.
- **Unregistered `user-image:` scheme in the renderer CSP.**
  `apps/desktop/electron/main.ts:106` allows it in `img-src`; grep finds no
  `protocol.handle` or `registerSchemesAsPrivileged` anywhere. Dead config
  today, but it pre-authorizes a future handler that would then never get CSP
  review. Effort S. Related: `apps/desktop/index.html:10` ships a **second,
  different** CSP via `<meta>` whose `connect-src` is broader than the header
  CSP installed by `main.ts:99-124`; the browser enforces the intersection so
  the header wins today, but it is a live second source of truth. Plan 011
  added the header without retiring the meta tag.

Performance (all re-verified as still present):

- **Server sync applier does per-change SELECT + per-change change-log INSERT.**
  `apps/server/src/sync/apply-change.ts:51,74,102,126,160` (a standalone
  `SELECT … LIMIT 1` per entity case) and `operation.ts:121-141` (one
  `INSERT … RETURNING` per canonical change), plus `reconcileBatch` per
  affected batch (`operation.ts:114`). A 200-change operation — reachable from
  bulk import, which batches at 200 — costs ~400+ sequential round trips
  _through Hyperdrive_ inside one transaction. Effort M, risk MED; well
  covered by `sync/database.test.ts` (391 lines).
- **Client pull-apply does a `findFirst` per change.**
  `packages/persistence/src/sync-engine.ts:80,94,108,122,148` reads the row
  purely to compare `rowVersion` before upserting. Bounded at 500 changes per
  pull page, serialized inside the write transaction — the visible "first
  login is slow" cost. Effort S, risk LOW: fold the guard into
  `onConflictDoUpdate` with a `setWhere`.
- **List routes fetch whole tables over IPC, then paginate client-side.**
  `routes/products/index.tsx:25`, `routes/invoices/index.tsx:6`,
  `routes/invoices/new.tsx:6`, `routes/products/upload.tsx:23` call unbounded
  loaders; `product-store.ts:166-178` returns every product with its category
  and all live batches, `invoice-store.ts:79-91` every invoice with all items.
  Tables then paginate at `pageSize: 10` (`products/table.tsx:132`,
  `invoices/table.tsx:100`). Effort M, risk MED — the invoice-create picker
  deliberately holds the whole catalog in memory and must keep an unpaginated
  or search-driven path.
- **`createInvoice` runs 2 queries per line inside the write transaction.**
  `invoice-store.ts:155,163` inside the `for` loop at `:154`, within the
  transaction opened at `:120`. A 30-line sale holds the write transaction
  open across ~60 serialized queries on a single-threaded PGlite — directly
  the latency the cashier waits on. Effort S, risk LOW. Prefetch products and
  batches with two `in`-queries before the loop.
- **`invoice_items` lacks the index the dashboard needs.**
  `store.schema.ts:200` indexes `(organization_id, invoice_id)`, but
  `analytics-store.ts:62-70` filters on `organizationId + createdAt` and groups
  by `productId`, so `topProductsQuery` scans every invoice line ever written
  on each dashboard load _and_ again on every `offline-store:sync` event
  (`home-page.tsx:52-56`). Effort S. Confidence MED — index absence is certain,
  that it is the bottleneck needs one `EXPLAIN ANALYZE`.
- **The Worker builds a database runtime on every request.**
  `apps/server/src/runtime/worker.ts:25-26` constructs both `createAuthDatabase`
  and `makeSyncRuntime` before `next()`, and the middleware is mounted at
  `app.use("*", …)` (`http/app.ts:14`) — so `GET /`, `/api/health` and every
  CORS preflight pay a full Hyperdrive connect/disconnect cycle
  (`worker.ts:50-52`, `maxConnections: 1`). Effort M, risk MED (lazy init must
  not leak connections across requests in the isolate model).

Tests / DX / deps / architecture:

- **The Electron IPC boundary has zero tests and the highest churn in the repo.**
  `apps/desktop/electron/main.ts` (567 lines, 26 `ipcMain.handle` channels, 28
  commits in 6 months), `auth.ts` (307 lines), `preload.ts` (111 lines, 16
  commits). Every store call flows through the `runStore` →
  `Schema.decodeUnknownEffect` → `encodeStoreErrorSafely` pipeline
  (`main.ts:130-170`) with no coverage. Highest churn × zero coverage = top
  refactor risk. Effort M.
- **`packages/services` has no tests and no `test` script.** Its
  `invoice-extraction.ts` feeds `importInventory`, which creates real products,
  batches and movements. The comment at `:52-56` documents a past silent bug
  where the model wrote `unitsPerPack` into `unitQuantity` and "silently
  inflated received stock by a whole pack's worth per line" — nothing prevents
  its recurrence. `InvoiceAiClient` (`:41-52`) is already a structural
  interface designed for substitution; the seam exists and is unused. Effort S.
- **The updater flow is untested.** `electron/updater.ts` +
  `hooks/use-app-updater.tsx` (10 commits in 6 months). Effort M — needs the
  state machine extracted from the `autoUpdater` singleton first.
- **`turbo run test` silently skips four workspaces.** `packages/auth`,
  `contracts`, `db`, `services` define no `test` script, so `turbo.json:20-23`
  no-ops for them. `bun run test` (turbo) and CI's `bunx vp test` (root vitest
  globs) are therefore two different collection mechanisms with different
  coverage. Effort S — pick one and document it.
- **Release ships without running CI.** `.github/workflows/release.yml` builds
  and publishes on a tag push with **no `needs:`** on the CI workflow and no
  test step, so a tag at a never-verified commit ships an auto-updating build
  to every install. CI itself is fine — it correctly gates format/lint/
  typecheck/tests on PRs. Also: no `actions/cache` for `.turbo` or bun, so
  every run is fully cold. Effort S. **This is the highest-leverage unplanned
  DX item.**
- **`electron-builder`/`electron-updater` advisories.** `bun audit` reports
  `app-builder-lib <26.15.0` (GHSA-7g7r-gx96-252g, uncontrolled search path in
  the built AppImage — the artifact `README.md:57-61` tells Linux users to
  install) and `builder-util-runtime <9.7.0` (GHSA-p2f4-r6v6-j797, cross-origin
  redirect leaks `Authorization`). The latter is _runtime_ code inside
  `electron-updater`, executing on every installed machine on every update
  check. Both are within existing caret ranges. The `tar`/`fast-uri`/`esbuild`
  advisories are build- or dev-time only and not worth chasing. Effort S.
- **No `.env.example`, and `.gitignore` prevents adding one.** `.gitignore:36`
  ignores `.env*` with a negation only for `!.dev.vars.example` (`:40`) — a
  committed `.env.example` would be silently ignored. Required variables are
  discoverable only from `ci.yml:18-26`, `runtime/worker.ts:35-45`,
  `turbo.json:3-9`, and `apps/server/scripts/dev.mjs:5`, which hard-fails on an
  **undocumented** `packages/db/.env`. A fresh clone following the README
  cannot run the server. Effort S.
- **`.repos/` is committed: 2,163 tracked files, ~33 MB.** A vendored read-only
  copy of the upstream Effect repository. Excluded from fmt/lint
  (`vite.config.ts:8,32`) but not from git, so every clone and CI checkout pays
  for it and it pollutes every repo-wide grep — which is why each audit brief
  has to carry an explicit "skip `.repos/**`". Effort S to stop tracking
  (`.gitignore` + `git rm -r --cached`); reclaiming the history is a separate
  HIGH-risk decision.
- **`electron/main.ts` is a god module.** 567 lines against a ~130-line repo
  median, owning env loading, API URL resolution, CSP, the IPC error envelope,
  17 store handlers, org-key hashing and PGlite dir layout, device-id
  persistence, runtime lifecycle, the sync HTTP transport, auth IPC, the
  uploads bridge, and window/updater wiring. Every prior IPC plan (003, 004,
  007, 009) collided here. Effort M, risk LOW — pure file movement.
- **Three competing IPC error protocols.** `store:*` uses the typed `{ok,error}`
  envelope; `auth:*` throws raw `Error`s that the renderer un-prefixes with a
  regex (`lib/auth.tsx:33-34`); `server:uploads` throws raw with no envelope
  and no strip, so upload errors reach the user with
  `Error invoking remote method 'server:uploads':` still attached
  (`components/uploads/context.tsx:127`). Plan 003 typed one surface and
  stopped. Effort M, risk MED (touches the auth front door). Plan 020 fixes
  _consumption_ on the typed surface only.
- **One entity registry instead of the six-case switch written three times.**
  `sync-engine.ts:66-170`, `apps/server/src/sync/apply-change.ts:47-246`, and
  `row-validation.ts:29-115` each enumerate the same six entities; the last
  hand-rolls ~120 lines of validators re-expressing column types the client
  already derives with `createSelectSchema`, against this repo's own
  "derive Effect Schema from Drizzle" convention. Adding one syncable entity
  requires coordinated edits in 6 files with no type-level link between them.
  Effort L, risk MED-HIGH — money path; safe only on top of the existing
  convergence tests.
- **Cross-boundary constants are duplicated.** `LOW_STOCK_THRESHOLD` is
  defined in `analytics-store.ts:16` and re-declared in
  `dashboard/home-page.tsx:17-19` with a comment admitting the mirror;
  `EXPIRY_WINDOW_DAYS = 90` (`analytics-store.ts:14`) is hardcoded as the
  string "next 90 days" in `inventory-health.tsx:49`; the invoice file rule is
  written three times (`uploads.ts:9`, `uploads/context.tsx:47`,
  `dropzone.tsx:20`) and the server's `MAX_FILES`/`MAX_TOTAL_BYTES` have no
  client counterpart at all. Effort S — move them to `@store/contracts`.
- **Dead code from the shadcn→coss migration.** Ten vendored primitives are
  imported by nothing (`ui/{checkbox,checkbox-group,dialog,group,meter,otp-field,preview-card,switch,toggle,toolbar}.tsx`);
  `nav-projects.tsx`, `nav-secondary.tsx` and `hooks/use-mobile.ts` (superseded
  by `use-media-query.ts`) are unreferenced template leftovers;
  `ModelCatalogService` (`packages/services/src/model-catalog.ts:11-33`) is
  exported and imported by zero files after the `/api/models` route was
  dropped. Effort S. **Correction to the raw audit report**: `shadcn` is _not_
  an unused dependency — it is consumed via `@import "shadcn/tailwind.css"` at
  `apps/desktop/src/styles.css:2`. Verify each deletion; do not bulk-remove.
- **Two React context idioms.** React 19 `<Context value>` + `use()` in
  `uploads/context.tsx:215`, `invoices/create-context.tsx:262`,
  `data-table.tsx:120`; legacy `.Provider` + `useContext` in `lib/auth.tsx`,
  `theme-provider.tsx`, `command-menu.tsx`. Effort S.
- **Organization-create is duplicated.** `create-organization-page.tsx:18-36`
  and `settings/organization-settings.tsx:19-38` are the same handler in two
  form idioms. They also dispatch an `auth:session` `CustomEvent` that
  duplicates the main process's own `auth:session-changed` broadcast
  (`main.ts:366`, `preload.ts:18-24`), so `lib/auth.tsx:106-113` subscribes to
  two channels carrying identical data and can apply twice per creation.
  Effort S.
- **`@types/node` drift.** `^24.13.3` in `apps/server`/`packages/auth` vs
  `^24.10.13` in `packages/db`/`packages/persistence`; the lockfile carries
  two majors. Effort S — add it and `vitest` to the root catalog, as was
  already done for `typescript` and `effect`.
- **The `staged` pre-commit config is inert.** `vite.config.ts:19-21` and
  `apps/desktop/vite.config.ts:20-22` both declare
  `staged: { "*": "vp check --fix" }`, but `.git/hooks/` has no non-sample
  hook, so the promised commit-time feedback never fires and the duplicate
  block is maintained for nothing. Effort S. Confidence MED — whether
  `vp install` is _supposed_ to install the hook needs one check against
  `node_modules/vite-plus/docs`.
- **CI runs an unpinned toolchain.** `.github/workflows/ci.yml` invokes
  `bunx vp check` / `bunx vp test`; `vp` is in no manifest, so the binary that
  decides whether code is correct is fetched at job time. Effort S.
  Confidence MED-HIGH — possible it is provided by a global tooling layer.
- **The release matrix and packaging config disagree.**
  `release.yml:14-16` builds only `[ubuntu-latest, windows-latest]`, while
  `electron-builder.json5` configures a `mac` dmg target that CI can never
  produce, and the `publish` job unconditionally marks the release `--latest`
  despite a config comment claiming it publishes only once every platform is
  present. Effort S.

Docs:

- **`apps/server/README.md` argues against the architecture that shipped** —
  see plan 014, which fixes this along with `AGENTS.md` and the root README.
- **Missing per-package READMEs.** `packages/README.md` is a two-line scaffold
  placeholder; `packages/{contracts,persistence,db,auth,services}` and
  `apps/desktop` have none. Effort S.

### From the 2026-07-19 run (verified at `fe1891d6`)

> **Retired at `8b1efa49`** — these were re-checked in the 2026-07-25 run and
> are no longer findings: **TypeScript major-version drift** (all six
> workspaces are now on `catalog:` at `7.0.2`; only `@types/node` drift
> remains, recorded above); **the missing CI gate** (`.github/workflows/ci.yml`
> now runs format, lint, typecheck, workspace checks and tests on push and
> PR — the _release_ workflow is the remaining gap, recorded above);
> **DIR-01 "ship the invoice-upload backend"** (delivered:
> `apps/server/src/routes/uploads.ts` is mounted behind `requireOrganization`
> and runs `@store/services` on the Workers AI binding, with tests).
>
> Also note: several entries below reference the `apps/api` workspace, which
> has since been **renamed to `apps/server`**, and `release.yml` now publishes
> to this repository with the default `GITHUB_TOKEN` rather than to a separate
> `store-electron-releases` repo via `GH_RELEASES_TOKEN`. Treat paths and
> release details in the pre-2026-07-25 sections as needing re-verification.

Correctness / security:

- **SEC-02: Auto-updates are unsigned** — `electron-builder.json5:35-59`
  declares no win/mac signing or notarization; updates fetch from the public
  `zohaibakber/store-electron-releases` repo with integrity resting solely on
  `latest.yml` sha512 + HTTPS and the `GH_RELEASES_TOKEN` CI secret
  (`release.yml:40-48`); `autoInstallOnAppQuit = true` (`updater.ts:25`).
  Anyone with write access to that repo/token ships code to every install.
  Not planned because it needs certificates and account decisions only the
  maintainer can make (Authenticode + Apple Developer ID + CI secret
  provisioning). Effort L. Treat the releases repo/token as high-value
  secrets meanwhile.
- **SEC-03: `will-navigate` guard is a raw string-prefix check** —
  `main.ts:332-335` compares `url.startsWith("file://" + RENDERER_DIST)`;
  a sibling path sharing the prefix passes. Low practical risk given
  sandbox + window-open deny. Fix: compare resolved origin (dev) / directory
  boundary with trailing separator (prod). Effort S.
- **CORR-02: Updater events are fire-and-forget** — `updater.ts:22,51-54`
  sends events to whatever window exists; the sole subscriber registers in a
  React effect (`use-app-updater.ts`, mounted via `__root.tsx`). An event
  emitted before mount or after a reload is lost until the next 4-hour
  check. Fix: cache the last `UpdaterEvent` in main + an `updater:current`
  getter (or re-check on renderer ready). Effort S.
- **CORR-03: `event.currentTarget.reset()` after `await` throws** —
  `settings-page.tsx:38-41`: after `await window.auth.createOrganization`,
  `event.currentTarget` is null → TypeError caught and shown as an error
  toast even though the org was created. Capture `const form =
event.currentTarget` before the await. Effort S. (The duplicated handler
  in `create-organization-page.tsx` does NOT have the reset call — only the
  settings copy is affected. The dedup itself is a prior-run backlog item.)

Performance (money path — sequence AFTER plan 010):

- **PERF-02: Client pull-apply does SELECT + upsert per change** —
  `sync-engine.ts:59-140` (`upsertRemoteChange`): per change, `findFirst`
  for `rowVersion` then `insert(...).onConflictDoUpdate`. ~2 roundtrips ×
  page of ≤100. Fold the rowVersion guard into the conflict clause
  (`WHERE excluded.rowVersion > current`). Effort M, MED risk. Requires 010.
- **PERF-03: Server push path is per-change roundtrips** —
  `apply-change.ts:50-59` etc. (SELECT + upsert per change),
  `operation.ts:103-140` (per-batch `reconcileBatch`, per-row change-log
  insert with `.returning()`). Push latency scales with change count over
  Hyperdrive. Batch reads per entity type + one multi-row change-log insert.
  Effort L, MED-HIGH risk. Requires 010.
- **PERF-04: List loaders fetch entire tables over IPC** —
  `invoice-store.ts:82-94` (`listInvoices` with ALL `items`),
  `product-store.ts:78-90`, `:412-424`; loaders call them per navigation
  (`routes/products/index.tsx:23`, `routes/invoices/index.tsx:6`). Client
  paginates AFTER the full fetch (pageSize 10). Add bounded pages / drop the
  transitive `items` join from the invoice list. Effort M.
- **PERF-05: `createInvoice` does 2 queries per line inside the write
  transaction** — `invoice-store.ts:157-172`. Pre-load products + batches in
  two `in`-queries. Effort S, LOW risk.

Dependencies / DX / tests / docs:

- **DEP-01: TypeScript major drift** — `apps/api` + `packages/auth` on
  `^6.0.3`; the other five workspaces on `^7.0.2` (secondary: `@types/node`,
  `vitest` minor drift). Align on one major; run per-workspace checks after.
  Effort S.
- **DEP-02: bun audit — 6 high (node-tar via electron-builder) + 2 moderate
  (esbuild via dev toolchain)** — build/dev-time reachability only, fixes
  available in compatible ranges via `bun update`; verify `vp build` and a
  release build after. Effort S.
- **DX-03: No `.env.example` / `.dev.vars.example`** — required vars
  (`DATABASE_URL`, `STORE_API_URL`, `VITE_API_URL`, `AI_GATEWAY_API_KEY`,
  `BETTER_AUTH_SECRET`, `AUTH_TRUSTED_ORIGINS`, `ELECTRON_PROTOCOL`) are
  discoverable only from `turbo.json`, `wrangler.jsonc`, and prose;
  `.gitignore:39` whitelists `!.dev.vars.example` but the file was never
  created. Effort S.
- **DX-04: AGENTS.md lacks the architecture map** — only Vite+ boilerplate +
  typography rules; nothing on the five workspaces, their runtimes, or
  per-workspace commands. High leverage for agent-executed plans. Effort S.
- **TEST-01: Electron IPC boundary has zero tests** — `main.ts:92-317`
  (store/auth/server handler registration, `runStore` error flattening,
  per-org runtime activation); no test file exists under `apps/desktop`.
  Extract registration behind an injected runtime and drive with a real
  temp-dir `ManagedRuntime` (persistence-test pattern). Effort M. Natural
  follow-up to plans 003/004.
- **TEST-03: `packages/services` untested** — `invoice-extraction.ts:25-48`
  `parseCsv` (header mapping, cents rounding) is pure and money-adjacent;
  table-test it. Effort S.
- **TEST-04: Renderer pricing math untested** —
  `invoice-create-context.tsx` computes subtotal/discount/total (the amount
  charged); no renderer test runner exists. Effort M (includes jsdom setup).
- **TEST-05: Updater flow untested** — `updater.ts` + `use-app-updater.ts`;
  inject a fake `autoUpdater`, assert event mapping and unpackaged no-op.
  Effort M; sequence after the money-path tests.

### From the 2026-07-15 run (verified at `a98b4aa7`)

- **Server sync validation should decode with Effect Schema** —
  `apps/api/src/sync/row-validation.ts` + `apply-change.ts` hand-roll
  per-field validators while the client validates the same rows with
  `createSelectSchema` + `Schema.decodeUnknownEffect`
  (`packages/persistence/src/sync-engine.ts:30-56`). Drift hazard between the
  two peers. Effort L; needs parity tests first (plan 010 helps). Doing this
  also removes the span-per-field noise and most of `row-validation.ts`.
- **packages/services error/decoding alignment** —
  `model-catalog.ts:6-13` uses `Data.TaggedError` with `cause: unknown` and a
  success channel typed `unknown`; `invoice-extraction.ts:7-10` same error
  style. Convert to `Schema.TaggedErrorClass` + decode the catalog payload.
  Effort S–M.
- **Sync route runs a second throwaway runtime** — `apps/api/src/routes/sync.ts:26-42`
  uses `Effect.runPromise` for request decode separately from the
  `ManagedRuntime` behind `c.var.runSync`. Fold decode into the managed
  program. Effort S.
- **`SyncProtocolError.code` is an open `Schema.String`** —
  `apps/api/src/sync/errors.ts:10`; ~25 producers, one `switch` consumer with
  a silent 400 default. Type as `Schema.Literals([...])`. Effort M.
- **`Effect.suspend` where `Effect.fn` is the convention** — read-path
  operations (`product-store.ts:65,78,98,412`, `invoice-store.ts:82`) are
  unnamed in traces. Effort S.
- **Mutation context as a closure** — `mutationContext: () => MutationContext`
  threaded through three store factories instead of a `Context.Reference`-style
  service. Effort M; MED risk.
- **zod vs Effect Schema in services** — `invoice-extraction.schema.ts` is
  the only zod consumer in the workspace. Port or record as intentional.
  Effort M.
- **Non-null assertions at invoice submit** —
  `invoice-create-context.tsx:207,209`; narrow inside `completeSale` instead.
  Effort S.
- **Two React context idioms** — `theme-provider.tsx`, `lib/auth.tsx`,
  `command-menu.tsx` still on `useContext` + `<Context.Provider>`. Effort S.
- **TanStack Table feature-block duplication** — `product-table.tsx:46-57`
  vs `invoice-table.tsx:28-39`. Extract a shared factory. Effort S.
- **Create-organization flow duplicated** —
  `create-organization-page.tsx:22-38` and `settings-page.tsx:31-48`.
  Extract `useCreateOrganization()`. Effort S. (Fixing CORR-03 above at the
  same time is natural.)
- **List routes lack `errorComponent`** — `products/index.tsx`,
  `invoices/index.tsx`, `invoices/new.tsx`, `products/new.tsx`,
  `products/upload.tsx`. Effort S.

## Direction findings (2026-07-25 — options for the maintainer, not ranked against bugs)

Status of the four 2026-07-19 direction findings, re-verified at `8b1efa49`:
**DIR-01 (upload backend) is DONE.** **DIR-03 (surface sync state) is
PARTIAL** — `sync-status.tsx` now shows online/offline, phase and
`lastSyncedAt`, but no pending count or divergence view; plan 019 extends the
contract with exactly the fields the UI would need. **DIR-02 and DIR-04 remain
OPEN** and are carried forward below.

- **Invoice correction: void / return / refund.** Sales are still create-only
  (`packages/persistence/src/invoice-store.ts:19-28`). But `"adjustment"` is
  already a first-class movement type in the local schema
  (`packages/db/src/shared/store.schema.ts:214`), already decoded by the client
  (`sync-engine.ts:50`), and already accepted and validated by the server
  (`apps/server/src/sync/row-validation.ts:106-113`) — with **zero producers**
  anywhere. It is unreachable scaffolding that only makes sense as a reversal
  ledger. Stock movements are also already immutable by protocol
  (`apply-change.ts:191-246`), which is the guarantee a reversal ledger needs.
  Today a mis-rung sale can only be "fixed" by inventing a compensating
  stock-in, which corrupts both the movement ledger and the revenue analytics
  derived from it. This is the largest product gap for a POS. Effort M
  (coarse). Confidence HIGH.
- **Product search in the command palette.** `/search` already runs ranked
  trigram + phonetic search in PGlite (`product-store.ts:186-250`, indexes
  ensured by `ensureLocalSearchIndexes`), exposed on the IPC surface as
  `searchProducts` and used with debounce and cancellation by
  `search-page.tsx:52-70`. The palette reached by `/` from anywhere
  (`search-form.tsx:11`, `command-menu.tsx:105-119`) is navigation-only: eight
  static routes filtered by string match, with "Search products" as a _link to
  another page_. The expensive half is built and indexed; the palette simply
  does not call it. Highest ratio of user value to remaining work in the repo
  for a POS, where finding a product fast is the core interaction. Effort S–M
  (coarse). Confidence HIGH.
- **Let the upload review flow work offline.**
  `components/uploads/context.tsx:135-142` refuses `applyChanges` when offline,
  but everything it calls is local — `importInventory` writes to PGlite and
  enqueues an outbox operation, and the subsequent `sync()` already degrades
  gracefully. Only `analyse` genuinely needs the network, and it is correctly
  gated separately. Meanwhile the reviewed state lives only in component
  `useState` (`:66-68`), so navigating away discards AI work already paid for.
  This contradicts the product's core offline-first promise on the one screen
  where the cost was already incurred. Effort S for the gate removal; M if
  reviewed changes should survive navigation and restart. Confidence HIGH.
- **Export: CSV out, and a printable receipt.** Import is fully built
  end-to-end; export does not exist in any form — no method on
  `OfflineStoreApi` (`contracts/offline-store.api.ts:22-41`), no IPC channel,
  no save dialog. The same asymmetry exists per-invoice:
  `invoices/detail-page.tsx` already renders a fully formatted invoice and
  there is no print/PDF/receipt code anywhere. Both are unusually cheap here —
  the renderer holds fully typed data and Electron gives
  `dialog.showSaveDialog` and `webContents.printToPDF` for free in the main
  process that already owns the IPC surface. Worth splitting: CSV first,
  receipts second. Effort S–M / M (coarse). Confidence MED-HIGH.
- **Decide the AI-model story, or delete the half that is left.** The
  extraction model is one hardcoded constant
  (`apps/server/src/ai/invoice-ai.ts:8`) with no fallback, no per-organization
  override, and no way to A/B a replacement when Workers AI deprecates it —
  while `ModelCatalogService` (`packages/services/src/model-catalog.ts:11-33`),
  built to list selectable models, is exported and imported by nobody after
  its route was dropped. Extraction quality is the entire value of the upload
  feature. Effort S if the answer is "delete the catalog and pin the model in
  an ADR"; M if it is "expose per-organization model selection". Confidence
  MED — the evidence is solid, the right answer is a product call.

## Direction findings (2026-07-19 — options for the maintainer, not ranked against bugs)

- **DIR-01: Ship the invoice-upload backend.** The renderer half is complete
  and calls `/api/models` + `/api/uploads` through the main process
  (`main.ts:284,314`), but the Worker exposes only health/auth/sync
  (`http/app.ts:28-38`) and `@store/services` (`InvoiceExtractionService`,
  `ModelCatalogService`) is imported by nobody; `apps/api/README.md` says the
  services attach to a dedicated runtime "later". The visible upload feature
  404s against the only configured backend. A design/spike plan should pick
  the runtime (Worker vs separate service), define the contracts (plan 009's
  schemas become the source of truth), and wire the layers. Effort L
  (coarse). Confidence HIGH.
- **DIR-02: Invoice correction path (void/return/refund).** Sales are
  create-only (`invoice-store.ts:22-28`: list/get/create; no reversal
  anywhere; movement types are `sale`/`open_pack`/`stock_in` with no
  reversal type). A POS without a way to reverse a mis-rung sale forces
  fake compensating entries. Reuses the outbox/attribution machinery.
  Effort M (coarse). Confidence HIGH.
- **DIR-03: Surface sync/reconciliation state.** README promises "Reconcile
  inventory after replicas reconnect"; the server keeps `sync_change_log`
  and runs `reconcileBatch`, but the only client surface is a sync
  phase/error button — no pending-operation count, no divergence view.
  Design/spike over existing data. Effort M (coarse). Confidence MED-HIGH.
- **DIR-04: Inventory/catalog CSV export.** Import exists end-to-end; no
  export of any kind. One-directional pair; cheap over the typed stores.
  Effort S–M (coarse). Confidence MED.

## Findings considered and rejected

2026-07-25 run:

- **"`shadcn` and `@shadcn/react` are unused dependencies"** — partially
  rejected. `shadcn` **is** used, via `@import "shadcn/tailwind.css"` at
  `apps/desktop/src/styles.css:2`. Only `@shadcn/react` appears genuinely
  unimported. Verify individually before removing either.
- **"Effect protocol errors are silently collapsed to 503 in `routes/sync.ts`"**
  — rejected. Verified against `effect@4.0.0-beta.101` that `runPromise`
  rejects with `causeSquash(cause)`, i.e. the raw failure value, so the
  `cause instanceof SyncProtocolError` checks at `routes/sync.ts:86-92` do work.
  Worth noting the 403/409/422 branches are untested (`sync.test.ts` covers
  only 401/403/200/400), so this correctness rests on library behaviour no test
  pins.
- **Multi-tenant IDOR in the sync path** — rejected after tracing every query
  in `sync/apply-change.ts`, `operation.ts`, `inventory.ts` and `database.ts`:
  all selects, upsert conflict targets and the change-log pull are scoped by
  `actor.organizationId`, and `service.ts:42-46,84-88` rejects any request or
  operation claiming a different org. Push idempotency via `syncInbox` +
  advisory lock + payload-hash comparison (`operation.ts:35-100`) is sound
  under retry. The same check on `packages/persistence` found every read and
  write org-scoped, with `analytics-store.test.ts:243-262` asserting cross-org
  isolation.
- **"`reconcileBatch` zeroes client-sent batch quantities"** — rejected.
  `product-store.ts:406-470` always emits the `stock_in` movement under the
  same `operationId` as the batch insert, so the server's movement-sum
  reconciliation is correct. It is a tight coupling worth a comment, not a bug.
- **`searchProducts` raw SQL as an injection risk** — rejected; the hand-written
  SQL binds through Drizzle parameters (`product-store.ts:193-211`).
- **`packages/db` local/remote schema duplication** — rejected; `local/schema.ts`
  and `remote/schema.ts` are 2- and 3-line re-exports over a shared
  `shared/store.schema.ts`. Already correctly factored.
- **Consolidating the Worker's two DB access paths** (Kysely + `pg` for Better
  Auth, `@effect/sql-pg` for sync) — rejected; Better Auth requires its own
  Kysely adapter, so the split is imposed by the dependency, not the code.
- **Pre-release pins on `effect`, `typescript`, `drizzle-orm`** — recorded, not
  a finding. It is a deliberate and internally consistent bet, enforced the
  right way via catalog + override. The cost (a breaking change in any of the
  three is a whole-repo migration) is worth an ADR, not a fix.
- **`TODO`/`FIXME` debt** — none exists in tracked source outside generated
  files. The unfinished intent in this repo surfaces as dead enum branches and
  unwired services instead, which is where the direction findings are anchored.
- Offline concurrent-stock overselling — documented README tradeoff;
  re-confirmed and excluded for the third consecutive run.

2026-07-19 run:

- **"README `vp install` is wrong"** — rejected: `vp install` is a real
  Vite+ CLI command ("Install all dependencies", verified via `vp help`);
  the README is correct.
- **"`main.ts` env reads should use Effect `Config`"** — rejected: the
  bootstrap reads carry an explicit in-code rationale (`main.ts:70-71` — Vite
  inlines `import.meta.env` dot-access; bracket `process.env` reads are
  deliberate runtime overrides), and the Effect convention targets Effect
  application logic, not the imperative Electron entrypoint.
- Offline concurrent-stock overselling — documented README tradeoff
  (re-confirmed; both audits excluded it).
- Anonymous update FETCH from a public releases repo — a reasonable
  distribution choice for an unsigned OSS desktop app; the actionable gap is
  the missing signing (SEC-02 above), not the public fetch.

2026-07-15 run:

- `form.Field`/`Combobox` function-children render props — library APIs
  explicitly allowed by the composition rules; not a finding.
- Drizzle-derived `Schema.Struct` schemas in `@store/contracts` — established
  repo convention; not a finding.
- `nav-main.tsx` `isActive` and `auth-page.tsx` sign-in/up `mode` — data
  flags, not boolean-prop proliferation.
- `InvoicePricingDialog` local buffered state — deliberate edit buffer; fine.
- `forwardRef` usage — none exists anywhere (React 19 rule satisfied).
- Type escape hatches in Effect code — none found in the audited Effect
  packages at `a98b4aa7`. (The 2026-07-19 run found new `as` casts in the
  upload flow — addressed by plan 009.)

## What was NOT audited

2026-07-25 run: `.repos/**` (the vendored upstream Effect clone — explicitly
excluded from every subagent brief), `apps/desktop/src/components/ui/**` as
_implementations_ (they were checked only for dead files and for the
`font-semibold`/`text-xl` counts behind plan 014), generated files
(`routeTree.gen.ts`, `worker-configuration.d.ts`), `packages/db` migration file
internals, `.claude/worktrees/**`, and Better Auth's own internals. No runtime
or dynamic analysis was performed — the app was never launched, so CSP,
updater, and window behaviour were assessed from code only, and the
`invoice_items` index finding (PERF) is a MED-confidence read that wants one
`EXPLAIN ANALYZE`. Dependency work covered `bun audit` advisories only, not
license or supply-chain provenance. Renderer components were reviewed for
architecture, dead code and error handling, not exhaustively for correctness.

2026-07-19 run: `apps/desktop/src/components/ui/**` (vendored shadcn),
generated files, `packages/db` schema/migration internals, deep renderer
component-by-component review (only files changed since `a98b4aa7` got the
thorough correctness pass), and runtime dynamic analysis (no app was driven;
CSP/updater behavior was assessed from code). Dependency audit covered
`bun audit` advisories only, not license or supply-chain provenance review.
