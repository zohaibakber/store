# Desktop app

Electron + React + TanStack Router client for Tabaaq. This workspace owns the
Electron main process, preload bridge, renderer, Vite configuration, tests, and
packaging.

The renderer runs in two hosts. Startup installs one `AppHost` (`src/host.ts`)
and renderer code reads auth, sign-in, invoice analysis, and the optional
desktop capabilities from it, never from `window` globals.

- Electron (`start-electron.tsx`) uses hash history. Auth, invoice analysis,
  native integrations, and authenticated sync HTTP go through preload IPC.
  Live inventory reads the local replica: a main-owned Node worker on
  `@effect/sql-sqlite-node` over `node:sqlite`, with no native addon to rebuild
  at packaging time.
- The browser (`start-web.tsx`, `src/web`) uses browser history and the
  IndexedDB replica from `@store/sync/browser`. `WebAuthBroker` keeps the access
  token in memory; the refresh token is the auth Worker's HttpOnly cookie. A
  localStorage hint records that this origin signed in, so a cold start without
  it skips the refresh. Google returns to `/sign-in?code=…`. Sync and uploads
  use the broker's authenticated fetch. New Sale is Alt+N, because browsers
  reserve Ctrl+N.

The preload bridge carries domain commands, bounded reads, and change notices.
Command state never crosses IPC as SQL, and the renderer cannot name a file
path or a table. Sales and catalog edits are the same two sync commands
(`issueInvoice`, `catalogWrite`): they commit locally, show as pending rows,
and settle when the authority's decision arrives through the pull.

## Insights

The Overview (`/`) and Restock (`/restock`) pages read one `InsightsReport`
from `@store/inventory-react`. It re-reads aggregated replica facts after
commits that touch stock or sales, settled so a sync burst costs one read.
Planning settings persist per device through `Atom.kvs` over `localStorage`.

Loading is Suspense-based. Routes read replica data with `useSuspense*`
hooks (TanStack DB `useLiveSuspenseQuery`) and insights with
`useAtomSuspense`, so first loads show the router's `PageSkeleton` or a
section skeleton, and failures reach the route `errorComponent`. After the
first load, background refreshes keep the current report and show a small
spinner instead of re-suspending.
The method is documented in `packages/services/src/insights/README.md`.

Low-end devices get a lite rendering path: `public/theme-init.js` marks
`data-performance="lite"` before first paint when memory or cores are scarce
or the user prefers reduced transparency, and `styles.css` drops backdrop
blur there. Sentry loads only when `VITE_SENTRY_DSN` is set.

## Development

From the repository root:

```sh
vp run dev
```

`vp run` starts the server and desktop workspace in parallel. The desktop workspace's plain
`vp dev` command starts Vite on `127.0.0.1:5174`, builds main and preload,
launches Electron, and reloads the relevant process when its source changes.

To run only the desktop workspace against an already-running backend:

```sh
vp run @store/desktop#dev
```

For the browser host, run `vp run dev:web` from the repository root, or
`vp run dev:web` here against a running backend. Open `http://localhost:5174`:
auth and the API trust `localhost`, not `127.0.0.1`. `VITE_API_URL` and
`VITE_AUTH_URL` default to `http://localhost:8787` and `http://localhost:8788`.

## Build

```sh
vp run build:desktop
```

The renderer, main process, and preload are built from this workspace before
electron-builder packages the application.

```sh
vp run build:web
```

`--mode web` builds only the renderer into `dist-web`, with a meta CSP whose
`connect-src` names the configured API and auth origins. Published stages
deploy it from `infra.ts` as a static SPA on `PRODUCTION_DOMAIN`.

## Releases

Every push to `main` deploys production and then publishes a desktop release
through electron-builder to GitHub Releases. Installed apps update from the
`latest` feed.
