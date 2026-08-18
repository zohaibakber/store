# Web app

Vite + TanStack Router SPA for Tabaaq, deployed with
[`Cloudflare.Website.Vite`](https://alchemy.run/cloudflare/frontend/vite-spa/).
This app owns the renderer. Electron loads the same routes (hash history +
`@clerk/electron`). The browser replica of `@store/persistence` and the
`/api/sync` protocol keep inventory in sync across web, desktop, and mobile.

## Local development

`vp run dev` from the repo root starts `alchemy dev`, which boots this SPA's
Vite server on `:5174` (HMR) and the API Worker on `:8787`. `/api/*` is handled
by `worker.ts` and forwarded to the API Worker over a service binding.

To run the SPA against an already-running API without Alchemy's Vite plugin:

```sh
cd apps/web && vp dev
```

That still listens on `:5174` and uses Vite's `/api` proxy to `:8787`.

## Production

`bun alchemy deploy` builds this Vite project and deploys it as a Cloudflare
Worker with static assets — there is no separate CI `vite build` step. Deep
links fall back to `index.html` (`notFoundHandling: "single-page-application"`).
The production site hostname comes from `PRODUCTION_DOMAIN`; the API lives on
`api.<PRODUCTION_DOMAIN>` (`VITE_API_URL`). Local `vp run dev` still proxies
`/api/*` to `:8787`. Production browsers call the API origin with Clerk Bearer
tokens (CORS allows the site origin via `AUTH_TRUSTED_ORIGINS`). The web CSP keeps
`https://*.clerk.accounts.dev` and adds the production Clerk Frontend API host
derived at build from `VITE_CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_FAPI_URL`).
