# Plan 008: Gate the repo with CI — check, lint, and tests on every push/PR, and wire `test` into Turbo

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe1891d6..HEAD -- .github/workflows turbo.json package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `fe1891d6`, 2026-07-19

## Why this matters

The only workflow in `.github/workflows/` is `release.yml`, which fires on
`v*` tags and goes straight from `bun install` to `bun run release` — nothing
ever runs typechecks, lint, or the 28-test suite before code lands on
`master` or ships inside a tagged desktop release. Additionally `turbo.json`
defines no `test` task and the root `package.json` has no `test` script, so
there is no single orchestrated entry point for tests. This plan adds a CI
workflow and the missing task wiring. It is the verification gate every other
plan in this directory relies on.

## Current state

- `.github/workflows/release.yml:1-27` — triggers on `push: tags: v*`;
  matrix `[ubuntu-latest, windows-latest]`; steps: checkout →
  `oven-sh/setup-bun@v2` with `bun-version: 1.3.14` →
  `bun install --frozen-lockfile` → version stamp → `bun run release`
  (in `apps/desktop`, env `GH_TOKEN`/`VITE_API_URL`/`ELECTRON_PROTOCOL` from
  secrets). No check/lint/test step. Model your new workflow's setup steps on
  these exact checkout/setup-bun/install steps.
- `turbo.json` — tasks: `build`, `check`, `lint`, `dev`, `preview`. No
  `test`.
- Root `package.json` scripts: `dev`, `build`, `check`, `lint`, `preview` —
  all `turbo run ...`. No `test`.
- Workspace test posture: `apps/api` has
  `"test": "vitest run --root ../.. apps/api/src"`. `packages/persistence`
  has many `*.test.ts` files but NO `test` script. No other workspace has
  tests or a `test` script.
- The Vite+ CLI (`vp`) provides `vp test` (runs Vitest across the repo from
  the root — verified working: 11 files / 28 tests, ~52s) and `vp check`
  (format + lint + typecheck). `vp` comes from the `vite-plus` devDependency;
  in CI invoke it as `bunx vp ...` (or `bun x vp ...`).
- KNOWN BASELINE ISSUE: `vp check` at the repo root currently fails on
  formatting for untracked local files under `.agents/skills/effect/` — those
  files are NOT committed, so CI (which sees only tracked files) will not hit
  this. Do not "fix" those files.

## Commands you will need

| Purpose          | Command                                                                         | Expected on success      |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------ |
| Install          | `vp install`                                                                    | exit 0                   |
| Repo check       | `vp check`                                                                      | see baseline note above  |
| Tests            | `vp test`                                                                       | 11 files / 28 tests pass |
| Turbo test (new) | `bun run test`                                                                  | all workspace tests pass |
| Workflow lint    | `bunx action-validator .github/workflows/ci.yml` (if available; otherwise skip) | exit 0                   |

## Scope

**In scope** (the only files you should modify):

- `.github/workflows/ci.yml` (create)
- `turbo.json` (add `test` task)
- `package.json` (root — add `test` script)
- `packages/persistence/package.json` (add `test` script)

**Out of scope** (do NOT touch):

- `.github/workflows/release.yml` — leave the release path alone in this
  plan (gating releases on CI is a possible follow-up, noted in Maintenance).
- Any source file, any other workspace `package.json`.
- Turborepo remote-cache configuration (needs account decisions the executor
  cannot make).

## Git workflow

- Branch: `advisor/008-ci-verification-workflow`
- Do NOT push or open a PR unless the operator instructed it. (Note: the
  workflow can only be observed running once pushed — the done criteria below
  are therefore local-only; say so in your report.)

## Steps

### Step 1: Wire `test` into Turbo

- `turbo.json`: add to `tasks`:

```json
"test": {
  "dependsOn": ["^build"],
  "cache": false
}
```

(`cache: false` because the persistence tests exercise a filesystem PGlite
instance; caching them against file inputs invites stale passes. Revisit if
test time becomes a problem.)

- Root `package.json`: add `"test": "turbo run test"`.
- `packages/persistence/package.json`: add
  `"test": "vitest run --root ../.. packages/persistence/src"` (mirroring the
  `apps/api` script's shape).

**Verify**: `bun run test` → runs the api and persistence suites via Turbo;
all pass. Then `vp test` → still 11 files / 28 tests passing (unchanged).

### Step 2: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Check (format, lint, typecheck)
        run: bunx vp check

      - name: Workspace checks
        run: bun run check

      - name: Tests
        run: bunx vp test
```

Notes for the executor:

- `bunx vp check` covers oxfmt/oxlint/tsc at the root; `bun run check` runs
  each workspace's own `check` script (wrangler typegen check, drizzle-kit
  checks) through Turbo. Keep both.
- The default branch is `master` (confirm with `git branch --show-current`
  or `git remote show origin` if a remote exists; adjust the `branches:`
  filter if the repo uses something else).
- Do NOT add secrets to this workflow; nothing in check/test needs them. If a
  workspace `check` fails in a way that demands a secret (e.g. wrangler
  wanting an account), that's a STOP condition, not a reason to inject
  credentials.

**Verify**:

- `bunx vp check` locally → only the known untracked-file formatting failure
  (or clean, if those files are gone).
- `bun run check` locally → exit 0.
- YAML validity: `bun -e "const y=require('js-yaml');y.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log('ok')"` → prints `ok`
  (if `js-yaml` is unavailable, any YAML parse check suffices; a clean
  `git diff --check` plus careful review is the fallback).

## Test plan

No new unit tests — this plan's product IS the test gate. Verification is
running the three commands in Step 2's verify block locally and confirming
the workflow file parses.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists, parses as YAML, and contains
      `bun install --frozen-lockfile`, `bunx vp check`, `bun run check`, and
      `bunx vp test` steps
- [ ] `bun run test` exits 0 (Turbo orchestrates api + persistence suites)
- [ ] `vp test` still reports 11 files / 28 tests passing (or more — never fewer)
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bun run check` fails locally for a reason unrelated to your change (e.g.
  `apps/api`'s wrangler check needing network/credentials) — report which
  workspace and error; the workflow may need that step scoped down, and that
  is a design decision for the reviewer.
- `bunx vp check` fails on TRACKED files at baseline — the repo has drifted;
  report the failures instead of fixing unrelated formatting.
- Adding the Turbo `test` task causes `turbo run test` to schedule a `build`
  of `apps/desktop` (its `build` runs electron-builder — heavyweight). If so,
  report; the `dependsOn: ["^build"]` may need to be dropped or scoped.

## Maintenance notes

- Follow-up worth considering (deliberately out of scope): make
  `release.yml` depend on this CI passing for the tagged commit, so unsigned
  releases can't ship red.
- When new workspaces gain tests, give them a `test` script mirroring
  `apps/api`'s and they will join `turbo run test` automatically.
- If persistence tests get slow in CI, revisit `cache: false` and consider
  `--concurrency` tuning rather than skipping suites.
