import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

type PendingReplies<A> = {
  readonly register: (requestId: string) => Effect.Effect<Deferred.Deferred<A>, never, Scope.Scope>;
  readonly ask: <E>(requestId: string, publish: Effect.Effect<unknown, E>) => Effect.Effect<A, E>;
  readonly respond: (requestId: string, value: A) => Effect.Effect<void>;
};

export const makePendingReplies = <A>(): PendingReplies<A> => {
  const waiters = new Map<string, Deferred.Deferred<A>>();

  const register = (requestId: string) =>
    Effect.acquireRelease(
      Deferred.make<A>().pipe(
        Effect.tap((reply) => Effect.sync(() => waiters.set(requestId, reply))),
      ),
      () => Effect.sync(() => waiters.delete(requestId)),
    );

  return {
    register,
    ask: (requestId, publish) =>
      Effect.scoped(
        Effect.gen(function* () {
          const reply = yield* register(requestId);
          yield* publish;
          return yield* Deferred.await(reply);
        }),
      ),
    respond: (requestId, value) =>
      Effect.suspend(() => {
        const reply = waiters.get(requestId);
        return reply === undefined ? Effect.void : Deferred.succeed(reply, value);
      }).pipe(Effect.asVoid),
  };
};

export const makeSharedFlight = <K, A>(
  replies: PendingReplies<A>,
  request: (key: K, requestId: string) => Effect.Effect<unknown>,
) =>
  Effect.gen(function* () {
    const turn = yield* Semaphore.make(1);
    const flights = yield* RcMap.make({
      lookup: (key: K) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(turn.take(1), () => turn.release(1), {
            interruptible: true,
          });
          const requestId = crypto.randomUUID();
          const reply = yield* replies.register(requestId);
          yield* request(key, requestId);
          return reply;
        }),
      idleTimeToLive: 0,
    });
    return (key: K, fallback: A, limit: Duration.Input): Effect.Effect<A> =>
      Effect.scoped(
        RcMap.get(flights, key).pipe(Effect.flatMap(Deferred.await), Effect.timeoutOption(limit)),
      ).pipe(Effect.map(Option.getOrElse(() => fallback)));
  });
