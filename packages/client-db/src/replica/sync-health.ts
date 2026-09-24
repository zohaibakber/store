import type { SyncSchedulerContract } from "@store/sync/browser";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { syncHealthFromScheduler, type ReplicaSyncHealth } from "./status";
import type { ReplicaChangeUnsubscribe } from "./types";

export const subscribeSchedulerHealth =
  (scheduler: SyncSchedulerContract) =>
  (listener: (health: ReplicaSyncHealth) => void): ReplicaChangeUnsubscribe => {
    const fiber = SubscriptionRef.changes(scheduler.status).pipe(
      Stream.map(syncHealthFromScheduler),
      Stream.runForEach((health) => Effect.sync(() => listener(health))),
      Effect.runFork,
    );
    return () => {
      fiber.interruptUnsafe();
    };
  };
