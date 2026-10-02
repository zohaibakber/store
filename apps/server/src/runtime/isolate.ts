import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

export const buildOncePerIsolate = <A, E, R>(
  build: Effect.Effect<A, E, R | Scope.Scope>,
  isolateServices: Context.Context<R>,
) =>
  Effect.gen(function* () {
    const isolateScope = yield* Scope.make();
    return yield* build.pipe(
      Scope.provide(isolateScope),
      Effect.onError((cause) => Scope.close(isolateScope, Exit.failCause(cause))),
      Effect.updateContext<never, R>(() => isolateServices),
    );
  });

export const workerRuntimeServices = Effect.serviceOption(RuntimeContext).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext.")),
      onSome: (runtime) => Effect.succeed(Context.make(RuntimeContext, runtime)),
    }),
  ),
);
