# AGENTS.md

## Cursor Cloud specific instructions

This repo is a **TanStack Start** app (Vite 8 + React 19 + Tailwind v4) using **shadcn/ui**, managed with **Bun**. Standard scripts are in `package.json`; use those (`bun run dev|build|lint|typecheck|test`).

Non-obvious notes for working in this repo:

- **Package manager is Bun.** Bun is preinstalled in the Cloud VM (`~/.bun/bin`, symlinked into `/usr/local/bin`); the startup update script runs `bun install`. Do not use npm/yarn/pnpm.
- **Dev server:** `bun run dev` runs `vite dev --port 3000` (SSR via TanStack Start). The home route (`src/routes/index.tsx`) is a shadcn component showcase.
- **shadcn config (`components.json`):** base library is **`base` (`@base-ui/react`), not Radix** — components use Base UI APIs (e.g. `render={<Button/>}` on triggers instead of Radix `asChild`). Icon library is **`hugeicons`** (`@hugeicons/react` + `@hugeicons/core-free-icons`), not lucide. Style is `base-rhea`; `rsc: false`.
- **Vendored UI components** live in `src/components/ui` (added via `bunx --bun shadcn@latest add ...`). `eslint.config.js` intentionally relaxes `@typescript-eslint/no-unnecessary-condition` and `no-shadow` for `src/components/ui/**` and `src/hooks/**` since that code is upstream.
- **Registry/version skew:** a few generated components needed small fixes to typecheck against the installed dep versions (`calendar.tsx` uses the `month_grid` classNames key for react-day-picker v10; `spinner.tsx` omits `strokeWidth` from forwarded svg props; `scroll-area.tsx` drops the unused React import). Re-running `shadcn add --overwrite` or upgrading those deps may reintroduce these mismatches — re-apply if `bun run typecheck` fails there.
- `bun.lockb` is committed (not gitignored) for reproducible installs.
