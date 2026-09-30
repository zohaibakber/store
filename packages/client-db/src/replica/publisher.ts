import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { NOTICE_BUFFER_CAPACITY, offerCoalescing } from "./notice-coalescing";
import type { ReplicaChangeFeed, ReplicaChangeUnsubscribe, ReplicaCommitNotice } from "./types";

export type ReplicaCommitPublisher = ReplicaChangeFeed & {
  readonly publish: (notice: ReplicaCommitNotice) => void;
  readonly dispose: () => Promise<void>;
};

export const createReplicaCommitPublisher = (): ReplicaCommitPublisher => {
  const lifetime = Effect.runSync(Scope.make());
  const closing = Effect.runSync(Effect.cached(Scope.close(lifetime, Exit.void)));
  const buffers = new Set<Queue.Queue<ReplicaCommitNotice>>();

  return {
    subscribe: (listener: (notice: ReplicaCommitNotice) => void): ReplicaChangeUnsubscribe => {
      const scope = Effect.runSync(Scope.fork(lifetime));
      const buffer = Effect.runSync(Queue.bounded<ReplicaCommitNotice>(NOTICE_BUFFER_CAPACITY));
      buffers.add(buffer);
      Effect.runSync(
        Effect.gen(function* () {
          yield* Scope.addFinalizer(
            scope,
            Effect.suspend(() => {
              buffers.delete(buffer);
              return Queue.shutdown(buffer);
            }),
          );
          yield* Stream.fromQueue(buffer).pipe(
            Stream.runForEach((notice) =>
              Effect.try({ try: () => listener(notice), catch: (cause) => cause }).pipe(
                Effect.catch((cause) => Effect.logError("ReplicaCommitPublisher.listener", cause)),
              ),
            ),
            Effect.forkScoped,
          );
        }).pipe(Scope.provide(scope)),
      );
      return () => {
        void Effect.runPromise(Scope.close(scope, Exit.void));
      };
    },
    publish: (notice: ReplicaCommitNotice): void => {
      for (const buffer of buffers) offerCoalescing(buffer, notice);
    },
    dispose: () => Effect.runPromise(closing),
  };
};
