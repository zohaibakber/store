# Product UI

The Tabaaq product UI: React, TanStack Router, and the design system. It is the
renderer of `apps/desktop` and is not built or deployed on its own; there is no
website. `src/main.tsx` calls `start-electron.tsx`, which uses hash history and
reaches auth, invoice analysis, native integrations, and the local replica
through the preload bridges.

## Host contract

`src/host` defines what the desktop shell must provide. Startup installs one
`AppHost` (`src/host/index.ts`) and app code reads auth, sign-in, invoice
analysis, backup, publish, and the window controls from it, never from `window`
globals. Only the updater is optional: the preload exposes it in packaged
builds only.
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

`vite.app.ts` keeps the shell and the route loaders in the startup bundle,
because the local workspace makes the shell the first screen.

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

Sentry reports errors only, and only when `VITE_SENTRY_DSN` is set. The renderer
uses `@sentry/electron/renderer`, which hands events to the main process over
the preload bridge, so the renderer needs no Sentry origin in its CSP.
`@sentry/react` stays on the Sentry version `@sentry/electron` is built on.

## Development

Run the desktop app from the repository root with `vp run dev`, or
`vp run @store/desktop#dev` against an already-running backend. This package
has no dev server or build of its own; `apps/desktop/vite.config.ts` serves and
builds it through the shared fragment in `vite.app.ts`.

There are no unit tests here. The UI is tested end to end by hand. After
changing UI code, run `vp run lint:design` from the repository root.
