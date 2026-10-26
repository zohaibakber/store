import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

export const singleFlight = <Arg, A, E>(
  run: Atom.AtomResultFn<Arg, A, E>,
): Atom.Writable<AsyncResult.AsyncResult<A, E>, Arg> =>
  Atom.writable<AsyncResult.AsyncResult<A, E>, Arg>(
    (get) => get(run),
    (ctx, arg) => {
      if (AsyncResult.isWaiting(ctx.get(run))) return;
      ctx.set(run, arg);
    },
  ).pipe(Atom.keepAlive);
