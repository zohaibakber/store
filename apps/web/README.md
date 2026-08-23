# Web app

Vite + TanStack Router SPA for Tabaaq, deployed with
[`Cloudflare.Website.Vite`](https://alchemy.run/cloudflare/frontend/vite-spa/).
This app owns the renderer. Electron loads the same routes (hash history +
Electron preload bridge). TanStack DB supplies live queries and optimistic
mutations. Electric streams organization-scoped Postgres shapes into persisted
collections. Browsers persist those collections in WASQLite, while Electron
uses the TanStack SQLite persistence bridge in its main process.

The original Cloudflare Durable Object and `/api/sync/live` WebSocket engine is
preserved as production compatibility and migration source. Migrated web and
desktop inventory code does not use that engine. Do not delete the legacy
engine until an explicit retirement confirms that production no longer needs
it.

## Local development

`vp run dev:web` from the repo root starts `alchemy dev`, which boots this SPA's
Vite server on `:5174` (HMR) and the API Worker on `:8787`. `/api/*` is handled
by `worker.ts` and forwarded to the API Worker over a service binding.

To run the SPA against an already-running API without Alchemy's Vite plugin:

```sh
cd apps/web && vp dev
```

That still listens on `:5174` and uses Vite's `/api` proxy to `:8787`.

`vp run dev:desktop` starts this same Vite app in desktop mode and launches the
Electron shell from `apps/desktop`. Desktop mode swaps only the host entrypoint;
the routes and UI remain owned by this package.

## Production

`pnpm exec alchemy deploy` builds this Vite project and deploys it as a Cloudflare
Worker with static assets. There is no separate CI `vite build` step. Deep
links fall back to `index.html` (`notFoundHandling: "single-page-application"`).
The production site hostname comes from `PRODUCTION_DOMAIN`. The API lives on
`api.<PRODUCTION_DOMAIN>` (`VITE_API_URL`). Local `vp run dev` still proxies
`/api/*` to `:8787`. Auth lives at `auth.<PRODUCTION_DOMAIN>`
(`VITE_AUTH_URL`). Production browsers call the API with short-lived
first-party access tokens. CORS and OAuth redirects allow the site origin via
`AUTH_TRUSTED_ORIGINS`. The same access token authenticates `/api/inventory/*`
mutations and `/api/electric/*` shape requests.
