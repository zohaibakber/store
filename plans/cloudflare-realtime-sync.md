# Cloudflare-native real-time sync implementation plan

Status: proposed  
Scope: Electron desktop, Expo mobile, Cloudflare Worker, per-organization SQLite Durable Objects  
Out of scope: native Android/Kotlin application, PowerSync, ElectricSQL, Postgres, moving authoritative sync state to D1

## Outcome

Build a local-first sync system in which an authenticated user with the same organization open on desktop and Expo sees committed changes on the other foregrounded client nearly instantly.

The Durable Object remains authoritative. A hibernatable WebSocket carries only an invalidation containing the newest available cursor. The receiving client then uses the existing authenticated HTTP exchange to download and transactionally apply authoritative data. WebSocket delivery is therefore an acceleration mechanism, not part of the correctness model.

Foreground performance target:

- p50 server-commit-to-visible-update below 750 ms under ordinary network conditions.
- p95 server-commit-to-visible-update below 2 seconds.
- A missed, duplicated, delayed, or reordered WebSocket message cannot lose or corrupt data.
- Reconnecting a foreground client immediately performs a pull before reporting `live`.

Mobile operating systems suspend network activity after an app is backgrounded. “Instant” is guaranteed while the Expo app is foregrounded and connected. A suspended app must catch up immediately on resume; push notifications can later improve awareness but cannot provide a hard background real-time guarantee.

## Architectural decisions

### 1. Keep the authoritative data plane in Durable Objects

Each organization continues to map to one `OrganizationStore` Durable Object using `organizationId` as its stable name. The object owns:

- Inventory tables.
- Mutation validation and reconciliation.
- Idempotency inbox.
- Ordered change log.
- Device acknowledgement/checkpoint state.
- Conflict records.
- Compaction watermark.
- WebSocket connections for that organization.

All correctness-critical records must commit in the same Durable Object SQLite transaction. Do not copy any of them to D1 as part of the critical write path.

### 2. Keep D1 as the global control plane only

The existing D1 database continues to own Better Auth users, sessions, organizations, and memberships. Do not add sync cursors, device acknowledgement positions, authoritative conflicts, or inventory to D1.

An optional, disposable organization-health projection may be added to D1 later if a cross-organization support dashboard becomes a real requirement. Such a projection must be asynchronous, rebuildable, and never read by sync correctness logic.

### 3. WebSockets signal; HTTP synchronizes

The WebSocket never carries entity rows or mutation acknowledgements. It carries a small versioned envelope such as:

```json
{ "type": "invalidate", "protocolVersion": 2, "headCursor": 1842 }
```

On receipt, the client compares `headCursor` with its local applied cursor and signals its single-flight sync loop. The loop continues exchanging pages until `hasMore` is false and the local outbox has no immediately sendable work.

This preserves HTTP retry, authentication, transaction, pagination, and schema-validation behavior if the socket disconnects.

### 4. Share synchronization behavior between Electron and Expo

Create a framework-neutral TypeScript module at `packages/sync-client`. It owns coordination, retry, state transitions, WebSocket lifecycle, response validation, page draining, and health reporting.

The module has two local database adapters:

- Electron/libSQL adapter implemented by `packages/persistence`.
- Expo/`expo-sqlite` adapter implemented by `apps/mobile`.

The module also has production HTTP/WebSocket transport adapters and in-memory adapters for deterministic tests. These are real seams because behavior varies in production and tests, and local persistence varies between Electron and Expo.

### 5. Preserve domain operations instead of treating all rows as last-write-wins

- Stock movements remain immutable, append-only cumulative operations.
- Batch quantities remain server-derived projections from stock movements.
- Invoice, invoice item, and stock movement creation commits atomically.
- Mutable catalog rows use an explicit base version and a documented conflict policy.
- Deletes have one explicit rule; an ordinary stale upsert must not silently resurrect a deleted row.

## Target topology

```text
Electron renderer
      │ IPC
Electron main process ── libSQL adapter ─┐
                                         │
                                         ├── shared SyncRuntime
                                         │      ├── HTTP exchange
Expo UI ── expo-sqlite adapter ──────────┘      └── WebSocket invalidation
                                                       │
                                                       ▼
                                             Authenticated API Worker
                                                       │
                                ┌──────────────────────┴──────────────────────┐
                                │                                             │
                         Better Auth D1                         Organization Durable Object
                    users/sessions/memberships              inventory/inbox/log/devices/conflicts
                                                                       │
                                                            hibernatable WebSockets
```

## Correctness invariants

Implementation and tests must enforce all of these:

1. A local business mutation and its outbox operation commit in one local SQLite transaction.
2. Server entity changes, inbox receipt, canonical reconciliation changes, and change-log entries commit in one Durable Object SQLite transaction.
3. Applying remote rows, acknowledging submitted operations, and advancing the local cursor commit in one local SQLite transaction.
4. A client never sends sequence `N + 1` while sequence `N` is delayed, quarantined, or unresolved.
5. Operation identity is stable and retries are idempotent.
6. A cursor advances only across changes that the client has validated and durably applied.
7. Every local database is scoped to exactly one organization; changing organization opens a different database.
8. The authenticated server context, not a client claim, determines organization and actor identity.
9. Receiving no WebSocket events is safe because reconnect, foreground, mutation, and fallback polling all trigger HTTP convergence.
10. Receiving duplicate invalidations is safe and coalesces into at most one active sync plus one pending rerun.
11. Server commit is the only point after which an invalidation may be broadcast.
12. When the client reports `idle/live`, its applied cursor is at least the last head cursor it observed.

## Shared module design

### External interface

Keep the interface small so UI and repositories do not learn protocol details:

```ts
export interface SyncRuntime {
  readonly start: () => Promise<void>;
  readonly requestSync: (reason: SyncReason) => Promise<SyncStatus>;
  readonly signalLocalCommit: () => void;
  readonly subscribe: (listener: (status: SyncStatus) => void) => () => void;
  readonly dispose: () => Promise<void>;
}
```

`start()` performs a pull before declaring the runtime live, then establishes the socket. `requestSync()` is single-flight. `signalLocalCommit()` is non-blocking and coalescing. UI code observes status but never invokes transport or database methods directly.

### Internal local-replica seam

```ts
interface LocalReplica {
  loadCheckpoint(): Promise<LocalCheckpoint>;
  selectUploadBatch(limits: UploadLimits): Promise<UploadBatch>;
  markAttempt(operationIds: readonly string[], attemptedAt: number): Promise<void>;
  applyExchange(input: ApplyExchangeInput): Promise<ApplyExchangeResult>;
  recordFailure(input: SyncFailure): Promise<void>;
  health(): Promise<OutboxHealth>;
}
```

`applyExchange` is deliberately deep: it validates ordering supplied by the coordinator, applies all canonical changes, acknowledges operations, and advances the cursor in one adapter transaction.

### Internal remote transport seam

```ts
interface SyncTransport {
  exchange(request: SyncRequest, signal: AbortSignal): Promise<SyncResponse>;
  connectLive(input: LiveConnectionInput): LiveConnection;
}
```

Production uses authenticated HTTP and WebSocket adapters. Tests use an in-memory adapter capable of dropping, duplicating, delaying, and reordering invalidations.

## Protocol version 2

### HTTP exchange

Retain `POST /api/sync` and evolve the schema compatibly. Add:

- `protocolVersion` to request and response.
- `headCursor`: newest committed cursor at response construction.
- `nextCursor`: last cursor included in this page.
- `hasMore`: whether more entries follow `nextCursor`.
- Stable structured error codes distinguishing transient transport, permanent operation, authentication, stale-bootstrap, and conflict failures.
- Response byte limits in addition to row-count limits.

Continue accepting version 1 desktop clients during rollout. Do not remove the old fields until the minimum supported desktop version is above the migration release.

### Live WebSocket

Add `GET /api/sync/live?organizationId=<id>&deviceId=<id>` with an HTTP Upgrade request.

Worker responsibilities:

1. Authenticate the Better Auth cookie or bearer token.
2. Validate current membership in the requested organization.
3. Validate identifier lengths and Upgrade headers.
4. Route to `ORGANIZATION_STORE.getByName(organizationId)`.
5. Pass trusted actor/member/device metadata to the Durable Object; never trust an actor ID from the socket query.

Durable Object responsibilities:

1. Create a `WebSocketPair` and call `ctx.acceptWebSocket(server)` so the connection can hibernate.
2. Store a small serialized attachment containing organization, user, device, connection ID, protocol version, and authentication expiry.
3. Immediately send `hello { protocolVersion, headCursor }` after acceptance.
4. After an inventory transaction commits, enumerate accepted sockets and send one `invalidate { headCursor }` message.
5. Remove or close failed and expired sockets defensively.
6. Implement `webSocketMessage`, `webSocketClose`, and `webSocketError` without relying on process memory surviving hibernation.

Do not broadcast before `runSync` returns from its database transaction. Change the server result internally to include `{ response, didCommitChanges, headCursor }`, then broadcast from `OrganizationStore` after success.

### Client socket behavior

The shared runtime must:

- Connect only after the initial HTTP pull succeeds or reaches a recoverable offline state.
- On `hello` or `invalidate`, compare the remote head with the local cursor and signal sync.
- Use exponential reconnect with full jitter and a cap.
- Perform an HTTP pull after every successful reconnect, even if the first socket message reports an equal cursor.
- Stop and recreate the connection when organization, account, or device changes.
- Treat malformed messages as protocol errors and reconnect rather than applying anything.
- Maintain a low-frequency foreground fallback pull so a silently broken socket still converges.
- Avoid application `setInterval` heartbeats unless production evidence shows they are necessary; Cloudflare automatically handles WebSocket protocol ping/pong without waking a hibernated object.

## Expo implementation

The current `apps/mobile` directory contains generated Expo metadata but no committed application scaffold. Establish it as the only mobile application.

### Application foundation

- Create a supported Expo Router application under `apps/mobile`.
- Commit source, configuration, package manifest, and tests.
- Ignore `.expo`, local devices, generated router types, build output, and Turbo logs.
- Use `expo-secure-store` for bearer/session secrets.
- Use `expo-sqlite` for the local replica and `withExclusiveTransactionAsync` for sync application transactions where execution order matters.
- Use one deterministic database filename per authenticated organization.
- Close the previous database and dispose the previous runtime before publishing a new active organization.

### App lifecycle

- Foreground/active: connect WebSocket and run an immediate pull.
- Network regained: reconnect and run an immediate pull.
- Background/inactive: close or allow suspension; do not claim the app remains live.
- Resume: run a pull before showing `live` status.
- Local mutation: commit data and outbox atomically, update UI from SQLite immediately, and signal upload.
- Remote mutation: invalidation signals a pull; applying the response updates watched queries and UI.

### React integration

Provide one `SyncProvider` that owns runtime lifetime for the active authenticated workspace. Feature screens consume local repositories and a small sync-status hook. They must never merge remote payloads into React state themselves.

Required status states:

- `starting`
- `offline`
- `connecting`
- `live`
- `syncing`
- `blocked`
- `error`

Display pending operation count and oldest pending age. A permanent blocked mutation needs a visible recovery path rather than infinite retry.

## Electron implementation

- Keep the authoritative local database and runtime in the Electron main process.
- Extend the workspace target with the shared transport rather than creating WebSockets in the renderer.
- Publish sync status and local data changes through the existing IPC seam.
- Replace the five-minute-only remote polling behavior with socket invalidation plus a lower-frequency safety poll.
- Keep startup behavior: complete the first pull before publishing a newly authenticated workspace to route loaders.
- Dispose the socket, subscriptions, and database runtime in a defined order during sign-out, organization switch, and application shutdown.

## Server storage and lifecycle

### Device checkpoint table

Add a Durable Object table keyed by device ID with:

- `deviceId`
- `userId`
- `protocolVersion`
- `lastAppliedCursor`
- `lastSeenAt`
- `clientPlatform`
- `clientVersion`
- `requiresBootstrap`

Update it from authenticated sync requests. It supports diagnostics and safe compaction; the client-provided cursor is validated against the request and never grants access.

### Initial bootstrap

The current change log should not be replayed forever for a fresh installation. Add a bootstrap path after real-time propagation is stable:

1. Read a consistent snapshot of current organization tables from the Durable Object.
2. Return the snapshot with its exact head cursor, table counts, and checksum manifest.
3. Import into an empty local organization database in one transaction.
4. Begin incremental exchange from that cursor.

Start with direct compressed HTTP snapshots. Introduce R2 caching only after measured snapshot size or repeated downloads justify the added invalidation and lifecycle complexity.

### Change-log compaction

- Track a retained lower-bound cursor.
- Retain enough history for normally returning devices.
- Use a Durable Object alarm for idempotent cleanup.
- Compact or delete entries older than the retention window and safely below active device checkpoints.
- If a client cursor precedes the lower bound, return `BOOTSTRAP_REQUIRED` instead of an incomplete incremental response.
- Prune old inbox receipts only after the chosen operation retry/idempotency window.
- Store the next client sequence separately so acknowledged local outbox rows can be deleted without sequence reuse.

## Conflict policy

### Mutable catalog entities

Add `baseVersion` to update/delete changes. The server compares it to the current row version inside the organization transaction.

- If equal, apply and increment server version.
- If stale and fields are independently mergeable, apply an explicit field-aware merge.
- If stale and unsafe to merge, store both versions in a Durable Object conflict table, acknowledge according to the chosen queue policy, and sync the conflict record to the originating client.
- Do not derive ordering from client wall-clock timestamps.

### Inventory and invoices

- Inventory totals change only through immutable stock movements.
- Reusing a stock-movement ID with different content remains a permanent protocol error.
- Invoice creation, items, movements, and affected batch reconciliation remain one operation/transaction.
- Finalized invoices are immutable; corrections use explicit compensating records.
- Define whether product/category deletion is delete-wins. Enforce it consistently on server and clients.

## Failure handling

### Transient failures

Retry with exponential backoff and jitter:

- Offline/DNS/connectivity failure.
- Timeout.
- HTTP 408, 429, and 5xx.
- WebSocket close/error.
- Durable Object overload response.

Do not increment permanent quarantine counters for simple socket disconnects; only failed HTTP upload attempts affect operation health.

### Permanent failures

Classify and expose:

- Invalid schema or unsupported protocol.
- Authorization/membership loss.
- Unique or foreign-key conflict.
- Reused operation or sequence with different content.
- Stale non-mergeable mutation.
- Client cursor below retention watermark.

A permanent failure must not silently block all later work forever. Preserve ordering where dependencies require it, record a diagnosable conflict/dead-letter entry in the organization DO, and expose a user or operator recovery action.

## Observability

Emit structured Worker and Durable Object logs with:

- Organization hash/opaque identifier, never organization name.
- Device ID.
- Protocol and client version.
- Request operation/change counts and response counts/bytes.
- Starting, next, and head cursor.
- Transaction duration.
- Commit-to-broadcast duration.
- Client-reported notification-to-applied duration.
- Retry classification and attempt.
- Connected socket count.
- Bootstrap and compaction events.

Add metrics for:

- Foreground commit-to-visible p50/p95/p99.
- WebSocket connection/reconnection rate.
- Invalidation-to-pull latency.
- Pending and quarantined operations.
- Change-log length and oldest retained cursor.
- Active/stale devices.
- Bootstrap frequency and size.
- Protocol error counts by stable code.

Use Workers/Durable Object observability first. Add Analytics Engine only if log-derived metrics are insufficient. Do not add a D1 metrics projection to the first implementation.

## Security requirements

- Authenticate HTTP and WebSocket upgrade requests through the same Better Auth trust model.
- Resolve organization membership on the Worker before routing.
- Scope every local database to one organization.
- Validate all server responses against shared Effect schemas before local application.
- Limit request, operation, change, identifier, and WebSocket message sizes.
- Rate-limit reconnect and malformed-message abuse per user/device.
- Never put bearer tokens in WebSocket query strings or logs.
- WebSocket messages contain cursors only, not inventory data.
- Reauthorize by reconnecting before credential expiry; membership removal must prevent subsequent HTTP pulls even if an old socket briefly remains connected.

## File-by-file implementation map

### Shared contracts

- `packages/contracts/src/sync/schema.ts`: protocol v2 request/response fields and structured error schemas.
- `packages/contracts/src/sync/live.ts`: `hello`, `invalidate`, and connection envelope schemas.
- `packages/contracts/src/sync/entity-semantics.ts`: dependency order and explicit conflict metadata.
- `packages/contracts/test/sync/*`: compatibility, malformed-event, ordering, and golden payload tests.

### Shared client module

- `packages/sync-client/package.json`: framework-neutral workspace package.
- `packages/sync-client/src/runtime.ts`: single-flight coordinator and state machine.
- `packages/sync-client/src/retry.ts`: retry policy and jitter.
- `packages/sync-client/src/live.ts`: WebSocket connection lifecycle.
- `packages/sync-client/src/model.ts`: internal interfaces and status types.
- `packages/sync-client/test/*`: in-memory adapter, fake clock, dropped-message, reconnect, and convergence tests.

### Cloudflare server

- `apps/server/src/routes/sync.ts`: authenticated WebSocket Upgrade route and protocol v2 HTTP decoding.
- `apps/server/src/sync/organization-store.ts`: hibernatable WebSocket acceptance, attachments, event handlers, and post-commit broadcast.
- `apps/server/src/sync/runtime.ts`: return internal commit metadata needed for broadcast.
- `apps/server/src/sync/database.ts`: head cursor, device checkpoint, bootstrap, compaction watermark, and page byte limits.
- `apps/server/src/sync/operation.ts`: base-version/conflict behavior and atomic canonical log writes.
- `apps/server/src/sync/errors.ts`: stable transient/permanent error taxonomy.
- `packages/db/src/do/sync.schema.ts`: device, conflict, retention, and snapshot metadata.
- `apps/server/infra.ts`: preserve organization DO binding and verify compatibility flags required by current hibernation behavior.

### Electron

- `packages/persistence/src/sync/engine.ts`: delegate coordination to shared runtime.
- `packages/persistence/src/sync/outbox.ts`: strict FIFO, pruning, and adapter operations.
- `apps/desktop/electron/workspace.ts`: authenticated WebSocket transport and lifecycle.
- `apps/desktop/electron/main.ts`: runtime disposal and status IPC.

### Expo

- `apps/mobile/package.json` and Expo configuration: establish the real mobile workspace.
- `apps/mobile/src/sync/*`: Expo SQLite adapter, transport adapter, provider, and lifecycle integration.
- `apps/mobile/src/database/*`: organization-scoped schema, migrations, repositories, and watched queries.
- `apps/mobile/src/auth/*`: secure token storage and authenticated workspace selection.
- `apps/mobile/test/*`: adapter transaction, organization isolation, lifecycle, and UI propagation tests.

### Documentation

- Update `README.md` to describe Electron + Expo and the real-time invalidation model.
- Update `apps/server/README.md` with WebSocket routing, hibernation, bootstrap, and compaction operations.
- Remove remaining native Android/Kotlin documentation and CI references.

## Phased delivery

### Phase 0 — Mobile cleanup and baseline

- [x] Remove `apps/android`; it is recoverable from the local desktop trash until emptied.
- [ ] Remove stale Android references from documentation, CI, and scripts if repository search finds any.
- [ ] Establish a committed Expo application instead of generated `.expo` metadata only.
- [ ] Record baseline sync latency, initial-sync duration, response size, and change-log growth.
- [ ] Preserve version 1 protocol fixtures before modifying contracts.

Exit criterion: Electron tests remain green, Expo builds a minimal authenticated shell, and there is no native Android build path.

### Phase 1 — Correctness before real-time

- [x] Add strict FIFO outbox selection.
- [x] Add acknowledged outbox pruning with a separate durable sequence counter.
- [x] Add page draining and response byte limits.
- [x] Define and test atomic local `applyExchange` behavior.
- [x] Add server device checkpoints and stable error codes.
- [ ] Add organization-isolated Expo databases from the first mobile schema.
- [ ] Add a two-client convergence harness using in-memory transports.

Exit criterion: crash/retry tests prove no lost acknowledgement, cursor, or operation; 100 randomized two-client mutation histories converge.

### Phase 2 — Shared runtime

- [x] Create `packages/sync-client` and its interfaces.
- [x] Move scheduling, status, retry, and drain behavior behind the module.
- [x] Adapt Electron without changing feature repositories or UI behavior.
- [ ] Implement the Expo SQLite adapter and local repositories.
- [ ] Replace overlapping engine tests with interface-level runtime tests while retaining adapter-specific transaction tests.

Exit criterion: the same runtime test suite passes against in-memory, Electron/libSQL, and Expo SQLite adapters where platform execution permits.

### Phase 3 — Live Durable Object invalidation

- [x] Add authenticated Upgrade route.
- [x] Add hibernatable WebSockets to `OrganizationStore`.
- [x] Broadcast only after successful commit.
- [x] Add shared client WebSocket lifecycle and reconnect pull.
- [x] Integrate Electron foreground live sync.
- [ ] Integrate Expo foreground live sync and AppState/network triggers.
- [x] Keep safety polling behind the same coalescing signal.

Exit criterion: a desktop mutation becomes visible in foreground Expo and an Expo mutation becomes visible in desktop under the p95 target; dropped invalidations still converge through reconnect or fallback polling.

### Phase 4 — Conflict semantics

- [ ] Add base versions and server-side stale detection.
- [ ] Finalize delete/resurrection policy.
- [ ] Add conflict storage and recovery status.
- [ ] Preserve append-only inventory and atomic invoices.
- [ ] Add simultaneous edit/delete/sale scenarios to convergence tests.

Exit criterion: every entity has a documented concurrent-write rule and no test relies on accidental server-arrival whole-row last-write-wins.

### Phase 5 — Bootstrap and retention

- [ ] Add consistent snapshot bootstrap.
- [ ] Add checksum/count verification.
- [ ] Add retention watermark and `BOOTSTRAP_REQUIRED` response.
- [ ] Add idempotent compaction alarm.
- [ ] Test a device returning before and after retention expiry.
- [ ] Measure whether R2 snapshot caching is justified; do not add it speculatively.

Exit criterion: a fresh client syncs current state without replaying unbounded history, and the server log remains bounded under a long-running workload.

### Phase 6 — Production rollout

- [ ] Deploy backward-compatible server first.
- [ ] Canary live sync in internal/dev organizations.
- [ ] Release desktop with socket feature enabled and HTTP fallback intact.
- [ ] Release Expo to internal testing, then staged production rollout.
- [ ] Monitor latency, reconnect, error, queue, and compaction metrics.
- [ ] Raise rollout only when correctness and p95 targets hold.
- [ ] Remove protocol version 1 after the supported-client window.

Exit criterion: at least one full release window without convergence incidents, unexplained blocked queues, cross-organization access, or latency regression.

## Test plan

### Contract tests

- Version 1 and version 2 decode/encode compatibility.
- Unknown event and malformed cursor rejection.
- Strictly increasing cursor enforcement.
- Every submitted operation acknowledged exactly once in a successful response.
- Organization and entity identity validation.

### Runtime tests

- Invalidation arrives during an active sync.
- Ten invalidations coalesce without losing the newest head.
- Invalidation is dropped.
- Invalidation is duplicated or reordered.
- Socket closes before/after server commit.
- HTTP response succeeds but local process crashes before apply.
- Local apply commits but process crashes before status publication.
- Authentication expires while socket is open.
- Organization switches during reconnect.
- Head operation is delayed or permanently blocked.

### Durable Object tests

- Two clients connect to the same organization and receive post-commit invalidation.
- A different organization receives nothing.
- Failed/rolled-back transactions broadcast nothing.
- WebSockets survive forced Durable Object eviction/hibernation.
- Serialized attachments restore sufficient identity after wake.
- Malformed messages and oversize connections close safely.
- Alarm compaction is idempotent.

### End-to-end tests

- Desktop create/edit/delete appears on foreground Expo.
- Expo create/edit/delete appears on desktop.
- Concurrent offline product edits follow the declared policy.
- Two offline sales both affect final inventory exactly once.
- Invoice and batch projection converge on both clients.
- Mobile background/resume catches up before reporting live.
- User removed from an organization cannot reconnect or pull.
- Switching organizations never shows the previous local replica.

### Performance tests

- Commit-to-visible latency at p50/p95/p99.
- Reconnect-to-caught-up latency.
- Initial snapshot import at representative small, median, and large stores.
- 1,000 queued local operations.
- 50,000 incremental change entries before compaction.
- Broadcast with the expected maximum concurrent devices per organization.

## Release acceptance criteria

The implementation is complete only when:

- Foreground desktop-to-Expo and Expo-to-desktop p95 visibility is below 2 seconds in production-like testing.
- Randomized and crash-injection tests show identical canonical server and client state after convergence.
- Socket loss never requires user refresh.
- A resumed Expo app pulls before reporting live.
- No organization can observe another organization’s invalidation or rows.
- Stock movements and invoices remain exactly-once under retries.
- Permanent mutations are diagnosable and recoverable rather than silently blocking forever.
- Fresh clients do not replay unbounded historical logs.
- `vp check`, `vp test`, Expo tests, Electron packaging, and Expo production builds pass.

## Primary references

- Cloudflare Durable Object WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare hibernation example: https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/
- Cloudflare Durable Object testing and eviction: https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
- Cloudflare SQLite-backed Durable Object storage: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Expo SQLite: https://docs.expo.dev/versions/latest/sdk/sqlite/
