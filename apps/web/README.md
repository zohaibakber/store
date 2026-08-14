# Web app

TanStack Router SPA for Tabaaq. It uses the same renderer as the desktop app, a
browser replica of `@store/persistence`, and the same `/api/sync` protocol, so
inventory created here shows up on desktop and mobile after sync.

## Local development

The API Worker must be running on `:8787` (`vp run dev` from the repo root, or
`apps/server`). Then:

```sh
cd apps/web && vp dev
```

Vite listens on `:5174` and proxies `/api` to the Worker so auth cookies stay
same-origin.

## Production

`alchemy deploy` attaches `apps/web/dist` to the API Worker. The app is served
from the Worker origin (`https://tabaaq.zohaibakber.com` in production); `/api/*`
still hits the Effect HTTP API.
