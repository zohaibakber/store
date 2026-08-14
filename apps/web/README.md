# Web app

React SPA for Tabaaq, deployed with [`Cloudflare.Website.Vite`](https://alchemy.run/cloudflare/frontend/vite-spa/).
It uses the same renderer as the desktop app, a browser replica of
`@store/persistence`, and the same `/api/sync` protocol, so inventory created
here shows up on desktop and mobile after sync.

## Local development

`vp run dev` from the repo root starts `alchemy dev`, which boots this SPA's
Vite server on `:5174` (HMR) and the API Worker on `:8787`. `/api/*` is handled
by `worker.ts` and forwarded to the API Worker over a service binding, so auth
cookies stay same-origin.

To run the SPA against an already-running API without Alchemy's Vite plugin:

```sh
cd apps/web && vp dev
```

That still listens on `:5174` and uses Vite's `/api` proxy to `:8787`.

## Production

`bun alchemy deploy` builds this Vite project and deploys it as a Cloudflare
Worker with static assets — there is no separate CI `vite build` step. Deep
links fall back to `index.html` (`notFoundHandling: "single-page-application"`).
The production hostname is `https://tabaaq.zohaibakber.com`; `/api/*` is
proxied to the API Worker so browser sessions stay same-origin.
