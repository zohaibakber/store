# Bun-only Turborepo

This repository is configured to use **Bun only** for package management and scripts.

## Getting started

```bash
bun install
bun run dev
```

## Workspace layout

- `apps/*` for applications
- `packages/*` for shared packages

## Commands

- `bun run dev` — start all dev tasks through Turborepo
- `bun run build` — build all packages/apps
- `bun run lint` — lint all packages/apps
- `bun run check-types` — run type checks across the monorepo
- `bun run format` — format files with Prettier
