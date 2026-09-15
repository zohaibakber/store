# Desktop app

Electron + React + TanStack Router desktop client for Tabaaq. This workspace owns
the Electron main process, preload bridge, renderer, Vite configuration, tests,
and packaging.

The renderer uses hash history and accesses authentication, invoice analysis,
native integrations, and authenticated inventory HTTP through the preload IPC
bridges. PowerSync runs in the renderer with `@powersync/web` and wa-sqlite;
Electron's main process does not open the replica.

## Development

From the repository root:

```sh
vp run dev
```

Turborepo starts the server and desktop workspace. The desktop workspace's plain
`vp dev` command starts Vite on `127.0.0.1:5174`, builds main and preload, launches
Electron, and reloads the relevant process when its source changes.

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
