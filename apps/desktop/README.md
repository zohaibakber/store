# Desktop app

Electron + React + TanStack Router client for Tabaaq. This workspace owns the
Electron main process, preload bridge, renderer, Vite configuration, tests, and
packaging.

The renderer uses hash history. Auth, invoice analysis, native integrations, and
authenticated inventory HTTP go through preload IPC. Live inventory reads the
local replica. Electron packages a main-owned SQLite replica worker; the web
host uses IndexedDB instead.

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
