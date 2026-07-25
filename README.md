# Store Electron

This Bun-workspace monorepo contains an offline-first Electron app built with Better Auth,
Effect, Drizzle ORM, libSQL, and Cloudflare Workers.

## Workspace boundaries

- `apps/desktop/src` contains the React renderer; `electron` contains the main process and preload.
- `apps/server/src` contains the Worker API and per-organization Durable Object sync service.
- `packages/contracts` owns shared store, server, and sync contracts.
- `packages/db` owns local, Durable Object, and authentication database schemas.
- `packages/persistence` owns local libSQL access, inventory stores, analytics, and sync.
- `packages/auth` owns Better Auth configuration while its tables remain in `packages/db`.
- `packages/services` owns shared application services such as invoice extraction.

Tests live in a sibling `test` tree that mirrors each package's `src` domains. Reusable test
fixtures and harnesses live under `test/lib`.

Desktop components are grouped by feature. `components/app` owns the application shell,
`components/shared` holds reusable application components, and `components/ui` remains the
registry-managed primitive layer.

Local business transactions commit an outbox operation alongside their data. The sync engine
pushes those operations through the authenticated Worker and pulls the organization's ordered
change feed. Network failures leave local writes pending for retry.

## Run locally

```sh
vp install
vp run dev
```

The Worker setup and deployment commands are documented in `apps/server/README.md`.
An authenticated user can continue using a previously opened organization offline; a first sign-in
and organization creation require the API.

Run all workspace checks with `vp check` and `vp test`, or produce the packaged desktop app with
`vp run build`.

## Install

Download the latest desktop build from [Releases](https://github.com/zohaibakber/store/releases/latest).

Linux users can install the latest AppImage with:

```sh
curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
```
