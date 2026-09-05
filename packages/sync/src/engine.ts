import {
  CatalogWriteCommand,
  ImportInventoryCommand,
  IssueInvoiceCommand,
  type SyncEntityChange,
} from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { Catalog, type CatalogFailure, type CatalogScope, type CatalogStatus } from "./catalog";
import { CatalogError } from "./errors";
import {
  OutboxEntry as OutboxEntrySchema,
  ReplicaSnapshot as ReplicaSnapshotSchema,
  applyChanges,
  catalogCommandEntry,
  commandChanges,
  diffFromChanges,
  emptyReplicaSnapshot,
  importCommandEntry,
  invoiceCommandEntry,
  replicaScopeKey,
  type OutboxEntry,
  type ReplicaDiff,
  type ReplicaSnapshot,
} from "./replica";
import { DurableStore, type DurableStoreApi } from "./store";
import { CatalogTransport } from "./transport";

const snapshotKey = (scopeKey: string) => `${scopeKey}:snapshot`;
const legacyOutboxKey = (scopeKey: string) => `${scopeKey}:outbox`;

const decodeSnapshot = (raw: string | undefined) =>
  Effect.sync((): ReplicaSnapshot => {
    if (!raw) return emptyReplicaSnapshot();
    try {
      return (
        Schema.decodeUnknownOption(ReplicaSnapshotSchema)(JSON.parse(raw)).pipe(Option.getOrNull) ??
        emptyReplicaSnapshot()
      );
    } catch {
      return emptyReplicaSnapshot();
    }
  });

const decodeOutbox = (raw: string | undefined) =>
  Effect.sync((): ReadonlyArray<OutboxEntry> => {
    if (!raw) return [];
    try {
      return (
        Schema.decodeUnknownOption(Schema.Array(OutboxEntrySchema))(JSON.parse(raw)).pipe(
          Option.getOrNull,
        ) ?? []
      );
    } catch {
      return [];
    }
  });

const saveState = (store: DurableStoreApi, scopeKey: string, state: ReplicaSnapshot) =>
  store.set(snapshotKey(scopeKey), JSON.stringify(state));

const outboxIdentity = (entry: OutboxEntry) => `${entry.kind}:${entry.id}`;

const loadState = Effect.fn("Catalog.loadState")(function* (
  store: DurableStoreApi,
  scopeKey: string,
) {
  const snapshot = yield* decodeSnapshot(yield* store.get(snapshotKey(scopeKey)));
  const legacyOutbox = yield* decodeOutbox(yield* store.get(legacyOutboxKey(scopeKey)));
  if (legacyOutbox.length === 0) return snapshot;

  const known = new Set(snapshot.outbox.map(outboxIdentity));
  const outbox = [
    ...snapshot.outbox,
    ...legacyOutbox.filter((entry) => !known.has(outboxIdentity(entry))),
  ];
  const migrated = { ...snapshot, outbox };
  yield* saveState(store, scopeKey, migrated);
  yield* store.remove(legacyOutboxKey(scopeKey));
  return migrated;
});

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
  const store = yield* DurableStore;
  const slices =
    scope.slices && scope.slices.length > 0 ? scope.slices : (["catalog", "sales"] as const);
  const scopeKey = replicaScopeKey(scope.apiOrigin, scope.organizationId);

  const status = yield* SubscriptionRef.make<CatalogStatus>("hydrating");
  const changes = yield* PubSub.unbounded<ReplicaDiff>();
  const failures = yield* Queue.unbounded<CatalogFailure>();
  const stateRef = yield* Ref.make(emptyReplicaSnapshot());
  const pushWake = yield* Queue.unbounded<void>();
  const pullWake = yield* Queue.unbounded<void>();
  const hydrated = yield* Deferred.make<void>();
  const lock = yield* Queue.bounded<void>(1);
  yield* Queue.offer(lock, undefined);

  const exclusive = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Queue.take(lock),
      () => effect,
      () => Queue.offer(lock, undefined),
    );

  const isRetryable = (error: CatalogError) =>
    error.reason === "transport" || error.reason === "transient";

  const retryTransient = <A, R>(effect: Effect.Effect<A, CatalogError, R>) =>
    effect.pipe(
      Effect.tapError(() => markOffline(status)),
      Effect.retry({
        while: isRetryable,
        schedule: Schedule.exponential(Duration.millis(250)).pipe(
          Schedule.jittered,
          Schedule.modifyDelay(({ duration }) =>
            Effect.succeed(Duration.min(duration, Duration.seconds(30))),
          ),
        ),
      }),
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

  const state = yield* loadState(store, scopeKey);
  yield* Ref.set(stateRef, state);
  if (state.cursor > 0) {
    yield* Deferred.succeed(hydrated, undefined);
    yield* SubscriptionRef.set(status, state.outbox.length > 0 ? "syncing" : "ready");
  }

  const pushEntry = Effect.fn("Catalog.pushEntry")(function* (entry: OutboxEntry) {
    if (entry.kind === "catalogWrite") {
      yield* transport.write(entry.command);
    } else if (entry.kind === "issueInvoice") {
      yield* transport.issueInvoice(entry.command);
    } else {
      yield* transport.importInventory(entry.command);
    }
  });

  const pendingChanges = (current: ReplicaSnapshot) =>
    current.outbox.flatMap((entry) =>
      entry.kind === "catalogWrite"
        ? commandChanges(entry.command)
        : entry.kind === "issueInvoice"
          ? (entry.changes ?? [])
          : [],
    );

  const applyPendingWrites = (current: ReplicaSnapshot) =>
    applyChanges(current, pendingChanges(current));

  const drainOutbox = Effect.fn("Catalog.drainOutbox")(function* () {
    while (true) {
      const current = yield* Ref.get(stateRef);
      const entry = current.outbox[0];
      if (!entry) {
        yield* SubscriptionRef.set(status, "ready");
        return;
      }

      yield* SubscriptionRef.set(status, "syncing");
      yield* retryTransient(pushEntry(entry)).pipe(
        Effect.catchTag("CatalogError", (error) =>
          entry.kind === "catalogWrite" && error.reason === "conflict"
            ? Effect.void
            : Effect.fail(error),
        ),
      );
      yield* exclusive(
        Effect.gen(function* () {
          const latest = yield* Ref.get(stateRef);
          const head = latest.outbox[0];
          if (!head || outboxIdentity(head) !== outboxIdentity(entry)) return;
          const next = { ...latest, outbox: latest.outbox.slice(1) };
          yield* saveState(store, scopeKey, next);
          yield* Ref.set(stateRef, next);
        }),
      );
      yield* Queue.offer(pullWake, undefined);
    }
  });

  const pullOnce = Effect.fn("Catalog.pullOnce")(function* (waitMs: number) {
    const before = yield* Ref.get(stateRef);
    const result = yield* transport.pull({
      cursor: before.cursor,
      slices: [...slices],
      waitMs,
    });
    const applied = yield* exclusive(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (result.cursor <= current.cursor) return [];
        const next = applyPendingWrites(
          applyChanges(
            {
              cursor: result.cursor,
              outbox: current.outbox,
              rows: current.rows,
            },
            result.changes,
          ),
        );
        yield* saveState(store, scopeKey, next);
        yield* Ref.set(stateRef, next);
        return [...result.changes, ...pendingChanges(next)];
      }),
    );
    yield* publishDiffs(changes, diffFromChanges(applied));
    const latest = yield* Ref.get(stateRef);
    yield* SubscriptionRef.set(status, latest.outbox.length > 0 ? "syncing" : "ready");
  });

  const hydrate = Effect.fn("Catalog.hydrate")(function* () {
    const result = yield* transport.snapshot({ slices: [...slices] });
    const applied = yield* exclusive(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (current.cursor !== 0) return [];
        const empty = emptyReplicaSnapshot();
        const next = applyPendingWrites(
          applyChanges(
            {
              cursor: result.cursor,
              outbox: current.outbox,
              rows: empty.rows,
            },
            result.changes,
          ),
        );
        yield* saveState(store, scopeKey, next);
        yield* Ref.set(stateRef, next);
        return [...result.changes, ...pendingChanges(next)];
      }),
    );
    yield* publishDiffs(changes, diffFromChanges(applied));
    const latest = yield* Ref.get(stateRef);
    yield* SubscriptionRef.set(status, latest.outbox.length > 0 ? "syncing" : "ready");
  });

  yield* Queue.take(pushWake).pipe(
    Effect.andThen(() =>
      drainOutbox().pipe(
        Effect.catchTag("CatalogError", (error) =>
          Queue.offer(failures, { _tag: "upload", error } satisfies CatalogFailure).pipe(
            Effect.andThen(markOffline(status)),
            Effect.asVoid,
          ),
        ),
      ),
    ),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* Effect.gen(function* () {
    const current = yield* Ref.get(stateRef);
    if (current.cursor === 0) yield* retrySync(hydrate());
    yield* Deferred.succeed(hydrated, undefined);
    yield* retrySync(pullOnce(0)).pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))));
  }).pipe(
    Effect.catchTag("CatalogError", () => markOffline(status)),
    Effect.forkScoped,
  );
  yield* Queue.take(pullWake).pipe(
    Effect.andThen(() =>
      Deferred.await(hydrated).pipe(
        Effect.andThen(retrySync(pullOnce(0))),
        Effect.catchTag("CatalogError", () => markOffline(status)),
      ),
    ),
    Effect.forever,
    Effect.forkScoped,
  );

  if (state.outbox.length > 0) yield* Queue.offer(pushWake, undefined);

  const enqueue = Effect.fn("Catalog.enqueue")(function* (
    entry: OutboxEntry,
    optimisticChanges: ReadonlyArray<SyncEntityChange>,
  ) {
    yield* exclusive(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const next = applyChanges(
          { ...current, outbox: [...current.outbox, entry] },
          optimisticChanges,
        );
        yield* saveState(store, scopeKey, next);
        yield* Ref.set(stateRef, next);
      }),
    );
    yield* Queue.offer(pushWake, undefined);
  });

  return Catalog.of({
    status,
    changes,
    failures,
    snapshot: Ref.get(stateRef),
    poke: Queue.offer(pullWake, undefined).pipe(Effect.asVoid),
    waitForIdle: Effect.gen(function* () {
      const pending = yield* Ref.get(stateRef);
      if (pending.outbox.length === 0) return;
      const current = yield* SubscriptionRef.get(status);
      if (current === "offline") {
        return yield* new CatalogError({
          reason: "transport",
          message: "Wait until catalog changes finish uploading before continuing.",
        });
      }
      yield* Ref.get(stateRef).pipe(
        Effect.repeat({
          until: (next) => next.outbox.length === 0,
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
      );
    }),
    write: Effect.fn("Catalog.write")(function* (command: CatalogWriteCommand) {
      yield* enqueue(catalogCommandEntry(command), commandChanges(command));
    }),
    issueInvoice: Effect.fn("Catalog.issueInvoice")(function* (
      command: IssueInvoiceCommand,
      changes: ReadonlyArray<SyncEntityChange>,
    ) {
      yield* enqueue(invoiceCommandEntry(command, changes), changes);
    }),
    importInventory: Effect.fn("Catalog.importInventory")(function* (
      command: ImportInventoryCommand,
    ) {
      yield* enqueue(importCommandEntry(command), []);
    }),
  });
});

export const CatalogLive = (scope: CatalogScope) => Layer.effect(Catalog, makeCatalog(scope));
