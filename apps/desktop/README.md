# Desktop app

The Electron shell for Tabaaq. This workspace owns the main process, the
preload bridge, the replica and analytics workers, the updater, their tests,
and packaging. It has no UI of its own: the renderer is the web app in
`apps/web`, built and served from here with the shared Vite fragment
`@store/web/vite`.

The dependency runs one way. `apps/web` defines the host contract in
`src/host`; this workspace implements it and imports only `@store/web/host/*`
and `@store/web/vite`. The web app never imports from here.

The renderer uses hash history. Auth, invoice analysis, native integrations,
and authenticated sync HTTP go through preload IPC. Live inventory reads the
local replica: a main-owned Node worker on `@effect/sql-sqlite-node` over
`node:sqlite`, with no native addon to rebuild at packaging time.

The preload bridge carries domain commands, bounded reads, and change notices.
Command state never crosses IPC as SQL, and the renderer cannot name a file
path or a table. Sales and catalog edits are the same two sync commands
(`issueInvoice`, `catalogWrite`): they commit locally, show as pending rows,
and settle when the authority's decision arrives through the pull.

Channel names live in `electron/*-channels.ts`. The bridge types they carry
come from `@store/web/host/*`.

Sentry reports errors only, and only when `VITE_SENTRY_DSN` is set. Each
process uses the SDK made for it. The main process runs `@sentry/electron/main`.
The renderer runs `@sentry/electron/renderer` and hands its events to the main
process through `@sentry/electron/preload`, so the renderer CSP allows no Sentry
origin. The replica and analytics workers are Effect RPC servers, so they take
`@sentry/effect`: its layer registers an Effect `ErrorReporter`, and every
failed RPC is reported at the RPC boundary. `electron/sentry-options.ts` gives
all of them the same DSN, release, and environment. `@sentry/effect` and
`@sentry/react` stay on the Sentry version `@sentry/electron` is built on, so
each process has one Sentry core.

## Development

From the repository root:

```sh
vp run dev
```

`vp run` starts the server and desktop workspace in parallel. The desktop workspace's plain
`vp dev` command serves the web app on `127.0.0.1:5174`, builds main and
preload, launches Electron, and reloads the relevant process when its source
changes. Env files in this directory apply to the desktop dev server and build.

To run only the desktop workspace against an already-running backend:

```sh
vp run @store/desktop#dev
```

For the browser host, see `apps/web/README.md`.

## Build

```sh
vp run build:desktop
```

The renderer is built from `apps/web` into `dist`, main, preload, and the
workers into `dist-electron`, and electron-builder packages both.

## Releases

Every push to `main` deploys production and then publishes a desktop release
through electron-builder to GitHub Releases. Installed apps update from the
`latest` feed.
