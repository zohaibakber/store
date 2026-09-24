import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

export const withDetachedScope = <A, E, R>(
  acquire: Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<
  { readonly value: A; readonly close: Effect.Effect<void> },
  E,
  Exclude<R, Scope.Scope>
> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const close = Scope.close(scope, Exit.void);
    const value = yield* acquire.pipe(
      Scope.provide(scope),
      Effect.onError(() => close),
    );
    return { value, close };
  });
