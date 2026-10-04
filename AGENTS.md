<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Tests

Write tests freely to reproduce or verify a change, then delete them. Only
commit a test when it is absolutely required, such as guarding a sync-engine
invariant that nothing else covers. Don't add a test file per fix.

## Typography

These rules apply to all UI work in `apps/web`. The tokens live in
`apps/web/src/styles.css` (Tailwind v4 `@theme` block).

Conventions, not hard clamps: `@theme` sets the font family, but nothing blocks
other weights or sizes. Follow the rules anyway.

- **Font.** Inter (`"Inter Variable"`, loaded via `@fontsource-variable/inter`).
  JetBrains Mono (`"JetBrains Mono Variable"`, loaded via
  `@fontsource-variable/jetbrains-mono`) is for code only.
- **Weights.** Regular (400) and medium (500) only. Medium is the maximum.
  Avoid `font-semibold` and `font-bold`. Nothing prevents them, so a few uses
  have crept in; don't add more.
- **Font sizes.** 12px and 14px are the base sizes (body text is 14px, small
  text is 12px). The scale is 12 / 14 / 16 / 18 / 24. Use Tailwind utilities:
  `text-xs` (12), `text-sm` (14, body default), `text-base` (16), `text-lg`
  (18), `text-2xl` (24). Avoid `text-xl` and `text-3xl`+ and don't introduce
  new sizes.
- **Icons.** Hugeicons, via `<HugeiconsIcon icon={...} />` from
  `@hugeicons/react` with icons from `@hugeicons/core-free-icons`.

## Effect

Before writing, reviewing or refactoring code that imports `effect` or `@effect/*`,
read `.agents/skills/effect/SKILL.md` and the references it points to for the
change, then `docs/effect-profile.md`. The skill is the portable target and
carries nothing about this repo. The profile holds what is local: the service id
prefix, each host's edge, where contracts live and the exemplar files. Existing
code that differs from the target is listed in `docs/effect-departures.md` and is
not a pattern to copy.

Before calling an Effect change done, ask of every piece you wrote: **is there a
better way to do this in Effect?** Check the skill's module map and the installed
`effect` package (`node_modules/effect/dist/*.d.ts`, `ai-docs`) for a module or
combinator that already does it, such as `Effect.timeoutOrElse` instead of
`timeoutOption` plus a check, `Effect.fn` instead of an unnamed wrapper, or
`FiberSet`/`Stream.callback` instead of a hand-written runner. Switch to it, or
keep your version only when you can name why the alternative does not fit, and
say so in the PR.

## Sync engine boundaries

- Replicas hard-delete. A `delete` change removes the row; client schemas carry
  no `deletedAt`.
- The shared entrypoint of `packages/sync` (`@store/sync`) must stay native-free.
  `packages/sync/test/browser-boundary.test.ts` enforces it, because the renderer
  and mobile import that entry; SQLite belongs in `@store/sync/sqlite`. No
  browser replica exists: outside Electron the renderer has no replica.
- Command state never crosses process boundaries as SQL or query IR. The
  renderer reaches the replica only through `InventoryReads` (named bounded
  reads), `InventoryStore` (domain commands, commit and health streams),
  `InventoryInsights`, and `DesktopRpcs` (main-owned workspace state), all
  Effect RPC over MessagePorts. Preload IPC carries open, close, backup,
  restore, and publish only. Adding a read means adding a named member, not a
  parameter.
- The pull digest is requested on the cadence policy only, when the replica
  believes it is caught up and the verification interval has elapsed.

## UI components

`apps/web/src/components/ui` is a registry managed by `components.json`, not
application code. Primitives there may have no importer yet. That is inventory,
not dead code, so don't delete them for being unused.

After changing UI code in `apps/web`, run `vp run lint:design`. Application code
must pass the design-system rules with zero errors; registry-owned COSS primitives
under `apps/web/src/components/ui` stay governed by their upstream definitions.

## Cursor Cloud instructions

Toolchain (pnpm `11.27.1` + Node.js 24 + the Vite+ `vp` CLI) is installed in the VM and on
`PATH` in login shells. The startup update script runs `vp install` and fetches
the Electron binary. From the repo root: `vp install`, `vp check`, `vp run -r check`,
and `vp test`. `vp check` type-checks every package against its own tsconfig and
`vp test` runs every package's tests, so packages carry no per-package `check` or
`test` scripts. The only package `check` is `@store/db`'s Drizzle schema and
migration-bundle check. Run one package's tests with `vp test packages/sync`.

- **Electron binary.** If installation leaves `apps/desktop/node_modules/electron`
  without its `dist/` binary, or `vp dev` for the desktop errors that Electron
  is missing, run `node apps/desktop/node_modules/electron/install.js`.
- **Desktop app.** `vp run dev` from the repo root starts the API/auth workers
  and `apps/desktop` in parallel. Its `vp dev` command serves `apps/web` as the
  renderer on `:5174`, builds main/preload, and launches Electron. `vp run dev:web`
  serves `apps/web` in the browser instead. Unpackaged/dev keeps an
  escape hatch: `ELECTRON_DISABLE_SANDBOX=1` (the SUID `chrome-sandbox` helper
  can't run) and `DISPLAY=:1` in the headless VM. Production packages flip
  Electron Fuses in electron-builder's `afterPack` hook and keep
  `sandbox: true`. `ERROR:dbus/...` lines in the log are harmless. Package with
  `vp run --filter @store/desktop build` (or `release`). Do not set
  `nodeLinker: hoisted` — that duplicates React across packages.
- **Backend.** `apps/server` runs via
  `pnpm exec alchemy dev --stage dev --env-file .env.dev` on port `:8787`. Alchemy
  stores state remotely and binds real dev-stage D1, Hyperdrive, and Postgres.
  There is no local emulation. It fails fast without `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID`, and needs a `.env.dev` with the auth JWT key pair,
  refresh and ephemeral peppers, and Google OAuth credentials. Use different
  secrets per stage. Do not commit env files or env templates.
- **Auth gating.** The desktop renderer is gated behind
  sign-in/sign-up, which call the backend API. End-to-end auth UI (sign up,
  create organization, sync) needs the backend running with the credentials
  above. D1 is auth. Inventory commands commit in Postgres through
  `/api/sync/*` (Neon in `dev`, PlanetScale in `prod`).
  Inventory can be driven from the local replica without the backend after the
  first sync.
