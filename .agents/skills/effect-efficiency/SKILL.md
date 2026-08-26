---
name: effect-efficiency
description: >
  Cuts Effect runtime, network, sync, and cold-start cost in this monorepo.
  Covers ManagedRuntime reuse, Semaphore/SubscriptionRef/Cache/Stream fiber
  choices, HttpApi vs raw fetch, sync coalesce and partial sync, and web
  boot that must not block #boot-shell on store.sync or live WS. Use when
  optimizing latency, bandwidth, concurrency, startup paint, Offline sync,
  WebSocket exchange, or when choosing Effect concurrency/caching APIs.
  For general Effect services, Schema, Schedule, and tests, use the effect
  skill instead.
---

# Effect efficiency

Cost and concurrency judgment for Effect work in this repo. API defaults live in
[`effect`](../effect/SKILL.md). This skill owns when work runs, how much it
fans out, and what blocks first paint.

Pin: `effect@4.0.0-rc.110`. Typed errors use `Schema.TaggedError`, not beta's
`Schema.TaggedErrorClass`.

## When to use

- Choosing ManagedRuntime, Semaphore, SubscriptionRef, Cache, Stream, or fork
  variants for load or latency.
- Wiring HttpApi / HttpClient vs raw `fetch`.
- Changing sync-client, live WS, exchange, or offline outbox behavior.
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

Store sync today: local SQLite + outbox, exchange RPC (push ≤100 ops / pull
change-log), live path = contentless invalidate poke → coalesced re-exchange
under a semaphore. See [SYNC-NETWORK.md](references/SYNC-NETWORK.md).

Rules:

1. Coalesce invalidations (sliding queue size 1 is fine). Single-flight sync
   under `Semaphore`.
2. Refresh auth before opening or keeping the live socket. Avoid reconnect
   storms from URL-token-only expiry with no refresh path.
3. Prefer diffs or partial sync when org log size hurts. Do not adopt
   zero-cache / PowerSync stacks wholesale. Truth here is the org Durable
   Object + change log, with offline writes via outbox.
4. Cap exchange rounds (`hasMore`, max rounds). Yield under load.
5. Keep live WS and first `store.sync()` off the critical path for first paint
   (next section).

## Batching and caching

- Batch ops at the exchange boundary (store already caps). Do not open a socket
  per exchange.
- Dedupe token refresh with `Cache` (capacity + `timeToLive: Duration.zero`
  for in-flight-only dedupe is an OpenCode pattern).
- Memoize layer-scoped resources; do not put per-call `Map` + TTL + in-flight
  Maps in domain code when `Cache` fits.

## Boundaries and IO

Incorrect: domain service calls raw `fetch` and parses JSON by hand while
`StoreApi` already exists as HttpApi.

Correct: server and clients share HttpApi schemas; client uses
`HttpApiClient.make`. Thin browser cookie/session adapters may keep `fetch`.

Incorrect: `await store.sync()` and live WS open inside `#activate` before
`mountApp` replaces `#boot-shell`.

Correct: mount UI (or React shell) first; sync and live subscribe after paint;
skip forced cookie refresh when the browser is unsigned and has no session
cookie expectation.

## Store cold start

`#boot-shell` stays until `startElectron()` finishes. Keep that path to session
bootstrap only, then mount. PowerSync connect and first sync belong in the
inventory provider after paint.

Do this instead:

1. Do not block `#boot-shell` / first paint on `store.sync()` or live WS.
2. Defer first sync and live subscribe past paint (background fiber or post-mount
   attach of `syncTransport`).
3. Skip forced `ensureFreshAccess(true)` when unsigned; fail fast offline.
4. Keep loaders tolerant of empty-until-live, or soft-block only route loaders
   that need rows.

Detail and ranked causes: [SYNC-NETWORK.md](references/SYNC-NETWORK.md).

## Do nots

- Do not create a `ManagedRuntime` per request, per sync tick, or per component
  mount.
- Do not block first paint on network sync or WebSocket handshake.
- Do not force a session refresh on every cold start when unsigned.
- Do not open a new live socket per exchange.
- Do not hand-roll Map/TTL/in-flight dedupe when `Cache` fits.
- Do not use `Ref` alone when subscribers need updates; use `SubscriptionRef`.
- Do not use ad-hoc locks or `Effect.sleep` for mutual exclusion; use
  `Semaphore`.
- Do not put raw `fetch` in Effect domain layers that already have HttpApi.
- Do not cargo-cult Zero's online-only writes or PowerSync's upload-blocks-all-
  downloads gating; this product keeps offline outbox + quarantine.
- Do not pull in Postgres + zero-cache IVM; org DO is truth.
- Do not write `Schema.TaggedErrorClass` on this pin; use `Schema.TaggedError`.
- Do not use Cluster/Entity until multi-node sharding is a real need.
- Do not fork long-lived work with the wrong fork: prefer `forkScoped` for
  Layer-owned fibers; `forkDetach` only when bootstrap must outlive the caller.

## Branch chooser

Read only what matches:

- API pick (runtime, semaphore, cache, stream, HTTP): [WHEN.md](references/WHEN.md)
- Sync protocol, Zero/PowerSync lessons, cold-start rules: [SYNC-NETWORK.md](references/SYNC-NETWORK.md)
- What to copy from OpenCode / t3code / Maple: [OSS.md](references/OSS.md)
- General Effect defaults: [`effect`](../effect/SKILL.md)

## Quick checks

- [ ] One ManagedRuntime (or documented host runtime) reused; disposed on exit.
- [ ] Hot-path concurrency bounded by Semaphore; invalidations coalesced.
- [ ] Latest sync/auth UI state via SubscriptionRef or equivalent, not poll.
- [ ] HttpApiClient or HttpClient in Effect domains; fetch only at thin adapters.
- [ ] First paint not awaiting `store.sync()` or live WS.
- [ ] Unsigned boot skips forced refresh.
- [ ] Errors are `Schema.TaggedError` on rc.110.
