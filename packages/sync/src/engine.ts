import {
  CatalogWriteCommand,
  ImportInventoryCommand,
  IssueInvoiceCommand,
} from "@store/contracts"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { Catalog, type CatalogScope, type CatalogStatus } from "./catalog"
import { CatalogError } from "./errors"
import {
  applyChanges,
  catalogCommandEntry,
  commandChanges,
  diffFromChanges,
  emptyReplicaSnapshot,
  importCommandEntry,
  invoiceCommandEntry,
  replicaScopeKey,
  snapshotAsChanges,
  type OutboxEntry,
  type ReplicaDiff,
  type ReplicaSnapshot,
} from "./replica"
import { DurableStore, type DurableStoreApi } from "./store"
import { CatalogTransport } from "./transport"

const snapshotKey = (scopeKey: string) => `${scopeKey}:snapshot`
const outboxKey = (scopeKey: string) => `${scopeKey}:outbox`

const loadSnapshot = Effect.fn("Catalog.loadSnapshot")(function* (
  store: DurableStoreApi,
  scopeKey: string,
) {
  const raw = yield* store.get(snapshotKey(scopeKey))
  if (!raw) return emptyReplicaSnapshot()
  try {
    return JSON.parse(raw) as ReplicaSnapshot
  } catch {
    return emptyReplicaSnapshot()
  }
})

const loadOutbox = Effect.fn("Catalog.loadOutbox")(function* (
  store: DurableStoreApi,
  scopeKey: string,
) {
  const raw = yield* store.get(outboxKey(scopeKey))
  if (!raw) return [] as Array<OutboxEntry>
  try {
    return JSON.parse(raw) as Array<OutboxEntry>
  } catch {
    return []
  }
})

const saveSnapshot = (store: DurableStoreApi, scopeKey: string, snapshot: ReplicaSnapshot) =>
  store.set(snapshotKey(scopeKey), JSON.stringify(snapshot))

const saveOutbox = (
  store: DurableStoreApi,
  scopeKey: string,
  outbox: ReadonlyArray<OutboxEntry>,
) => store.set(outboxKey(scopeKey), JSON.stringify(outbox))

const publishDiffs = Effect.fn("Catalog.publishDiffs")(function* (
  changes: PubSub.PubSub<ReplicaDiff>,
  diffs: ReadonlyArray<ReplicaDiff>,
) {
  for (const diff of diffs) {
    if (diff.upserts.length > 0 || diff.deletes.length > 0) {
      yield* PubSub.publish(changes, diff)
    }
  }
})

const markOffline = (status: SubscriptionRef.SubscriptionRef<CatalogStatus>) =>
  SubscriptionRef.set(status, "offline")

export const makeCatalog = Effect.fn("Catalog.make")(function* (scope: CatalogScope) {
  const transport = yield* CatalogTransport
  const store = yield* DurableStore
  const slices =
    scope.slices && scope.slices.length > 0 ? scope.slices : (["catalog", "sales"] as const)
  const scopeKey = replicaScopeKey(scope.apiOrigin, scope.organizationId)

  const status = yield* SubscriptionRef.make<CatalogStatus>("hydrating")
  const changes = yield* PubSub.unbounded<ReplicaDiff>()
  const snapshotRef = yield* Ref.make<ReplicaSnapshot>(emptyReplicaSnapshot())
  const outboxRef = yield* Ref.make<Array<OutboxEntry>>([])
  const pushWake = yield* Queue.unbounded<void>()
  const pullWake = yield* Queue.unbounded<void>()
  const lock = yield* Queue.bounded<void>(1)
  yield* Queue.offer(lock, undefined)

  const exclusive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Queue.take(lock),
      () => effect,
      () => Queue.offer(lock, undefined),
    )

  const recoverOffline = <A, R>(effect: Effect.Effect<A, CatalogError, R>) =>
    effect.pipe(Effect.catchTag("CatalogError", () => markOffline(status)))

  const snapshot = yield* loadSnapshot(store, scopeKey)
  const outbox = yield* loadOutbox(store, scopeKey)
  yield* Ref.set(snapshotRef, snapshot)
  yield* Ref.set(outboxRef, outbox)
  if (snapshot.cursor > 0) {
    yield* publishDiffs(changes, diffFromChanges(snapshotAsChanges(snapshot, slices)))
    yield* SubscriptionRef.set(status, outbox.length > 0 ? "syncing" : "ready")
  }

  const pushOnce = Effect.fn("Catalog.pushOnce")(function* () {
    const pending = yield* Ref.get(outboxRef)
    const entry = pending[0]
    if (!entry) return
    yield* SubscriptionRef.set(status, "syncing")
    if (entry.kind === "catalogWrite") {
      yield* transport.write(entry.command as CatalogWriteCommand)
    } else if (entry.kind === "issueInvoice") {
      yield* transport.issueInvoice(entry.command as IssueInvoiceCommand)
    } else {
      yield* transport.importInventory(entry.command as ImportInventoryCommand)
    }
    const rest = pending.slice(1)
    yield* Ref.set(outboxRef, rest)
    yield* saveOutbox(store, scopeKey, rest)
    yield* SubscriptionRef.set(status, rest.length > 0 ? "syncing" : "ready")
    yield* Queue.offer(pullWake, undefined)
  })

  const pullOnce = Effect.fn("Catalog.pullOnce")(function* (waitMs: number) {
    yield* exclusive(
      Effect.gen(function* () {
        const current = yield* Ref.get(snapshotRef)
        const result = yield* transport.pull({
          cursor: current.cursor,
          slices: [...slices],
          waitMs,
        })
        if (result.changes.length === 0 && result.cursor === current.cursor) return
        const next = applyChanges({ ...current, cursor: result.cursor }, result.changes)
        yield* Ref.set(snapshotRef, next)
        yield* saveSnapshot(store, scopeKey, next)
        yield* publishDiffs(changes, diffFromChanges(result.changes))
      }),
    )
  })

  const hydrate = Effect.fn("Catalog.hydrate")(function* () {
    const current = yield* Ref.get(snapshotRef)
    if (current.cursor !== 0) return
    const result = yield* transport.snapshot({ slices: [...slices] })
    yield* exclusive(
      Effect.gen(function* () {
        const next = applyChanges(
          { ...emptyReplicaSnapshot(), cursor: result.cursor },
          result.changes,
        )
        yield* Ref.set(snapshotRef, next)
        yield* saveSnapshot(store, scopeKey, next)
        yield* publishDiffs(changes, diffFromChanges(result.changes))
        const pending = yield* Ref.get(outboxRef)
        yield* SubscriptionRef.set(status, pending.length > 0 ? "syncing" : "ready")
      }),
    )
  })

  yield* recoverOffline(hydrate()).pipe(Effect.forkScoped)
  yield* Queue.take(pushWake).pipe(
    Effect.andThen(() => recoverOffline(pushOnce())),
    Effect.forever,
    Effect.forkScoped,
  )
  yield* pullOnce(25_000).pipe(
    Effect.catchTag("CatalogError", () =>
      markOffline(status).pipe(Effect.andThen(Effect.sleep(Duration.seconds(2)))),
    ),
    Effect.forever,
    Effect.forkScoped,
  )
  yield* Queue.take(pullWake).pipe(
    Effect.andThen(() => recoverOffline(pullOnce(0))),
    Effect.forever,
    Effect.forkScoped,
  )

  if (outbox.length > 0) yield* Queue.offer(pushWake, undefined)

  const enqueue = Effect.fn("Catalog.enqueue")(function* (entry: OutboxEntry) {
    const next = yield* Ref.updateAndGet(outboxRef, (current) => [...current, entry])
    yield* saveOutbox(store, scopeKey, next)
    yield* Queue.offer(pushWake, undefined)
  })

  return Catalog.of({
    status,
    changes,
    snapshot: Ref.get(snapshotRef),
    poke: Queue.offer(pullWake, undefined).pipe(Effect.asVoid),
    waitForIdle: Effect.gen(function* () {
      const pending = yield* Ref.get(outboxRef)
      if (pending.length === 0) return
      const current = yield* SubscriptionRef.get(status)
      if (current === "offline") {
        return yield* new CatalogError({
          reason: "transport",
          message: "Wait until catalog changes finish uploading before continuing.",
        })
      }
      yield* Ref.get(outboxRef).pipe(
        Effect.repeat({
          until: (entries) => entries.length === 0,
          schedule: Schedule.spaced(Duration.millis(50)),
        }),
        Effect.timeout(Duration.seconds(15)),
        Effect.mapError(
          () =>
            new CatalogError({
              reason: "transient",
              message: "Catalog changes are still uploading. Try again in a moment.",
            }),
        ),
      )
    }),
    write: Effect.fn("Catalog.write")(function* (command: CatalogWriteCommand) {
      yield* exclusive(
        Effect.gen(function* () {
          const before = yield* Ref.get(snapshotRef)
          const next = applyChanges(before, commandChanges(command))
          yield* Ref.set(snapshotRef, next)
          yield* saveSnapshot(store, scopeKey, next)
        }),
      )
      yield* enqueue(catalogCommandEntry(command))
    }),
    issueInvoice: Effect.fn("Catalog.issueInvoice")(function* (command: IssueInvoiceCommand) {
      yield* enqueue(invoiceCommandEntry(command))
    }),
    importInventory: Effect.fn("Catalog.importInventory")(function* (
      command: ImportInventoryCommand,
    ) {
      yield* enqueue(importCommandEntry(command))
    }),
  })
})

export const CatalogLive = (scope: CatalogScope) => Layer.effect(Catalog, makeCatalog(scope))
