import {
  CatalogWriteCommand,
  ImportInventoryCommand,
  IssueInvoiceCommand,
  SYNC_EPOCH,
  SYNC_BATCH_BYTES,
  type SyncEntityChange,
} from "@store/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { Catalog, type CatalogFailure, type CatalogScope, type CatalogStatus } from "./catalog";
import { CatalogError } from "./errors";
import {
  catalogCommandEntry,
  outboxEntryIdentity,
  pendingReplicaChanges,
  changesForOutboxEntry,
  diffFromChanges,
  emptyReplicaSnapshot,
  importCommandEntry,
  invoiceCommandEntry,
  replicaScopeKey,
  visibleReplicaSnapshot,
  snapshotAsChanges,
  type OutboxEntry,
  type ReplicaDiff,
  type ReplicaSnapshot,
} from "./replica";
import { ReplicaStore } from "./store";
import { CatalogTransport, type CatalogBatchCommand } from "./transport";

const publishDiffs = Effect.fn("Catalog.publishDiffs")(function* (
  changes: PubSub.PubSub<ReplicaDiff>,
  diffs: ReadonlyArray<ReplicaDiff>,
) {
  for (const diff of diffs) {
    if (diff.upserts.length > 0 || diff.deletes.length > 0) {
      yield* PubSub.publish(changes, diff);
    }
  }
});

const markOffline = (status: SubscriptionRef.SubscriptionRef<CatalogStatus>) =>
  SubscriptionRef.set(status, "offline");

export const makeCatalog = Effect.fn("Catalog.make")(function* (scope: CatalogScope) {
  const transport = yield* CatalogTransport;
  const replicaStore = yield* ReplicaStore;
  const slices =
    scope.slices && scope.slices.length > 0 ? scope.slices : (["catalog", "sales"] as const);
  const scopeKey = replicaScopeKey(scope.apiOrigin, scope.organizationId);

  const status = yield* SubscriptionRef.make<CatalogStatus>("hydrating");
  const changes = yield* PubSub.unbounded<ReplicaDiff>();
  const failures = yield* Queue.unbounded<CatalogFailure>();
  const stateRef = yield* SubscriptionRef.make(emptyReplicaSnapshot());
  const pushWake = yield* Queue.sliding<void>(1);
  const pullWake = yield* Queue.sliding<void>(1);
  const offerPushWake = Effect.fn("Catalog.offerPushWake")(function* () {
    yield* Queue.offer(pushWake, undefined);
  });
  const offerPullWake = Effect.fn("Catalog.offerPullWake")(function* () {
    yield* Queue.offer(pullWake, undefined);
  });
  const lock = yield* Semaphore.make(1);
  const exclusive = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    lock.withPermits(1)(Effect.uninterruptible(operation));

  const isRetryable = (error: CatalogError) =>
    error.reason === "transport" || error.reason === "transient";

  const retrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
    Schedule.jittered,
    Schedule.setInputType<CatalogError>(),
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.succeed(
        Duration.max(
          Duration.min(duration, Duration.seconds(30)),
          Duration.millis(input.retryAfterMs ?? 0),
        ),
      ),
    ),
  );
  const retryTransient = <A, R>(effect: Effect.Effect<A, CatalogError, R>) =>
    effect.pipe(
      Effect.tapError(() => markOffline(status)),
      Effect.retry({ while: isRetryable, schedule: retrySchedule }),
    );

  const retrySync = <A, R>(effect: Effect.Effect<A, CatalogError, R>) =>
    retryTransient(
      effect.pipe(
        Effect.tapError((error) =>
          Queue.offer(failures, { _tag: "sync", error } satisfies CatalogFailure).pipe(
            Effect.asVoid,
          ),
        ),
      ),
    );

  const state = visibleReplicaSnapshot(yield* replicaStore.load(scopeKey));
  yield* SubscriptionRef.set(stateRef, state);

  const markUploaded = (
    entries: ReadonlyArray<{ readonly entry: OutboxEntry; readonly txid: number }>,
  ) =>
    exclusive(
      Effect.gen(function* () {
        const committed = yield* replicaStore.transaction(scopeKey, (transaction) => {
          for (const { entry, txid } of entries) {
            transaction.acknowledgeOutbox(outboxEntryIdentity(entry), txid);
          }
        });
        const after = visibleReplicaSnapshot(committed.snapshot);
        yield* SubscriptionRef.set(stateRef, after);
        const replicated = entries
          .filter(({ txid }) => txid <= after.cursor)
          .flatMap(({ entry }) => changesForOutboxEntry(entry));
        if (replicated.length > 0) {
          const affected = new Set(
            replicated.map((change) => `${change.entity}:${change.entityId}`),
          );
          const current = snapshotAsChanges(after, slices).filter((change) =>
            affected.has(`${change.entity}:${change.entityId}`),
          );
          const removals = replicated.map((change): SyncEntityChange => ({
            entity: change.entity,
            entityId: change.entityId,
            rowVersion: change.rowVersion,
            action: "delete",
            row: null,
          }));
          yield* publishDiffs(changes, diffFromChanges([...removals, ...current]));
        }
      }),
    );

  const batchable = (entry: OutboxEntry): CatalogBatchCommand => {
    if (entry.kind === "catalogWrite") return { kind: "catalogWrite", command: entry.command };
    if (entry.kind === "issueInvoice") return { kind: "issueInvoice", command: entry.command };
    return { kind: "importInventory", command: entry.command };
  };

  const uploadBatch = Effect.fn("Catalog.uploadBatch")(function* () {
    const current = yield* SubscriptionRef.get(stateRef);
    if (current.outbox.length === 0) {
      yield* SubscriptionRef.set(status, "ready");
      return true;
    }
    yield* SubscriptionRef.set(status, "syncing");
    const entries = current.outbox.slice(0, 50);
    const commands: Array<CatalogBatchCommand> = [];
    let bytes = 15;
    for (const entry of entries) {
      const command = batchable(entry);
      const nextBytes = bytes + new TextEncoder().encode(JSON.stringify(command)).byteLength + 1;
      if (commands.length > 0 && nextBytes > SYNC_BATCH_BYTES) break;
      commands.push(command);
      bytes = nextBytes;
    }
    const result = yield* retryTransient(transport.batch(commands));
    const accepted: Array<{ readonly entry: OutboxEntry; readonly txid: number }> = [];
    let rejection: CatalogError | undefined;
    for (let index = 0; index < result.results.length && index < entries.length; index += 1) {
      const response = result.results[index];
      const entry = entries[index];
      if (response.id !== entry.id)
        return yield* new CatalogError({
          reason: "rejected",
          message: "Sync response does not match the uploaded commands.",
        });
      if (response.status === "accepted") accepted.push({ entry, txid: response.txid });
      else {
        rejection = new CatalogError({
          reason: "rejected",
          code: response.code,
          message: response.message,
        });
        break;
      }
    }
    if (accepted.length > 0) yield* markUploaded(accepted);
    if (rejection) yield* rejection;
    if (accepted.length === 0)
      return yield* new CatalogError({
        reason: "rejected",
        message: "Sync batch returned no receipts.",
      });
    yield* offerPullWake();
    return false;
  });
  const drainOutbox = () =>
    uploadBatch().pipe(Effect.repeat({ until: (done) => done }), Effect.asVoid);

  const publishSnapshot = (before: ReplicaSnapshot, after: ReplicaSnapshot) => {
    const next = snapshotAsChanges(after, slices);
    const identities = new Set(next.map((change) => `${change.entity}:${change.entityId}`));
    const removed = snapshotAsChanges(before, slices)
      .filter((change) => !identities.has(`${change.entity}:${change.entityId}`))
      .map((change): SyncEntityChange => ({
        entity: change.entity,
        entityId: change.entityId,
        rowVersion: change.rowVersion,
        action: "delete",
        row: null,
      }));
    return publishDiffs(changes, diffFromChanges([...removed, ...next]));
  };

  const applyPulled = (cursor: number, pulled: ReadonlyArray<SyncEntityChange>) =>
    exclusive(
      Effect.gen(function* () {
        const committed = yield* replicaStore.transaction(scopeKey, (transaction) => {
          transaction.commitPull(cursor, pulled);
        });
        const after = visibleReplicaSnapshot(committed.snapshot);
        yield* SubscriptionRef.set(stateRef, after);
        const local = pendingReplicaChanges(after);
        yield* publishDiffs(changes, diffFromChanges([...pulled, ...local]));
      }),
    );

  const pullOnce = Effect.fn("Catalog.pull")(function* () {
    const current = yield* SubscriptionRef.get(stateRef);
    let staged: ReadonlyArray<SyncEntityChange> = [];
    yield* Stream.paginate(current.cursor, (cursor) =>
      transport
        .pull({ epoch: SYNC_EPOCH, cursor, slices: [...slices] })
        .pipe(
          Effect.map(
            (page) =>
              [
                [page],
                page.hasMore && !page.resetRequired ? Option.some(page.cursor) : Option.none(),
              ] as const,
          ),
        ),
    ).pipe(
      Stream.runForEach((page) =>
        Effect.gen(function* () {
          if (page.resetRequired) {
            yield* replicaStore.transaction(scopeKey, (transaction) =>
              transaction.discardBootstrap(),
            );
            yield* hydrate();
            return;
          }
          staged = [...staged, ...page.changes];
          if (page.cursor >= (page.transactionEnd ?? page.cursor)) {
            if (page.cursor > (yield* SubscriptionRef.get(stateRef)).cursor)
              yield* applyPulled(page.cursor, staged);
            staged = [];
          }
        }),
      ),
    );
  });

  const hydrate = Effect.fn("Catalog.hydrate")(function* () {
    let stored = yield* replicaStore.load(scopeKey);
    let generation = stored.bootstrap?.generation ?? crypto.randomUUID();
    let bootstrap = stored.bootstrap;
    while (true) {
      const result = yield* transport.snapshot({
        epoch: SYNC_EPOCH,
        slices: [...slices],
        bootstrap: bootstrap ? { id: bootstrap.id, offset: bootstrap.offset } : undefined,
      });
      if (result.resetRequired) {
        yield* replicaStore.transaction(scopeKey, (transaction) => transaction.discardBootstrap());
        if (!bootstrap)
          return yield* new CatalogError({
            reason: "rejected",
            message: "Sync protocol requires an app update.",
          });
        bootstrap = undefined;
        generation = crypto.randomUUID();
        continue;
      }
      const page = result.bootstrap;
      if (!page)
        return yield* new CatalogError({
          reason: "rejected",
          message: "Snapshot page is missing its continuation.",
        });
      yield* exclusive(
        Effect.gen(function* () {
          const before = yield* SubscriptionRef.get(stateRef);
          const committed = yield* replicaStore.transaction(scopeKey, (transaction) => {
            if (!bootstrap)
              transaction.beginBootstrap({
                id: page.id,
                generation,
                cursor: result.cursor,
                offset: 0,
                done: false,
                expiresAt: page.expiresAt,
              });
            transaction.stageBootstrapPage(generation, result.changes, page.nextOffset, page.done);
            if (page.done) transaction.activateBootstrap(generation);
          });
          stored = committed.snapshot;
          if (page.done) {
            const after = visibleReplicaSnapshot(stored);
            yield* SubscriptionRef.set(stateRef, after);
            yield* publishSnapshot(before, after);
          }
        }),
      );
      if (page.done) return;
      bootstrap = stored.bootstrap;
    }
  });

  const connected = yield* Ref.make(false);
  yield* transport.live.pipe(
    Stream.tap((hint) =>
      Effect.gen(function* () {
        const wasConnected = yield* Ref.getAndSet(connected, true);
        const current = yield* SubscriptionRef.get(stateRef);
        if (!wasConnected || hint.epoch !== SYNC_EPOCH || hint.cursor > current.cursor)
          yield* offerPullWake();
      }),
    ),
    Stream.ensuring(Ref.set(connected, false)),
    Stream.retry(retrySchedule),
    Stream.runDrain,
    Effect.forkScoped,
  );

  yield* Stream.fromQueue(pushWake).pipe(
    Stream.runForEach(() =>
      drainOutbox().pipe(
        Effect.catchTag("CatalogError", (error) =>
          Queue.offer(failures, { _tag: "upload", error }).pipe(
            Effect.andThen(markOffline(status)),
          ),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  const synchronize = Effect.fn("Catalog.synchronize")(function* () {
    const current = yield* SubscriptionRef.get(stateRef);
    if (!current.initialized) {
      yield* SubscriptionRef.set(status, "hydrating");
      yield* hydrate();
    }
    yield* pullOnce();
    const after = yield* SubscriptionRef.get(stateRef);
    yield* SubscriptionRef.set(status, after.outbox.length > 0 ? "syncing" : "ready");
  });
  yield* Stream.fromQueue(pullWake).pipe(
    Stream.runForEach(() =>
      retrySync(synchronize()).pipe(Effect.catchTag("CatalogError", () => markOffline(status))),
    ),
    Effect.forkScoped,
  );

  const reconcileSchedule = Schedule.spaced(Duration.seconds(30)).pipe(
    Schedule.modifyDelay(() =>
      Ref.get(connected).pipe(
        Effect.map((live) => (live ? Duration.minutes(5) : Duration.seconds(30))),
      ),
    ),
  );
  yield* offerPullWake().pipe(Effect.repeat(reconcileSchedule), Effect.forkScoped);

  if (state.outbox.length > 0) yield* offerPushWake();

  const enqueue = Effect.fn("Catalog.enqueue")(function* (entry: OutboxEntry) {
    const optimisticChanges = changesForOutboxEntry(entry);
    yield* exclusive(
      Effect.gen(function* () {
        const committed = yield* replicaStore.transaction(scopeKey, (transaction) => {
          return transaction.appendOutbox(entry);
        });
        yield* SubscriptionRef.set(stateRef, visibleReplicaSnapshot(committed.snapshot));
        if (committed.result) yield* publishDiffs(changes, diffFromChanges(optimisticChanges));
      }),
    );
    yield* offerPushWake();
  });

  return Catalog.of({
    status: SubscriptionRef.changes(status),
    changes: Stream.fromPubSub(changes),
    failures: Stream.fromQueue(failures),
    snapshot: SubscriptionRef.get(stateRef),
    poke: Effect.all([offerPullWake(), offerPushWake()], { discard: true }),
    waitForIdle: Effect.gen(function* () {
      const pending = yield* SubscriptionRef.get(stateRef);
      if (pending.outbox.length === 0) return;
      const current = yield* SubscriptionRef.get(status);
      if (current === "offline") {
        return yield* new CatalogError({
          reason: "transport",
          message: "Wait until catalog changes finish uploading before continuing.",
        });
      }
      yield* SubscriptionRef.changes(stateRef).pipe(
        Stream.filter((next) => next.outbox.length === 0),
        Stream.runHead,
        Effect.timeout(Duration.seconds(15)),
        Effect.mapError(
          () =>
            new CatalogError({
              reason: "transient",
              message: "Catalog changes are still uploading. Try again in a moment.",
            }),
        ),
      );
    }),
    write: Effect.fn("Catalog.write")(function* (command: CatalogWriteCommand) {
      yield* enqueue(catalogCommandEntry(command));
    }),
    issueInvoice: Effect.fn("Catalog.issueInvoice")(function* (
      command: IssueInvoiceCommand,
      changes: ReadonlyArray<SyncEntityChange>,
    ) {
      yield* enqueue(invoiceCommandEntry(command, changes));
    }),
    importInventory: Effect.fn("Catalog.importInventory")(function* (
      command: ImportInventoryCommand,
    ) {
      yield* enqueue(importCommandEntry(command));
    }),
  });
});

export const CatalogLive = (scope: CatalogScope) => Layer.effect(Catalog, makeCatalog(scope));
