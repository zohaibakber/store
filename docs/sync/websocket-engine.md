# WebSocket sync engine

## Problem

Foreground clients treat `POST /api/sync` as both the transaction and the live
channel. They poll every few seconds. That was an emergency substitute after
PR #5 dropped the hibernated invalidation socket so a Better Auth Electron
plugin would stop throwing on Cloudflare's immutable `Request.headers`. Auth
is Clerk now. The poll is still the happy path.

The local replica, FIFO outbox, Durable Object inbox, changelog cursor, and
last-writer-wins `rowVersion` rules are the correctness model. They stay.
Transport is what changes.

Zero keeps a local store, pushes mutations, and pulls patches after a poke,
resuming by version. PowerSync splits a crash-safe upload queue from a
checkpointed download stream and will use HTTP when a socket cannot connect.
This app already has the Zero/PowerSync grain that matters: the whole
organization replica, an outbox, and an ordered log. It does not need
query-shaped CVRs. It needs the socket back, with those engines' network
habits, without pretending 3-second HTTP is live sync.

## Usage (caller's view)

Live hosts give the engine a way to open a socket. Persistence never sees frames.
Tests that only care about apply/LWW pass a fake `exchange` instead.

```ts
const store = await openStore({
  workspace: { organizationId, userId, deviceId },
  syncTransport: {
    openLive: openLiveSocket({
      baseUrl: apiOrigin,
      organizationId,
      deviceId,
      getAccessToken: () => auth.token,
      headers: nativeHeaders, // Electron: Authorization + electron-origin
    }),
  },
});
```

A local write still commits to SQLite and the outbox in one transaction, then
signals sync. The coordinator drains the outbox as a correlated `exchange` frame
on the live socket. If the socket is down, the exchange fails retryably and the
coordinator retries after reconnect. `hello` is the first pull. Inbox
idempotency makes a timeout-then-retry on the same socket safe.

## Shape

One hibernated WebSocket per device against `/api/sync/live`. Clerk finishes at
the Worker. The object receives `organizationId`, `userId`, `deviceId`, and
`authenticationExpiresAt` as a socket attachment. No JWT is stored in the
object.

Frames on the socket:

- Server `hello` / `invalidate` with `headCursor` (existing live events).
- Client `exchange` with `requestId` + protocol-v2 `SyncRequest`.
- Server `exchange-result` / `exchange-error` with that `requestId`.
- Client `ping` / server `pong` for application liveness. Cloudflare already
  answers protocol pings without waking the object, so these are sparse.

The coordinator in `@store/sync-client` still single-flights, drains
`hasMore`, and coalesces invalidations. `hello` always pulls. Reconnect is
jittered exponential backoff, capped at 30s. Safety poll stays as a backstop
and defaults to 5 minutes when a live socket is configured, 3 seconds when it
is not.

Outbox `attemptCount` counts poison operations, not dropped packets. Retryable
transport errors set `nextAttemptAt` and leave the attempt count alone.
Quarantine still stops the FIFO head after repeated non-retryable failures.

Token refresh reconnects through the Worker with a new Bearer or
`access_token`. The object cannot verify Clerk. An in-band auth frame would
leak that job into the wrong process.

## Synthesis decision

Base: bidirectional session (design A). Live hosts pass `openLive`. Tests that
do not open a socket pass `exchange`. Complexity lives in the session:
reconnect, correlation ids, hibernation.

Grafted from invalidate-and-pull (B): keep the Durable Object `exchange` as
the one transaction; keep `hello`/`invalidate`; Worker-terminates-auth;
identity headers into the object; browser cannot set WebSocket headers so the
upgrade accepts `access_token`.

Grafted from split planes (C): do not burn `attemptCount` on retryable
failures; treat a socket timeout as "retry the same operation", not "the
operation is bad".

Rejected query/shape subscriptions (D): every device already holds the
organization catalog. A CVR would add per-device server state without changing
what screens read.

Rejected restore-only invalidation as the end state: it leaves the data path
on a poll. The socket would be a wakeup pager. Fine as a subset, not as the
architecture we are moving to.

Arena runners were launched on four models with those assigned shapes. Their
write-ups did not land in time; the lead synthesis above is the contract.

## Tradeoffs accepted

- We accept a dead socket as a retryable transport error, not a second HTTP
  data path. Apply/LWW tests still inject a fake `exchange`.
- We accept whole-org changelog paging instead of Zero-style query shapes,
  because that is the product replica.
- We accept reconnect-for-token-refresh instead of refreshing Clerk inside the
  Durable Object.
- We accept a 5 minute safety poll while live, so a missed invalidate cannot
  freeze a replica forever.

## Alternatives considered

Invalidate-only WebSocket, HTTP for all bytes. Smallest diff, restores PR #5's
victim. Callers still wait on poll cadence whenever the wakeup is missed, and
"shift to WebSockets" would be a lie in the data path.

Split upload and download into two sockets. Matches PowerSync's planes, and
would let a large catch-up run while the outbox drains. Two hibernated
connections per device on a per-org Durable Object is more moving parts than
this replica size needs. Correlation on one socket is enough.

Named mutators and client rebase (Zero). Would replace the outbox payload of
row changes. Every inventory write path would grow a second implementation.
Not the transport change we were asked for.

## Open questions and risks

- Should Electron keep using the `ws` package for Authorization headers, or
  put the JWT in the query like the browser? Headers stay off the query log.
- How hard do corporate TLS middleboxes make WebSocket upgrade on desktop in
  practice? Live hosts no longer silently POST when upgrade fails.

## Next implementation step

Filled in against this contract: frames, Durable Object hibernation handlers,
socket-only live exchange, outbox attempt-count semantics, and web, desktop,
and mobile live openers.
