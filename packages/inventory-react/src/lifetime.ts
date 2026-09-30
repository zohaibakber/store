import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import {
  catalogBusy,
  catalogOpenFailure,
  staleCatalogLease,
  type CatalogBusy,
  type CatalogOpenFailure,
  type StaleCatalogLease,
} from "./errors";
import type { InventoryHost, InventoryScope } from "./host";
import { inventoryScopeId, openInventoryWorkspace } from "./open";
import type { Inventory } from "./types";

export type CatalogLease = {
  readonly scope: InventoryScope;
};

export type CatalogReplica = {
  readonly dispose: () => Promise<void>;
};

export type CatalogLifetime<Replica extends CatalogReplica = Inventory> = {
  readonly lease: () => CatalogLease | null;
  readonly claim: (scope: InventoryScope) => CatalogLease;
  readonly release: () => void;
  readonly open: (
    lease: CatalogLease,
    host: InventoryHost,
  ) => Effect.Effect<Replica, StaleCatalogLease | CatalogOpenFailure | CatalogBusy>;
};

type Tenancy<Replica> = {
  readonly lease: CatalogLease;
  readonly scope: Scope.Closeable;
  readonly opened: Deferred.Deferred<Replica>;
  readonly opening: FiberHandle.FiberHandle<Replica, CatalogOpenFailure | CatalogBusy>;
};

const makeTenancy = <Replica>(root: Scope.Scope, scope: InventoryScope) =>
  Effect.gen(function* () {
    const leaseScope = yield* Scope.fork(root);
    const opening = yield* FiberHandle.make<Replica, CatalogOpenFailure | CatalogBusy>().pipe(
      Scope.provide(leaseScope),
    );
    const opened = yield* Deferred.make<Replica>();
    const tenancy: Tenancy<Replica> = { lease: { scope }, scope: leaseScope, opened, opening };
    return tenancy;
  });

export const createCatalogLifetime = <Replica extends CatalogReplica>(input: {
  readonly open: (host: InventoryHost, scope: InventoryScope) => Promise<Replica>;
  readonly databaseName: (host: InventoryHost, scope: InventoryScope) => string;
  readonly sameFileWaitMs?: number;
}): CatalogLifetime<Replica> => {
  const sameFileWait = Duration.millis(input.sameFileWaitMs ?? 8_000);
  const root = Scope.makeUnsafe();
  const turns = Effect.runSync(
    RcMap.make({ lookup: (_databaseName: string) => Semaphore.make(1) }).pipe(Scope.provide(root)),
  );
  let current: Tenancy<Replica> | null = null;

  const holdingTurn = (databaseName: string) => {
    const taking = (turn: Semaphore.Semaphore) =>
      Effect.acquireRelease(turn.take(1), () => turn.release(1), { interruptible: true });
    return {
      within: <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E | CatalogBusy> =>
        Effect.scoped(
          Effect.gen(function* () {
            const turn = yield* RcMap.get(turns, databaseName);
            const acquired = yield* Effect.timeoutOption(taking(turn), sameFileWait);
            if (Option.isNone(acquired)) return yield* catalogBusy();
            return yield* work;
          }),
        ),
      eventually: <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
        Effect.scoped(
          Effect.gen(function* () {
            const turn = yield* RcMap.get(turns, databaseName);
            yield* taking(turn);
            return yield* work;
          }),
        ),
    };
  };

  const acquire = (tenancy: Tenancy<Replica>, host: InventoryHost) => {
    const turn = holdingTurn(input.databaseName(host, tenancy.lease.scope));
    return Effect.acquireRelease(
      turn.within(
        Effect.tryPromise({
          try: () => input.open(host, tenancy.lease.scope),
          catch: catalogOpenFailure,
        }),
      ),
      (replica) => turn.eventually(Effect.ignore(Effect.tryPromise(() => replica.dispose()))),
    ).pipe(
      Effect.tap((replica) => Deferred.succeed(tenancy.opened, replica)),
      Scope.provide(tenancy.scope),
    );
  };

  const joinOpening = (tenancy: Tenancy<Replica>, host: InventoryHost) =>
    Effect.gen(function* () {
      const running = yield* FiberHandle.get(tenancy.opening);
      const fiber = Option.isSome(running)
        ? running.value
        : yield* FiberHandle.run(tenancy.opening, acquire(tenancy, host));
      const exit = yield* Fiber.await(fiber);
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
        return yield* staleCatalogLease();
      }
      return yield* exit;
    });

  const retire = () => {
    const previous = current;
    current = null;
    if (previous !== null) Effect.runFork(Scope.close(previous.scope, Exit.void));
  };

  return {
    lease: () => current?.lease ?? null,
    claim: (scope) => {
      retire();
      const tenancy = Effect.runSync(makeTenancy<Replica>(root, scope));
      current = tenancy;
      return tenancy.lease;
    },
    release: retire,
    open: (lease, host) =>
      Effect.suspend(() => {
        const tenancy = current;
        if (tenancy === null || tenancy.lease !== lease) return Effect.fail(staleCatalogLease());
        return Deferred.isDoneUnsafe(tenancy.opened)
          ? Deferred.await(tenancy.opened)
          : joinOpening(tenancy, host);
      }),
  };
};

export const createAppCatalogLifetime = (): CatalogLifetime<Inventory> =>
  createCatalogLifetime({
    open: openInventoryWorkspace,
    databaseName: inventoryScopeId,
  });
