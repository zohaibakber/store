import type * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";

export const bootWorkspaceRuntime = async <R, ER, A, E>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  boot: Effect.Effect<A, E, R>,
): Promise<A> => {
  try {
    return await runtime.runPromise(boot);
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
};
