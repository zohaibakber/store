import { ReplicaUnavailable } from "@store/contracts/replica";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

const TURN_WAIT = "30 seconds";

const TURN_RUN = "20 seconds";

export class CommandAdmission extends Context.Service<
  CommandAdmission,
  {
    readonly admit: <A, E, R>(
      command: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ReplicaUnavailable, R>;
    readonly exclusive: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("@store/client-db/CommandAdmission") {
  static readonly layer = Layer.effect(
    CommandAdmission,
    Effect.gen(function* () {
      const permit = yield* Semaphore.make(1);
      const closed = yield* Deferred.make<never, ReplicaUnavailable>();
      yield* Effect.addFinalizer(() =>
        Deferred.fail(closed, new ReplicaUnavailable({ reason: "restarting" })),
      );

      const busy = Effect.fail(new ReplicaUnavailable({ reason: "busy" }));

      const turn = Effect.acquireRelease(permit.take(1), () => permit.release(1), {
        interruptible: true,
      }).pipe(Effect.raceFirst(Deferred.await(closed)), Effect.timeoutOption(TURN_WAIT));

      const admit = <A, E, R>(command: Effect.Effect<A, E, R>) =>
        Effect.scoped(
          Effect.gen(function* () {
            if (Option.isNone(yield* turn)) return yield* busy;
            const done = yield* Effect.timeoutOption(command, TURN_RUN);
            if (Option.isNone(done)) return yield* busy;
            return done.value;
          }),
        ).pipe(Effect.withSpan("CommandAdmission.admit"));

      return CommandAdmission.of({ admit, exclusive: (work) => permit.withPermit(work) });
    }),
  );
}
