# AGENTS.md

## Cursor Cloud specific instructions

This repository is a **Bun-only Turborepo monorepo** (a scaffold). Standard commands live in `README.md` (`bun run dev|build|lint|check-types|format`); use those.

Non-obvious notes for working in this repo:

- **Package manager is Bun only** (pinned `bun@1.1.42`). Do not use npm/yarn/pnpm. Bun is preinstalled in the Cloud VM (at `~/.bun/bin` and symlinked into `/usr/local/bin`), and the startup update script runs `bun install`.
- **Turbo 2.x** is in use, so `turbo.json` uses the `tasks` key (not the pre-2.0 `pipeline` key).
- **Turbo prints a benign warning** `Lockfile not found at /workspace/bun.lock`. Bun 1.1.42 writes a binary `bun.lockb` (which is gitignored), while Turbo looks for the newer text `bun.lock`. Tasks still run correctly; the warning can be ignored.
- **`apps/web` and `packages/ui` are placeholders.** All `apps/web` scripts are `echo` stubs and `packages/ui` is a stub export, so there is no running service, port, or UI yet. There are no automated tests. As real apps are added under `apps/*`, give each its own `dev`/`build`/`lint`/`check-types` scripts so Turbo picks them up.
