---
name: effect-efficiency
description: >
  Cuts Effect runtime, network, sync, and cold-start cost in this monorepo.
  Covers ManagedRuntime reuse, Semaphore/SubscriptionRef/Cache/Stream fiber
  choices, HttpApi vs raw fetch, sync coalesce and partial sync, and web
  boot that must not block #boot-shell on first catalog snapshot. Use when
  optimizing latency, bandwidth, concurrency, startup paint,
  catalog replica connect/upload, or when choosing Effect concurrency/caching APIs.
  For general Effect services, Schema, Schedule, and tests, use the effect
  skill instead.
---

# Effect efficiency

Cost and concurrency judgment for Effect work in this repo. API defaults live in
[`effect`](../effect/SKILL.md). This skill owns when work runs, how much it
fans out, and what blocks first paint.

Pin: `effect@4.0.0-rc.112`. Typed errors use `Schema.TaggedError`, not beta's
`Schema.TaggedErrorClass`.

## When to use

- Choosing ManagedRuntime, Semaphore, SubscriptionRef, Cache, Stream, or fork
  variants for load or latency.
- Wiring HttpApi / HttpClient vs raw `fetch`.
- Changing catalog replica connect/upload or inventory HTTP.
- Touching web/desktop bootstrap so the logo or shell paints sooner.

Skip this skill for Schema modeling, Layer shape, Schedule recipes, or vitest
setup. Use [`effect`](../effect/SKILL.md).

## Relation to the Effect skill

| Concern | Skill |
| --- | --- |
| What API / Schema / Layer shape | `effect` |
| How many fibers, when IO runs, what blocks UI | this skill |
| Cache TTL / RequestResolver recipes | `effect` references/CACHING |
| Whether Cache/Semaphore belong on the hot path | this skill + [WHEN.md](references/WHEN.md) |

## Cost model

1. One long-lived `ManagedRuntime` per process or app host. Reuse `run*`. Call
   `dispose()` on shutdown. Do not build a new runtime per request or per sync.
2. Shared `MemoMap` when composing large Layer graphs (OpenCode pattern). Avoid
   rebuilding the same Layer tree on every call.
3. Bound concurrency with `Semaphore` (or keyed mutex). Cap in-flight exchange,
   file locks, and token refresh. Do not invent sleep-based locks.
4. Publish latest state with `SubscriptionRef` when UI or fibers need change
   notifications. Prefer that over polling a `Ref`.
5. Keyed lookup with concurrent dedupe: `Cache.make` / `Cache.makeWith` built
   once in a Layer. Single value: `Effect.cached` / `cachedWithTTL`. Handles that
   need cleanup: `ScopedCache`.
6. Many values over time: `Stream` (+ `Queue` / `PubSub` at the producer edge).
   Fork the consumer with `Effect.forkScoped` inside the owning Layer scope.
7. Fire-and-forget bootstrap that must outlive the caller: `Effect.forkDetach`.
   Prefer `forkScoped` when the Layer or scope owns lifecycle.
8. Outbound typed HTTP in Effect domains: `HttpClient` + schema bodies, or
   `HttpApiClient` from a shared `HttpApi` contract. Raw `fetch` stays in thin
   session adapters only (`packages/auth`, `session-http`).

## Sync vs fibers

Live inventory: Postgres + catalog replica (IndexedDB HashMap) + in-process
TanStack DB. Hydrate is fire-and-forget; readiness is replica `status`.
Catalog uploads drain the IndexedDB outbox. See
[SYNC-NETWORK.md](references/SYNC-NETWORK.md).

Rules:

1. Do not await first snapshot. Overlap collection hydrate with pull.
2. Refresh auth before replica HTTP so pull does not start with an expired token.
3. Drain the outbox before multi-table HTTP commands.
4. On logout or org change, dispose the catalog runtime. Drop the cached replica.
5. Keep first snapshot off the critical path for first paint
   (next section).

## Batching and caching

- Batch catalog rows in one outbox command when they share an
  operation.
- Dedupe token refresh with `Cache` (capacity + `timeToLive: Duration.zero`
  for in-flight-only dedupe is an OpenCode pattern).
- Memoize layer-scoped resources; do not put per-call `Map` + TTL + in-flight
  Maps in domain code when `Cache` fits.

## Boundaries and IO

Incorrect: domain service calls raw `fetch` and parses JSON by hand while
`StoreApi` already exists as HttpApi.

Correct: server and clients share HttpApi schemas; client uses
`HttpApiClient.make`. Thin browser cookie/session adapters may keep `fetch`.

Incorrect: `await waitForFirstSync()` inside startup
before `mountApp` replaces `#boot-shell`.

Correct: mount UI first; open the catalog replica after paint; hydrate in
the background; skip forced cookie refresh when the
browser is unsigned.

## Store cold start

`#boot-shell` stays until `startWeb()` finishes. Keep that path to session
bootstrap only, then mount.

Do this instead:

1. Do not block `#boot-shell` / first paint on first snapshot or
   compatibility live WS.
2. Defer catalog replica hydrate past paint. Collections can preload from
   IndexedDB while snapshot/pull runs.
3. Skip forced `ensureFreshAccess(true)` when unsigned; fail fast offline.
4. Keep loaders tolerant of empty-until-live, or soft-block only route loaders
   that need rows.

Detail and ranked causes: [SYNC-NETWORK.md](references/SYNC-NETWORK.md).

## Do nots

- Do not create a `ManagedRuntime` per request, per sync tick, or per component
  mount.
- Do not block first paint on network sync or WebSocket handshake.
- Do not force cookie refresh on every cold start for unsigned browsers.
- Do not open a new live socket per exchange.
- Do not hand-roll Map/TTL/in-flight dedupe when `Cache` fits.
- Do not use `Ref` alone when subscribers need updates; use `SubscriptionRef`.
- Do not use ad-hoc locks or `Effect.sleep` for mutual exclusion; use
  `Semaphore`.
- Do not put raw `fetch` in Effect domain layers that already have HttpApi.
- Do not cargo-cult Zero's online-only writes. Catalog edits stay on the
  replica outbox.
- Do not treat anything other than Postgres as inventory truth.

- Do not write `Schema.TaggedErrorClass` on this pin; use `Schema.TaggedError`.
- Do not use Cluster/Entity until multi-node sharding is a real need.
- Do not fork long-lived work with the wrong fork: prefer `forkScoped` for
  Layer-owned fibers; `forkDetach` only when bootstrap must outlive the caller.

## Branch chooser

Read only what matches:

- API pick (runtime, semaphore, cache, stream, HTTP): [WHEN.md](references/WHEN.md)
- Sync protocol, Zero/replica lessons, cold-start rules: [SYNC-NETWORK.md](references/SYNC-NETWORK.md)
- What to copy from OpenCode / t3code / Maple: [OSS.md](references/OSS.md)
- General Effect defaults: [`effect`](../effect/SKILL.md)

## Quick checks

- [ ] One ManagedRuntime (or documented host runtime) reused; disposed on exit.
- [ ] Hot-path concurrency bounded by Semaphore; invalidations coalesced.
- [ ] Latest sync/auth UI state via SubscriptionRef or equivalent, not poll.
- [ ] HttpApiClient or HttpClient in Effect domains; fetch only at thin adapters.
- [ ] First paint not awaiting first catalog snapshot.
- [ ] Unsigned boot skips forced refresh.
- [ ] Errors are `Schema.TaggedError` on rc.110.
