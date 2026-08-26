# Electron renderer

Vite + TanStack Router UI for the Tabaaq desktop app. Electron loads this
package with hash history and the preload bridge. It is not a public website.

TanStack DB supplies live queries and optimistic mutations. PowerSync streams
organization-scoped Postgres rows into durable SQLite-backed collections in the
renderer (`@powersync/web` + wa-sqlite).

The original Cloudflare Durable Object and `/api/sync/live` WebSocket engine is
preserved as production compatibility and migration source. Desktop inventory
code does not use that engine. Do not delete the legacy engine until an
explicit retirement confirms that production no longer needs it.

## Local development

From the repo root:

```sh
vp run dev:desktop
```

That starts the API Worker (`:8787`), auth Worker (`:8788`), this Vite renderer
on `:5174`, and the Electron shell. Desktop requires sign-in before inventory.

To run only the renderer HMR server against an already-running API:

```sh
cd apps/web && vp dev
```

## Production

`apps/desktop` builds this package into `apps/desktop/dist` and packages it
with Electron. Alchemy deploys the API and auth Workers only. There is no
Cloudflare Website / SPA hostname.
