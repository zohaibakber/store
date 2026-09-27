import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

/**
 * Replay bus backed by Effect Atom. Keeps publish/current/subscribe for
 * non-React writers (session admit, tests) while React reads through
 * `useAtomValue` on {@link ReplayChannel.atom} under {@link ReplayChannel.registry}.
 */
export type ReplayChannel<Value> = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly atom: Atom.Writable<Value | undefined>;
  readonly publish: (value: Value) => void;
  readonly current: () => Value | undefined;
  readonly subscribe: (listener: (value: Value) => void) => () => void;
  readonly dispose: () => void;
};

export const makeReplayChannel = <Value>(): ReplayChannel<Value> => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const atom = Atom.make<Value | undefined>(undefined).pipe(Atom.keepAlive);
  return {
    registry,
    atom,
    publish: (value) => {
      registry.set(atom, value);
    },
    current: () => registry.get(atom),
    subscribe: (listener) =>
      registry.subscribe(
        atom,
        (value) => {
          if (value !== undefined) listener(value);
        },
        { immediate: true },
      ),
    dispose: () => {
      registry.dispose();
    },
  };
};
