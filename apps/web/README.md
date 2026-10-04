# Web app

The Tabaaq product UI: React, TanStack Router, and the design system. It ships
two ways from one source tree and one `index.html`.

- In the browser it is the website. `start-web.tsx` uses browser history and
  mounts the app with no replica (`NO_REPLICA` in
  `src/lib/inventory/host-inventory.ts`): sign-in, organizations and settings
  work, and the shell shows "Inventory is in the desktop app" in place of every
  inventory screen. `WebAuthBroker` keeps the
  access token in memory; the refresh token is the auth Worker's HttpOnly
  cookie. A localStorage hint records that this origin signed in, so a cold
  start without it skips the refresh. Google returns to `/sign-in?code=…`. New
  Sale is Alt+N, because browsers reserve Ctrl+N.
- In Electron it is the renderer of `apps/desktop`. `start-electron.tsx` uses
  hash history and reaches auth, invoice analysis, native integrations, and the
  local replica through the preload bridges.

`src/main.tsx` picks the host at runtime: the Electron start when the preload
bridges are on `window`, the web start otherwise.

## Host contract

`src/host` defines what a host must provide. Startup installs one `AppHost`
(`src/host/index.ts`) and app code reads auth, sign-in, invoice analysis, and
the optional desktop capabilities from it, never from `window` globals.
`src/host/electron.ts` types the bridges the Electron preload exposes and
adapts them to `AppHost`. The other modules there are the payload schemas that
cross IPC.

Modules in `src/host` are leaves with relative imports only, so the Electron
main process and preload can import them. This package exports `./host/*` and
`./vite` (the shared Vite fragment in `vite.app.ts`) and nothing else. It never
imports from `apps/desktop`.

## Routes

`routes/__root.tsx` holds the providers and the access redirect. The signed-in
app lives under the pathless layout route `routes/_app.tsx`, which renders the
shell (`components/app/shell.tsx`); `routes/_app/$.tsx` keeps unknown URLs
inside it. `routes/sign-in.tsx` sits outside the layout and renders bare.

The two hosts split this differently, through `signedInApp` in `vite.app.ts`:

- The website passes `"deferred"`. The shell, and each route's loader together
  with its component, are separate chunks. When the session hint is present,
  `start-web.tsx` starts fetching the shell alongside the token refresh.
- The desktop passes `"eager"`. The shell and the loaders stay in the startup
  bundle, because the local workspace makes the shell the first screen.

Modules that route files use outside the loader and component (search schemas,
list definitions) must stay free of query code, or the website's sign-in screen
downloads it again.

## Insights

The Overview (`/`) and Restock (`/restock`) pages read one `InsightsReport`
from `@store/inventory-react`. It re-reads aggregated replica facts after
commits that touch stock or sales, settled so a sync burst costs one read.
Planning settings persist per device through `Atom.kvs` over `localStorage`.

Loading is Suspense-based. Routes read replica data and insights with `useSuspense*`
hooks over atoms (`useAtomSuspense`), so first loads show the router's `PageSkeleton` or a
section skeleton, and failures reach the route `errorComponent`. After the
first load, background refreshes keep the current report and show a small
spinner instead of re-suspending.
The method is documented in `packages/services/src/insights/README.md`.

Low-end devices get a lite rendering path: `public/theme-init.js` marks
`data-performance="lite"` before first paint when memory or cores are scarce
or the user prefers reduced transparency, and `styles.css` drops backdrop
blur there.

Sentry reports errors only, and only when `VITE_SENTRY_DSN` is set. The website
uses `@sentry/react` and sends straight to Sentry. Inside Electron the renderer
uses `@sentry/electron/renderer`, which hands events to the main process over
the preload bridge, so the desktop renderer needs no Sentry origin in its CSP.
`@sentry/react` stays on the Sentry version `@sentry/electron` is built on.

## Development

From the repository root, against the dev backend:

```sh
vp run dev:web
```

Or `vp run dev` here against an already-running backend. Open
`http://localhost:5174`: auth and the API trust `localhost`, not `127.0.0.1`.
`VITE_API_URL` and `VITE_AUTH_URL` default to `http://localhost:8787` and
`http://localhost:8788`. Env files for the website live in this directory;
`apps/desktop/.env*` applies to the desktop build only.

There are no unit tests here. The UI is tested end to end by hand. After
changing UI code, run `vp run lint:design` from the repository root.

## Build

```sh
vp run --filter @store/web build
```

Builds the SPA into `dist`, with a meta CSP whose `connect-src` names the
configured API and auth origins. Published stages deploy it from `infra.ts` as
a static site on `PRODUCTION_DOMAIN`.
