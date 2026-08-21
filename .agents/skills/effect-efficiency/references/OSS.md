---
title: OSS patterns to copy
---

# OSS

Short citations. Pins differ from this repo (`effect@4.0.0-rc.110`). Copy
patterns, not beta type names. Use `Schema.TaggedError` here, not
`Schema.TaggedErrorClass`.

## anomalyco/opencode (`effect@4.0.0-beta.83`)

Copy:

- One app `ManagedRuntime.make(AppLayer, { memoMap })`; shared
  `Layer.makeMemoMapUnsafe()` for large graphs.
- Lazy facade runtime with Observability merge only where isolation is
  required; prefer one app runtime.
- HttpClient pipe: `retryTransient` → `filterStatusOk` →
  `schemaBodyJson`.
- Token refresh dedupe via `Cache.make` with `timeToLive: Duration.zero`
  (in-flight only).
- Keyed mutex: map of `Semaphore` per path.
- Bootstrap `init()` via `Effect.forkDetach`; do not fork inside state
  `make` that should stay sync.
- Location layers: `Layer.fresh` + `ScopedCache` idle TTL.
- Eager auth refresh before expiry (minutes ahead).
- SSE out: `Stream` + heartbeat tick + bounded capacity.

Skip:

- Service-local runtimes as the default (they are migrating away).
- `Schema.TaggedErrorClass` (beta name).
- LayerNode DAG compiler unless this repo needs compile-time Layer graphs.

Paths (upstream): `packages/core/src/effect/runtime.ts`,
`packages/opencode/src/effect/app-runtime.ts`,
`packages/opencode/src/account/account.ts`,
`packages/core/src/effect/keyed-mutex.ts`,
`packages/opencode/src/project/bootstrap.ts`.

## pingdotgg/t3code (`effect@4.0.0-beta.103`)

Copy:

- Contracts package = Schema (+ HttpApi groups) only; no business logic.
- `HttpApi.make(...).add(groups)` shared; client
  `HttpApiClient.make(..., { baseUrl })` over FetchHttpClient.
- `Context.Service` + colocated `make` / `layer`; `Effect.fn` on methods.
- `SubscriptionRef` registry for connection/onboarding state.
- Pin every `@effect/*` sibling to the same line; mixed betas break at
  runtime.
- Prefer Effect `Clock` / `DateTime` for sync timestamps.

Skip:

- Treating WS + Schema contracts as a reason to avoid HttpApi here. Store
  server already ships HttpApi (`apps/server` `StoreApi`).
- Event-sourcing projector shape unless inventory gains that model.

Paths (upstream): `packages/contracts`,
`packages/client-runtime/src/rpc/http.ts`,
`packages/client-runtime/src/connection/onboarding.ts`,
`packages/client-runtime/src/authorization/service.ts`.

## MapleTechLabs/maple (`effect@4.0.0-rc.108`)

Copy:

- RC-family catalog pin across `effect` + `@effect/*` (closest to this
  repo).
- `packages/domain` shared Http contracts; `apps/api` Effect HTTP API.
- Multi-worker monorepo with sync-shaped ops beside the Effect API, not
  inside Cluster.

Skip:

- Assuming Electric/sync extras are required; only the contract split and
  pin discipline matter for store.

## This repo (already aligned)

- HttpApi server: `apps/server/src/http/api.ts`.
- ManagedRuntime hosts: `apps/server/src/sync/runtime.ts`,
  `apps/desktop/electron/main.ts`, `apps/web/src/host.ts`.
- SubscriptionRef + Semaphore + Stream: `packages/sync-client/src/runtime.ts`.
- Named `Context.Service` classes (`AuthClient`, `OfflineStore`); follow
  local style over OpenCode `export * as Foo` self-exports.
- Thin raw `fetch` in `packages/auth` / `session-http` only.
