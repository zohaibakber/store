<!--VITE PLUS START-->

# Using Vite+

This project uses Vite+ through the `vp` CLI. Vite+ covers runtime, packages, and
frontend tools: Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. It
is not Vite itself; `vp dev` and `vp build` call Vite. Run `vp help` or
`vp <command> --help` for details.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in commands vs scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

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

## UI components

`apps/web/src/components/ui` is a registry managed by `components.json`, not
application code. Primitives there may have no importer yet. That is inventory,
not dead code, so don't delete them for being unused.

## Cursor Cloud instructions

Toolchain (Bun `1.3.14` + the Vite+ `vp` CLI) is preinstalled in the VM and on
`PATH` in login shells. The startup update script runs `vp install` and fetches
the Electron binary. From the repo root: `vp install`, `vp check`, `vp test`,
and `vp build` (Turborepo fans them out per package).

- **Electron binary.** Bun does not run Electron's `postinstall`, so
  `bun install`/`vp install` alone leave `apps/desktop/node_modules/electron`
  without its `dist/` binary. Fetch it via that package's `install.js` (the
  update script does this with `bun`). If `vp dev` for the desktop errors that
  Electron is missing, run
  `bun apps/desktop/node_modules/electron/install.js`.
- **Desktop app.** `cd apps/desktop && vp dev` starts the Vite dev server
  (`:5173`) and launches Electron. In the headless VM you must set
  `ELECTRON_DISABLE_SANDBOX=1` (the SUID `chrome-sandbox` helper can't run) and
  `DISPLAY=:1`. `ERROR:dbus/...` lines in the log are harmless.
- **Backend.** `apps/server` runs via
  `bun alchemy dev --stage dev --env-file .env.dev` on port `:8787`. Alchemy
  stores state remotely and binds real dev-stage D1 + Durable Objects. There is
  no local emulation. It fails fast without `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID`, and needs a `.env.dev` with the auth JWT key pair,
  refresh and ephemeral peppers, and Google OAuth credentials. Use different
  secrets per stage. Do not commit env files or env templates.
- **Auth gating.** The desktop renderer is gated behind sign-in/sign-up, which
  call the backend API. End-to-end auth UI (sign up, create organization, sync)
  needs the backend running with the credentials above. Offline, the desktop
  still opens a local "Locked" libSQL store. The inventory engine lives in
  `@store/persistence` (`OfflineStore`) and can be driven directly without the
  backend.
