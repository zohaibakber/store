import type { SyncSchedulerContract } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { sameSyncHealth, syncHealthOf, type ReplicaSyncHealth } from "./status";
import type { ReplicaChangeUnsubscribe } from "./types";

export const subscribeSchedulerHealth =
  (scheduler: SyncSchedulerContract, lifetime: Scope.Scope) =>
  (listener: (health: ReplicaSyncHealth) => void): ReplicaChangeUnsubscribe => {
    const fiber = SubscriptionRef.changes(scheduler.state).pipe(
      Stream.map(syncHealthOf),
      Stream.changesWith(sameSyncHealth),
      Stream.runForEach((health) => Effect.sync(() => listener(health))),
      Effect.forkIn(lifetime),
      Effect.runSync,
    );
    return () => {
      fiber.interruptUnsafe();
    };
  };
