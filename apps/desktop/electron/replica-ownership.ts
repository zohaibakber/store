import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { ReplicaWorkerFailure } from "./replica-rpc";

export type ReplicaOwnership = {
  readonly hold: (databasePath: string) => Effect.Effect<void, never, Scope.Scope>;
  readonly claim: (databasePath: string) => Effect.Effect<void, ReplicaWorkerFailure, Scope.Scope>;
};

export const makeReplicaOwnership = (wait: Duration.Input): ReplicaOwnership => {
  const owners = new Map<string, Set<Deferred.Deferred<void>>>();

  const enter = (databasePath: string) =>
    Effect.acquireRelease(
      Deferred.make<void>().pipe(
        Effect.tap((owner) =>
          Effect.sync(() => {
            const held = owners.get(databasePath) ?? new Set();
            held.add(owner);
            owners.set(databasePath, held);
          }),
        ),
      ),
      (owner) =>
        Effect.sync(() => {
          const held = owners.get(databasePath);
          held?.delete(owner);
          if (held?.size === 0) owners.delete(databasePath);
        }).pipe(Effect.andThen(Deferred.succeed(owner, undefined))),
    );

  const awaitOthers = (databasePath: string, own: Deferred.Deferred<void>) =>
    Effect.suspend(() =>
      Effect.forEach(
        [...(owners.get(databasePath) ?? [])].filter((owner) => owner !== own),
        Deferred.await,
        { discard: true },
      ),
    ).pipe(
      Effect.timeoutOrElse({
        duration: wait,
        orElse: () =>
          Effect.fail(
            new ReplicaWorkerFailure({
              message: "The previous workspace is still closing. Try again shortly.",
            }),
          ),
      }),
    );

  return {
    hold: (databasePath) => Effect.asVoid(enter(databasePath)),
    claim: (databasePath) =>
      Effect.flatMap(enter(databasePath), (own) => awaitOthers(databasePath, own)),
  };
};
