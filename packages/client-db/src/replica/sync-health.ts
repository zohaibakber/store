import type { SyncSchedulerContract } from "@store/sync/browser";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { syncHealthFromScheduler, type ReplicaSyncHealth } from "./status";
import type { ReplicaChangeUnsubscribe } from "./types";

export const subscribeSchedulerHealth =
  (scheduler: SyncSchedulerContract, lifetime: Scope.Scope) =>
  (listener: (health: ReplicaSyncHealth) => void): ReplicaChangeUnsubscribe => {
    const fiber = Stream.zipLatest(
      SubscriptionRef.changes(scheduler.status),
      SubscriptionRef.changes(scheduler.syncing),
    ).pipe(
      Stream.map(([status, syncing]) => syncHealthFromScheduler(status, syncing)),
      Stream.runForEach((health) => Effect.sync(() => listener(health))),
      Effect.forkIn(lifetime),
      Effect.runSync,
    );
    return () => {
      fiber.interruptUnsafe();
    };
  };
