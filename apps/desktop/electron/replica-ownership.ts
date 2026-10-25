import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";

import { ReplicaWorkerFailure } from "./replica-rpc";

export type ReplicaOwnership = {
  readonly hold: (databasePath: string) => Effect.Effect<void, never, Scope.Scope>;
  readonly claim: (databasePath: string) => Effect.Effect<void, ReplicaWorkerFailure, Scope.Scope>;
};

type Owner = {
  readonly databasePath: string;
  readonly released: Deferred.Deferred<void>;
};

export const makeReplicaOwnership = Effect.fn("ReplicaOwnership.make")(function* (
  wait: Duration.Input,
) {
  const owners = yield* Ref.make<ReadonlyArray<Owner>>([]);

  const enter = (databasePath: string) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const owner: Owner = { databasePath, released: yield* Deferred.make<void>() };
        yield* Ref.update(owners, Arr.append(owner));
        return owner;
      }),
      (owner) =>
        Ref.update(
          owners,
          Arr.filter((held) => held !== owner),
        ).pipe(Effect.andThen(Deferred.succeed(owner.released, undefined))),
    );

  const awaitOthers = (own: Owner) =>
    Effect.flatMap(Ref.get(owners), (held) =>
      Effect.forEach(
        held.filter((owner) => owner.databasePath === own.databasePath && owner !== own),
        (owner) => Deferred.await(owner.released),
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
    claim: (databasePath) => Effect.flatMap(enter(databasePath), awaitOthers),
  } satisfies ReplicaOwnership;
});
