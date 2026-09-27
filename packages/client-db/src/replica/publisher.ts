import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ReplicaChangeFeed, ReplicaChangeUnsubscribe, ReplicaCommitNotice } from "./types";

export type ReplicaCommitPublisher = ReplicaChangeFeed & {
  readonly publish: (notice: ReplicaCommitNotice) => void;
  readonly dispose: () => void;
};

export const createReplicaCommitPublisher = (): ReplicaCommitPublisher => {
  const hub = Effect.runSync(PubSub.unbounded<ReplicaCommitNotice>());

  return {
    subscribe: (listener: (notice: ReplicaCommitNotice) => void): ReplicaChangeUnsubscribe => {
      if (PubSub.isShutdownUnsafe(hub)) return () => undefined;
      const scope = Effect.runSync(Scope.make());
      Effect.runSync(
        PubSub.subscribe(hub).pipe(
          Effect.flatMap((subscription) =>
            Stream.fromSubscription(subscription).pipe(
              Stream.runForEach((notice) => Effect.sync(() => listener(notice))),
              Effect.forkScoped,
            ),
          ),
          Scope.provide(scope),
        ),
      );
      return () => {
        void Effect.runPromise(Scope.close(scope, Exit.void));
      };
    },
    publish: (notice: ReplicaCommitNotice): void => {
      PubSub.publishUnsafe(hub, notice);
    },
    dispose: (): void => {
      Effect.runSync(PubSub.shutdown(hub));
    },
  };
};
