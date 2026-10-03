import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
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

export const workerRuntimeServices = Effect.gen(function* () {
  const runtime = yield* Effect.serviceOption(RuntimeContext);
  if (Option.isNone(runtime)) {
    return yield* Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext."));
  }
  const services = Context.make(RuntimeContext, runtime.value);
  return Option.match(yield* Effect.serviceOption(Cloudflare.Workers.WorkerEnvironment), {
    onNone: () => services,
    onSome: (environment) =>
      Context.add(services, Cloudflare.Workers.WorkerEnvironment, environment),
  });
});
