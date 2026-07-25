# Plan 014: Make AGENTS.md and the READMEs describe the code that actually exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8b1efa49..HEAD -- AGENTS.md README.md apps/server/README.md apps/desktop/src/styles.css apps/desktop/package.json`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `8b1efa49`, 2026-07-25

## Why this matters

`AGENTS.md` is the only convention document in this repository, and every
concrete, checkable claim in its Typography section is false at HEAD. It tells
the reader the app uses the Inter font loaded via `@fontsource-variable/inter`
(it uses Geist), that Lucide icons are styled by a global `.lucide` rule (there
is no Lucide anywhere in the app — it uses `@hugeicons/react`), and that the
Tailwind theme "clamps" font weights and text sizes (no such tokens exist).

The playbook this repo is audited against calls stale docs "worse than
missing", and this is the exact failure mode: an agent following `AGENTS.md`
would install the wrong font package, search for a CSS rule that does not
exist, and trust a clamp that is not enforcing anything. Because plans in this
repository are executed by agents that read `AGENTS.md` first, every future
plan inherits these errors.

`apps/server/README.md` has the same problem in the other direction: it
explicitly argues that the Worker "intentionally does not host" invoice upload
routes, which is the opposite of what shipped.

After this plan, the docs describe the code as it is, and gain the workspace
architecture map that is currently missing entirely.

## Current state

### Files

- `AGENTS.md` — 35 lines. Lines 1–16 are an auto-generated
  `<!--VITE PLUS START-->` block (do not touch). Lines 18–35 are the false
  Typography section.
- `README.md` — root. Its "Workspace boundaries" list omits `apps/server`
  entirely and describes `packages/services` as living "outside the API Worker".
- `apps/server/README.md` — describes a three-route Worker; four routes exist.

### The false claims, and the truth

`AGENTS.md:21-22` currently says:

```markdown
- **Font**: Inter (`"Inter Variable"`, loaded via `@fontsource-variable/inter`).
  Geist Mono for code only.
```

Reality — `apps/desktop/src/main.tsx:9-10`:

```ts
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
```

Reality — `apps/desktop/src/styles.css:7-8`:

```css
--font-heading: var(--font-sans);
--font-sans: "Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

`@fontsource-variable/inter` is **not** a dependency of `apps/desktop`.

`AGENTS.md:34-36` currently says:

```markdown
- **Icons**: Lucide icons use a 1.2 stroke width, applied globally via the
  `.lucide` rule in `styles.css` — don't pass a `strokeWidth` prop.
```

Reality: `grep -rn 'lucide' apps/desktop/` returns **zero** matches. The app
uses `@hugeicons/react` with `@hugeicons/core-free-icons`
(`apps/desktop/package.json`).

`AGENTS.md:23-24` and `:30-32` claim the theme "clamps" `font-semibold`/
`font-bold` to 500 and clamps `text-xl`/`text-3xl` into the scale. Reality:
`grep -n 'font-weight\|--text-' apps/desktop/src/styles.css` returns **nothing**
— there are no such `@theme` tokens, so nothing is clamped. Live counter-
examples: `apps/desktop/src/components/invoices/detail-page.tsx:96` renders
`text-xl`, and eight files under `apps/desktop/src/components/ui/` use
`font-semibold`.

### The architecture facts to add (verified at `8b1efa49`)

Seven workspaces:

| Workspace              | Runtime                  | Role                                                                  |
| ---------------------- | ------------------------ | --------------------------------------------------------------------- |
| `apps/desktop`         | Electron 43 + React 19   | Electron lifecycle, typed IPC, preload security, React UI             |
| `apps/server`          | Cloudflare Worker (Hono) | `/api/health`, `/api/auth/*`, `/api/sync`, `/api/uploads`             |
| `packages/contracts`   | shared                   | Effect Schema contracts across the renderer/main/server boundary      |
| `packages/db`          | shared                   | Drizzle schemas; `shared/store.schema.ts` backs both local and remote |
| `packages/persistence` | Electron main            | PGlite driver, transactional outbox, Effect services                  |
| `packages/auth`        | shared                   | Better Auth config (its tables live in `packages/db`)                 |
| `packages/services`    | Worker                   | AI invoice extraction                                                 |

Non-obvious invariants an agent will otherwise violate:

- Money is stored as **integer paisa**, never floats
  (`packages/db/src/shared/store.schema.ts:126,176`).
- Every local business write must also enqueue an outbox operation
  (`packages/persistence/src/outbox.ts`).
- Stock movements are immutable; the server rejects deletes and id reuse
  (`apps/server/src/sync/apply-change.ts:191-246`).
- PGlite must stay external to the Electron bundle
  (`apps/desktop/vite.config.ts`).
- Inventory is tracked in **packs and items** with FEFO (first-expiry-first-out)
  batch allocation.

### `apps/server/README.md` drift

It currently lists "three public surfaces" (`/api/health`, `/api/auth/*`,
`/api/sync`) and contains a paragraph stating the Worker "intentionally does
not host" invoice upload or model-catalog routes, with AI extraction in
`packages/services` "so they can be attached to a dedicated runtime later".

Reality — `apps/server/src/http/app.ts:40-42`:

```ts
api.use("/uploads", requireOrganization);
api.route("/sync", syncRoute);
api.route("/uploads", uploadsRoute);
```

and `apps/server/src/routes/uploads.ts:1` imports `InvoiceExtractionService`
from `@store/services`, running it in-Worker on the Workers AI binding declared
at `apps/server/wrangler.jsonc:9-11`. The README also omits that `AI` binding
from its list of Worker requirements.

## Commands you will need

| Purpose               | Command         | Expected on success |
| --------------------- | --------------- | ------------------- |
| Format/lint/typecheck | `bunx vp check` | exit 0              |
| Workspace checks      | `bun run check` | exit 0              |
| Tests                 | `bun run test`  | exit 0, all pass    |

## Scope

**In scope** (the only files you may modify):

- `AGENTS.md`
- `README.md`
- `apps/server/README.md`

**Out of scope** (do NOT touch):

- `AGENTS.md` lines 1–16, the `<!--VITE PLUS START-->` … `<!--VITE PLUS END-->`
  block. It is generated by the Vite+ toolchain and will be overwritten.
- `apps/desktop/src/styles.css` — this plan documents reality; it does NOT
  change the theme. Do not add the clamping tokens to "make the doc true".
  That is a separate design decision, deliberately deferred (see Maintenance).
- Any source file. This is a documentation-only plan.

## Git workflow

- Branch: `advisor/014-agents-md-truth-up`
- One commit is fine. Message style matches `git log` (short imperative,
  no prefix), e.g. `Correct AGENTS.md typography and add architecture map`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the Typography section in `AGENTS.md`

Keep the heading `## Typography` and the sentence scoping it to `apps/desktop`.
Rewrite the bullets to state what is true:

- **Font**: Geist (`"Geist Variable"`), loaded via `@fontsource-variable/geist`
  in `src/main.tsx`. Geist Mono (`@fontsource-variable/geist-mono`) for code.
  Tokens are `--font-sans` / `--font-mono` in the `@theme` block of
  `src/styles.css`.
- **Icons**: `@hugeicons/react` with `@hugeicons/core-free-icons`.
- **Weights and sizes**: state the _intent_ (regular 400 and medium 500;
  12/14/16/18/24 scale, 14px body) and add an explicit note that this is a
  convention the theme does **not** currently enforce — there are no
  `--font-weight-*` or `--text-*` overrides in `styles.css`, and
  `components/ui/**` still contains `font-semibold` and `text-xl` usages.

Do not claim any clamping exists.

**Verify**: `grep -n 'Inter\|lucide\|clamp' AGENTS.md` → no matches for
`Inter` or `lucide`; any `clamp` match must be in a sentence saying it is
_not_ enforced.

### Step 2: Add a "Workspace map" section to `AGENTS.md`

Below the Vite+ block and above Typography, add `## Workspace map` containing
the seven-row table from "Current state" above, then `## Invariants` with the
five bullets listed there. Each invariant keeps its `file:line` pointer.

**Verify**: `grep -c 'apps/server' AGENTS.md` → at least 1.

### Step 3: Add per-workspace commands to `AGENTS.md`

Add a `## Commands` section recording:

- Repo-wide: `bunx vp check` (format + lint + typecheck), `bunx vp test`,
  `bun run check` (per-workspace `tsc`/wrangler checks), `bun run build`.
- `packages/db`: `bun run db:generate` (regenerates BOTH local and remote
  migrations), `bun run db:migrate` (remote only).
- `apps/server`: `bun run typegen` (regenerates `worker-configuration.d.ts`).
- Note the gap: `packages/{auth,contracts,db,services}` define no `test`
  script, so `bun run test` (turbo) and `bunx vp test` (root vitest globs)
  do not cover the same files.

**Verify**: `bunx vp check` → exit 0 (this formats the markdown too).

### Step 4: Fix the root `README.md` workspace boundaries

In the "Workspace boundaries" list, add the missing `apps/server` bullet
describing it as the Cloudflare Worker hosting health, auth, sync, and uploads.
Correct the `packages/services` bullet: it is consumed **by** the Worker
(`apps/server/src/routes/uploads.ts`), not deployed outside it.

**Verify**: `grep -n 'apps/server' README.md` → at least one match in the
workspace boundaries list.

### Step 5: Fix `apps/server/README.md`

Three edits:

1. The public-surface list becomes four routes, adding
   `POST /api/uploads` (behind `requireOrganization`).
2. Delete the "intentionally does not host invoice upload or model-catalog
   routes" paragraph. Replace it with the decision that actually shipped:
   invoice extraction runs in-Worker on the Workers AI binding via
   `@store/services`, which stays runtime-agnostic so it can be hosted
   elsewhere later.
3. Add the `AI` binding (`wrangler.jsonc:9-11`) alongside `HYPERDRIVE` in the
   list of what the Worker requires.

**Verify**: `grep -n 'intentionally does not host' apps/server/README.md` →
no matches.

### Step 6: Full verification

**Verify**: `bunx vp check` → exit 0, and `bun run test` → exit 0.

## Test plan

No new automated tests — this is a documentation plan and the repo has no docs
linter. Verification is by the greps in each step plus `bunx vp check`, which
formats markdown and will fail on malformed tables.

Manual check before declaring done: re-read the finished `AGENTS.md` Typography
section side by side with `apps/desktop/src/styles.css` lines 6–60 and confirm
every factual claim is visible in that file or in
`apps/desktop/package.json`.

## Done criteria

ALL must hold:

- [ ] `grep -rn 'fontsource-variable/inter' AGENTS.md` → no matches
- [ ] `grep -rni 'lucide' AGENTS.md` → no matches
- [ ] `grep -n 'apps/server' AGENTS.md README.md` → matches in both files
- [ ] `grep -n 'intentionally does not host' apps/server/README.md` → no matches
- [ ] `bunx vp check` exits 0
- [ ] `bun run test` exits 0
- [ ] `git status --short` shows only `AGENTS.md`, `README.md`,
      `apps/server/README.md` modified
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `apps/desktop/src/main.tsx` imports an Inter fontsource package, or
  `styles.css` sets `--font-sans` to something other than Geist — the drift
  went the other way and this plan's premise is wrong.
- `grep -rn 'lucide' apps/desktop/` returns matches — the icon claim may be
  partially true and needs re-checking before you rewrite it.
- `apps/desktop/src/styles.css` contains `--font-weight-*` or `--text-*`
  tokens — the clamping claim is true after all; document it as enforced
  instead, and report the discrepancy.
- You find yourself wanting to edit a source file to make a doc claim true.
  That is out of scope; report it instead.

## Maintenance notes

- **Deliberately deferred**: the question of whether the weight/size clamping
  _should_ be enforced by `@theme` tokens (plus a lint rule banning
  `font-semibold` outside `components/ui/`) is a real design decision and is
  not part of this plan. This plan only stops the doc from lying. If the team
  later decides to enforce it, `components/ui/**` needs a sweep first — eight
  files currently violate it.
- The Vite+ block at the top of `AGENTS.md` is regenerated by the toolchain.
  Never put durable content inside it; everything this plan adds goes below
  the `<!--VITE PLUS END-->` marker.
- A reviewer should spot-check two or three factual claims against
  `styles.css` and `package.json` rather than reading for prose quality — the
  failure mode this plan fixes is confident-sounding wrongness.
- If `packages/{auth,contracts,db,services}` later gain `test` scripts, the
  caveat added in Step 3 must be removed.
