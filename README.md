# Store

This Bun-workspace monorepo contains an offline-first inventory stack: a TanStack web app, an
Electron desktop app, and a Cloudflare Worker API. Inventory written in the browser, on desktop,
or on mobile syncs through the same authenticated `/api/sync` protocol.

## Workspace boundaries

- `apps/web` is the React SPA. Alchemy deploys it with `Cloudflare.Website.Vite`
  so the production hostname serves the app and `/api/*` on the same origin.
  Locally `alchemy dev` listens on `:5174`; standalone `vp dev` proxies `/api`
  to `:8787`.
- `apps/desktop/src` contains the React renderer shared with the web app; `electron` contains the
  main process and preload. Desktop keeps hash routing and native libSQL.
- `apps/server/src` contains the Worker API and per-organization Durable Object sync service.
- `packages/contracts` owns shared store, server, and sync contracts.
- `packages/db` owns local, Durable Object, and authentication database schemas.
- `packages/persistence` owns local libSQL access, inventory stores, analytics, and sync. The
  browser replica lives at `@store/persistence/browser` (WASM/OPFS); Node/Electron uses the
  package root.
- `packages/workspace` owns the authenticated workspace runtime shared by desktop and web.
- `packages/sync-client` owns the framework-neutral Effect coordinator, retries,
  page draining, and sync status state machine used by local replica adapters.
- `packages/auth` owns Clerk JWT verification and the Clerk-to-store organization
  binding. Better Auth identity tables remain in `packages/db` so existing Durable
  Object names can be recovered by email.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains. Reusable test
fixtures and harnesses live under `test/lib`.

Desktop components are grouped by feature. `components/app` owns the application shell,
`components/shared` holds reusable application components, and `components/ui` remains the
registry-managed primitive layer.

Local business transactions commit an outbox operation alongside their data. A shared single-flight
sync runtime pushes those operations through the authenticated Worker and transactionally pulls the
organization's ordered change feed. Foreground clients poll HTTP on a short interval. Network
failures leave local writes pending in strict FIFO order.

## Run locally

```sh
vp install
vp run dev
```

That starts the Worker (`:8787`), the desktop Vite/Electron renderer (`:5173`), and the web
SPA (`:5174`, via `Cloudflare.Website.Vite` in `alchemy dev`). Sign in on either client;
writes sync through `/api/sync`.

Cloudflare infrastructure is declared with [Alchemy](https://alchemy.run) in `alchemy.run.ts` and
the `infra.ts` modules beside the code that owns each resource. There are two isolated cloud
stages, `dev` and `prod`:

```sh
bun run plan:dev      # preview
bun run deploy:dev
bun run deploy:prod
```

Copy `.env.example` to `.env.dev` and `.env.prod` (both gitignored) and give each stage its own
`CLERK_SECRET_KEY`. The Worker setup and stage details are documented in `apps/server/README.md`.
An authenticated user can continue using a previously opened organization offline; a first sign-in
and organization creation require the API.

GitHub Actions verifies every change, deploys each same-repository pull request to an isolated
`pr-<number>` stage, comments its Website URL on the pull request, removes that stage when the pull
request closes, and deploys `main` to `prod`. `alchemy deploy` builds the SPA — CI does not run a
separate Vite build. Bootstrap its least-privilege Cloudflare credentials
once:

```sh
bun alchemy login --profile admin
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:ci
```

The bootstrap stack creates the `Development` and `Production` GitHub environments and stores
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. Alchemy only binds
Worker `Config` keys that are present in the deploy job's environment, so GitHub must pass
every auth setting the Worker reads.

Each GitHub Environment must define:

- **Secret:** `CLERK_SECRET_KEY`. Use a different Clerk instance (or at least a
  different secret) per environment so a preview JWT is never valid against production.
- **Secret (optional):** `CLERK_JWT_KEY` — PEM JWKS for networkless JWT verify on the Worker.
- **Variables (optional, have code defaults):** `ELECTRON_PROTOCOL` (`com.tabaaq.desktop`),
  `MOBILE_PROTOCOL` (`com.tabaaq.mobile`), `AUTH_TRUSTED_ORIGINS` (comma-separated `https://`
  origins, bare hosts, or wildcard patterns), `CLERK_JWT_AUDIENCE`. Blank values are treated as
  unset, and a value none of those forms fit is ignored and logged rather than breaking sign-in.

The `Production` environment must also define these **variables**. There is no
domain baked into source; prod deploys fail if `PRODUCTION_DOMAIN` is missing.

- `PRODUCTION_DOMAIN` — site hostname only (example: `tabaaq.app`). Website Worker.
- `VITE_API_URL` — API origin (example: `https://api.tabaaq.app`). Desktop and the
  production SPA. If unset, the API hostname is `api.<PRODUCTION_DOMAIN>`.
- `AUTH_TRUSTED_ORIGINS` — site origin for CORS / Clerk azp (example: `https://tabaaq.app`)
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk Frontend API publishable key (web CSP derives the FAPI host from this)
- `VITE_CLERK_JWT_TEMPLATE` — optional Clerk JWT template name (must include `org_id`)
- `EXPO_PUBLIC_API_URL` — same origin as `VITE_API_URL`; read by the mobile app (EAS production profile uses the EAS `production` environment, not GitHub vars)
- `ELECTRON_PROTOCOL` = `com.tabaaq.desktop` (optional; same default as the Worker)

In the Clerk Dashboard, enable Organizations and allow these origins (Authorized
Parties / allowed origins): the **site** origin (`https://` + `PRODUCTION_DOMAIN`),
`com.tabaaq.desktop://app`, plus local `http://localhost:5173` and
`http://localhost:5174` for development. The Electron renderer origin is the
privileged custom scheme host `app`, matching T3 Code's `@clerk/electron` bridge.

The admin profile can mint API tokens and should only be used for this bootstrap stack.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged desktop app with
`vp run build`. Production deploys run `bun alchemy deploy`, which serves the SPA from
`PRODUCTION_DOMAIN` and the API from `api.<PRODUCTION_DOMAIN>`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
