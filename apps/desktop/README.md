# Desktop app

Electron + React + TanStack Router client for Tabaaq. This workspace owns the
Electron main process, preload bridge, renderer, Vite configuration, tests, and
packaging.

The renderer uses hash history. Auth, invoice analysis, native integrations, and
authenticated sync HTTP go through preload IPC. Live inventory reads the local
replica: a main-owned Node worker on `@effect/sql-sqlite-node` over
`node:sqlite`, with no native addon to rebuild at packaging time. The web host
uses the IndexedDB replica from `@store/sync/browser` instead.

The preload bridge carries domain commands, bounded reads, and change notices.
Command state never crosses IPC as SQL, and the renderer cannot name a file
path or a table. Sales and catalog edits are the same two sync commands
(`issueInvoice`, `catalogWrite`): they commit locally, show as pending rows,
and settle when the authority's decision arrives through the pull.

## Development

From the repository root:

```sh
vp run dev
```

Turborepo starts the server and desktop workspace. The desktop workspace's plain
`vp dev` command starts Vite on `127.0.0.1:5174`, builds main and preload,
launches Electron, and reloads the relevant process when its source changes.

To run only the desktop workspace against an already-running backend:

```sh
turbo run dev --filter=@store/desktop
```

## Build

```sh
vp run build:desktop
```

The renderer, main process, and preload are built from this workspace before
electron-builder packages the application.

## Release channels

Push testable work to `nightly`. After checks pass, CI deploys the isolated
Nightly cloud stage (auth, API, and R2 snapshots, without PlanetScale) and
publishes a `-nightly.<run>.<attempt>` GitHub prerelease. That build uses the
`nightly` Electron update manifest and displays as `Tabaaq Nightly` with the
orange icon.

Stable installs read only the `latest` update manifest. To ship tested work,
merge `nightly` into `main`, open the `CI` workflow in GitHub Actions, select the
`main` branch, enable `deploy_production`, and run it. A normal push to `main`
only verifies the commit and cannot deploy production.
