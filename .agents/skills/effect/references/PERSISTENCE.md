# Persistence, Queues, And Durable Work

Use this when work must survive a fiber, tab, or process restart, or when
you need a schema-aware outbox rather than an in-memory `Queue`.

Unstable imports (rc.112, breaking changes allowed in minor RCs):

- `effect/unstable/persistence/PersistedQueue`
- `effect/unstable/persistence/KeyValueStore`
- `effect/unstable/persistence/Persistence`
- `effect/unstable/persistence/PersistedCache`

Do not treat “unstable” as “avoid”. Prefer these over a hand-rolled
IndexedDB wrapper, SQL job table, or `Map` of pending commands.

## Chooser

| Need | Use |
| --- | --- |
| In-process handoff, lost on reload | `Queue` / `PubSub` / `SubscriptionRef` (see STREAMS.md) |
| Durable named outbox, at-least-once `take`, retries | `PersistedQueue` |
| Lightweight durable blob/string state | `KeyValueStore` |
| Lookup cache that survives restarts | `PersistedCache` over `Persistence` |
| Browser durable catalog replica | `KeyValueStore` + IndexedDB adapter. **Never SQLite / wa-sqlite in the browser.** |
| Desktop durable replica | `KeyValueStore.layerFileSystem` or `PersistedQueue.layerStoreSql` with **native** SQLite in a Node/Electron utility process, not the renderer |

## PersistedQueue

Named, schema-encoded queue. `offer` enqueues; `take` runs one handler in a
scoped window. Success acks. Failure re-delivers until `maxAttempts` (default
10). Delivery is **at-least-once**. Ordering is **not** FIFO across retries.
Handlers must be idempotent (stable `offer` ids).

```ts
import { PersistedQueue } from "effect/unstable/persistence";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const CatalogWriteJob = Schema.Struct({
  operationId: Schema.String,
  payload: Schema.Unknown,
});

const queue = yield* PersistedQueue.make({
  name: "catalog-outbox",
  schema: CatalogWriteJob,
});

yield* queue.offer(job, { id: `write:${job.operationId}` });

yield* queue.take((job) => pushCatalogWrite(job)).pipe(Effect.forever, Effect.forkScoped);
```

Store layers (provide under `PersistedQueue.layer`):

| Layer | Durability | Where |
| --- | --- | --- |
| `layerStoreMemory` | Process only | Tests, ephemeral workers |
| `layerStoreSql` | SQL table + row leases | Server, Electron **utility** with native SQLite / Postgres |
| `layerStoreRedis` | Redis lists + leases | Multi-worker server |

Do not use `layerStoreSql` in a browser isolate. There is no SQLite in the
web renderer or a web worker.

`take` options: `{ maxAttempts }`. Tune SQL/Redis `pollInterval`,
`lockRefreshInterval`, `lockExpiration` so a slow handler does not lose its
lease. Pure interruption does not burn an attempt.

## KeyValueStore

String/binary map with `get` / `set` / `remove` / `clear` / `size`. Build with
`KeyValueStore.make` / `makeStringOnly`, or use a layer:

| Layer | Backend |
| --- | --- |
| `layerMemory` | `Map` |
| `layerFileSystem(dir)` | One file per key (needs `FileSystem` + `Path`) |
| `layerStorage(() => localStorage)` | Web Storage. Tiny quota — not a catalog replica |
| `layerSql` | SQL table. Native/server only |

Prefix views: `KeyValueStore.prefix(store, "catalog:")`.

Typed JSON values: `KeyValueStore.toSchemaStore(store, schema)` (JSON codec,
`get` returns `Option`). Do not invent a `forSchema` helper.

Browser catalog replica: implement a **small adapter** with
`KeyValueStore.makeStringOnly` over IndexedDB (structured blobs, large quota).
That adapter is the seam. The Catalog module must not import SQLite, WASM, or
OPFS database drivers. `layerStorage` is Web Storage — too small for a catalog.

Electron catalog replica: `layerFileSystem` under `app.getPath("userData")` in
the **utility process**, or SQL in that same process. The renderer holds
TanStack DB memory collections only.

## Persistence / PersistedCache

`Persistence` is result-store persistence (JSON + optional TTL) over a
`BackingPersistence`. `layerKvs` backs it with `KeyValueStore`.
`PersistedCache.make({ storeId, lookup, timeToLive })` is Cache + durable
backing. Use for credential/config lookups, not for the catalog replica.

## Mailbox

v3 `Mailbox` is v4 `Queue`. Use `Queue.make` / `Queue.offer` / `Stream.fromQueue`.

## Catalog outbox (this repo)

The Catalog module’s interface is write / invoice / status / dispose. Push,
pull, cursor, and storage stay in the implementation.

- Web: replica snapshot + outbox JSON in IndexedDB via `KeyValueStore`. Drain
  with `PersistedQueue.layerStoreMemory` after hydrate, or drain the snapshot
  array with `Queue`. No `layerStoreSql`.
- Electron utility: same interface; `PersistedQueue.layerStoreSql` or
  filesystem `KeyValueStore` is an adapter swap, not a new module.
- Server command receipts stay Postgres `inventory_mutation_receipts`.
  `PersistedQueue` is not a substitute for those receipts.
